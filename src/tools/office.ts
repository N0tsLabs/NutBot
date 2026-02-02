/**
 * Office 文档工具
 * 支持 Excel、Word、PDF 的读写操作
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import fs from 'fs-extra';
import path from 'path';

// 动态导入类型（运行时加载）
type XLSX = typeof import('xlsx');
type Mammoth = typeof import('mammoth');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfParseModule = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

export class OfficeTool extends BaseTool {
	private xlsx: XLSX | null = null;
	private mammoth: Mammoth | null = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private docxModule: any = null;
	private pdfParse: PdfParseModule | null = null;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'office',
			description: 'Office 文档工具，支持读写 Excel、Word 文档，以及读取 PDF',
			parameters: {
				action: {
					type: 'string',
					description:
						'操作类型: read_excel(读取Excel), write_excel(写入Excel), read_word(读取Word), write_word(写入Word), read_pdf(读取PDF)',
					required: true,
					enum: ['read_excel', 'write_excel', 'read_word', 'write_word', 'read_pdf'],
				},
				path: {
					type: 'string',
					description: '文件路径',
					required: true,
				},
				sheet: {
					type: 'string',
					description: 'Excel 操作的工作表名称（默认第一个）',
				},
				range: {
					type: 'string',
					description: 'Excel 读取范围，如 "A1:D10"',
				},
				data: {
					type: 'array',
					description: 'write_excel 操作的数据（二维数组）',
					items: { 
						type: 'array',
						items: { type: 'string' }
					},
				},
				content: {
					type: 'string',
					description: 'write_word 操作的文本内容',
				},
				headers: {
					type: 'array',
					description: 'write_excel 操作的表头（可选）',
					items: { type: 'string' },
				},
			},
			...config,
		});
	}

	/**
	 * 延迟加载依赖
	 */
	private async loadXlsx(): Promise<XLSX> {
		if (!this.xlsx) {
			try {
				this.xlsx = await import('xlsx');
			} catch {
				throw new Error('xlsx 模块未安装，请运行: npm install xlsx');
			}
		}
		return this.xlsx;
	}

	private async loadMammoth(): Promise<Mammoth> {
		if (!this.mammoth) {
			try {
				this.mammoth = await import('mammoth');
			} catch {
				throw new Error('mammoth 模块未安装，请运行: npm install mammoth');
			}
		}
		return this.mammoth;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private async loadDocx(): Promise<any> {
		if (!this.docxModule) {
			try {
				this.docxModule = await import('docx');
			} catch {
				throw new Error('docx 模块未安装，请运行: npm install docx');
			}
		}
		return this.docxModule;
	}

	private async loadPdfParse(): Promise<PdfParseModule> {
		if (!this.pdfParse) {
			try {
				// @ts-expect-error pdf-parse 没有类型声明
				const pdfParseModule = await import('pdf-parse');
				this.pdfParse = pdfParseModule.default;
			} catch {
				throw new Error('pdf-parse 模块未安装，请运行: npm install pdf-parse');
			}
		}
		return this.pdfParse!;
	}

	async execute(
		params: {
			action: string;
			path: string;
			sheet?: string;
			range?: string;
			data?: unknown[][];
			content?: string;
			headers?: string[];
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, path: filePath, sheet, range, data, content, headers } = params;

		const normalizedPath = path.resolve(filePath.startsWith('~') ? filePath.replace('~', process.env.HOME || '') : filePath);

		switch (action) {
			case 'read_excel':
				return await this.readExcel(normalizedPath, sheet, range);
			case 'write_excel':
				if (!data) throw new Error('write_excel 操作需要 data 参数');
				return await this.writeExcel(normalizedPath, data, sheet, headers);
			case 'read_word':
				return await this.readWord(normalizedPath);
			case 'write_word':
				if (!content) throw new Error('write_word 操作需要 content 参数');
				return await this.writeWord(normalizedPath, content);
			case 'read_pdf':
				return await this.readPdf(normalizedPath);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 读取 Excel 文件
	 */
	private async readExcel(
		filePath: string,
		sheetName?: string,
		range?: string
	): Promise<{
		success: boolean;
		path: string;
		sheets: string[];
		currentSheet: string;
		data: unknown[][];
		rowCount: number;
		columnCount: number;
	}> {
		const xlsx = await this.loadXlsx();

		const exists = await fs.pathExists(filePath);
		if (!exists) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		const workbook = xlsx.readFile(filePath);
		const sheets = workbook.SheetNames;

		// 选择工作表
		const targetSheet = sheetName || sheets[0];
		if (!sheets.includes(targetSheet)) {
			throw new Error(`工作表不存在: ${targetSheet}，可用的工作表: ${sheets.join(', ')}`);
		}

		const worksheet = workbook.Sheets[targetSheet];

		// 读取数据
		const options: { range?: string; header?: number } = { header: 1 };
		if (range) {
			options.range = range;
		}

		const data = xlsx.utils.sheet_to_json<unknown[]>(worksheet, options);

		// 计算行列数
		const rowCount = data.length;
		const columnCount = data.length > 0 ? Math.max(...data.map((row) => (Array.isArray(row) ? row.length : 0))) : 0;

		this.logger.info(`读取 Excel: ${filePath} [${targetSheet}] (${rowCount} 行, ${columnCount} 列)`);

		return {
			success: true,
			path: filePath,
			sheets,
			currentSheet: targetSheet,
			data,
			rowCount,
			columnCount,
		};
	}

	/**
	 * 写入 Excel 文件
	 */
	private async writeExcel(
		filePath: string,
		data: unknown[][],
		sheetName?: string,
		headers?: string[]
	): Promise<{
		success: boolean;
		path: string;
		sheet: string;
		rowCount: number;
		columnCount: number;
	}> {
		const xlsx = await this.loadXlsx();

		// 如果有表头，添加到数据开头
		const finalData = headers ? [headers, ...data] : data;

		// 创建工作簿和工作表
		const workbook = xlsx.utils.book_new();
		const worksheet = xlsx.utils.aoa_to_sheet(finalData);
		const sheet = sheetName || 'Sheet1';

		xlsx.utils.book_append_sheet(workbook, worksheet, sheet);

		// 确保目录存在
		await fs.ensureDir(path.dirname(filePath));

		// 写入文件
		xlsx.writeFile(workbook, filePath);

		const rowCount = finalData.length;
		const columnCount = finalData.length > 0 ? Math.max(...finalData.map((row) => row.length)) : 0;

		this.logger.info(`写入 Excel: ${filePath} (${rowCount} 行, ${columnCount} 列)`);

		return {
			success: true,
			path: filePath,
			sheet,
			rowCount,
			columnCount,
		};
	}

	/**
	 * 读取 Word 文档
	 */
	private async readWord(filePath: string): Promise<{
		success: boolean;
		path: string;
		text: string;
		html: string;
		length: number;
	}> {
		const mammoth = await this.loadMammoth();

		const exists = await fs.pathExists(filePath);
		if (!exists) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		const buffer = await fs.readFile(filePath);
		const result = await mammoth.convertToHtml({ buffer });
		const textResult = await mammoth.extractRawText({ buffer });

		this.logger.info(`读取 Word: ${filePath} (${textResult.value.length} 字符)`);

		return {
			success: true,
			path: filePath,
			text: textResult.value,
			html: result.value,
			length: textResult.value.length,
		};
	}

	/**
	 * 写入 Word 文档
	 */
	private async writeWord(
		filePath: string,
		content: string
	): Promise<{
		success: boolean;
		path: string;
		length: number;
	}> {
		const docxModule = await this.loadDocx();
		const { Document, Packer, Paragraph, TextRun } = docxModule;

		// 将内容按段落分割
		const paragraphs = content.split('\n').map(
			(line) =>
				new Paragraph({
					children: [new TextRun(line)],
				})
		);

		const doc = new Document({
			sections: [
				{
					children: paragraphs,
				},
			],
		});

		// 确保目录存在
		await fs.ensureDir(path.dirname(filePath));

		// 生成文档
		const buffer = await Packer.toBuffer(doc);
		await fs.writeFile(filePath, buffer);

		this.logger.info(`写入 Word: ${filePath} (${content.length} 字符)`);

		return {
			success: true,
			path: filePath,
			length: content.length,
		};
	}

	/**
	 * 读取 PDF 文件
	 */
	private async readPdf(filePath: string): Promise<{
		success: boolean;
		path: string;
		text: string;
		pages: number;
		length: number;
	}> {
		const pdfParse = await this.loadPdfParse();

		const exists = await fs.pathExists(filePath);
		if (!exists) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		const buffer = await fs.readFile(filePath);
		const data = await pdfParse(buffer);

		this.logger.info(`读取 PDF: ${filePath} (${data.numpages} 页, ${data.text.length} 字符)`);

		return {
			success: true,
			path: filePath,
			text: data.text,
			pages: data.numpages,
			length: data.text.length,
		};
	}

	async cleanup(): Promise<void> {
		// 清理缓存的模块引用
		this.xlsx = null;
		this.mammoth = null;
		this.docxModule = null;
		this.pdfParse = null;
	}
}

export default OfficeTool;
