/**
 * 屏幕截图工具
 * 使用 screenshot-desktop 进行屏幕截图
 * 使用 sharp 进行图片压缩
 * 集成 OCR-SoM 识别屏幕元素
 */

import { BaseTool } from './registry.js';
import { systemInfo } from './exec.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ocrSomService } from '../services/ocr-som.js';
import { ConfigManager } from '../utils/config.js';

// 截图保存目录
const SCREENSHOT_DIR = join(systemInfo.homedir, '.nutbot', 'screenshots');

// 确保目录存在
if (!existsSync(SCREENSHOT_DIR)) {
	mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

export class ScreenshotTool extends BaseTool {
	private screenshotDesktop: ((options?: { format?: string; screen?: number }) => Promise<Buffer>) | null = null;
	private sharp:
		| ((input: Buffer) => {
				resize: (width: number, height?: number, options?: { fit?: string }) => unknown;
				jpeg: (options?: { quality?: number }) => unknown;
				png: (options?: { quality?: number; compressionLevel?: number }) => unknown;
				toBuffer: () => Promise<Buffer>;
		  })
		| null = null;
	private available = false;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'screenshot',
			description: '屏幕截图工具，截取当前屏幕画面。截图会自动压缩以节省资源。',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: capture(截图返回图片), save(截图保存到文件)',
					required: true,
					enum: ['capture', 'save', 'list_screens'],
				},
				screen: {
					type: 'number',
					description: '要截取的屏幕编号（多显示器时使用），默认为主屏幕',
				},
				path: {
					type: 'string',
					description: 'save 操作的保存路径',
				},
				quality: {
					type: 'string',
					description: '图片质量: low(更小), medium(平衡), high(更清晰)。默认 medium',
					enum: ['low', 'medium', 'high'],
				},
			},
			...config,
		});

		this.checkDependency();
	}

	private async checkDependency(): Promise<void> {
		try {
			const module = await import('screenshot-desktop');
			this.screenshotDesktop = module.default || module;
			this.available = true;
		} catch {
			this.available = false;
			this.logger.warn('screenshot-desktop 未安装，截图工具不可用。安装: npm install screenshot-desktop');
		}

		// 加载 sharp
		try {
			const sharpModule = await import('sharp');
			this.sharp = sharpModule.default || sharpModule;
		} catch {
			this.logger.warn('sharp 未安装，截图将不会压缩。安装: npm install sharp');
		}
	}

	async execute(
		params: {
			action: string;
			screen?: number;
			path?: string;
			quality?: string;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		if (!this.available) {
			throw new Error('screenshot-desktop 未安装。请运行: npm install screenshot-desktop');
		}

		const { action, screen, path: savePath, quality = 'medium' } = params;

		switch (action) {
			case 'capture':
				return await this.capture(screen, quality);
			case 'save':
				return await this.captureAndSave(screen, savePath, quality);
			case 'list_screens':
				return await this.listScreens();
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 压缩图片（只做质量压缩，不改变尺寸）
	 * 保持原始尺寸确保 AI 返回的坐标与屏幕坐标一致
	 */
	private async compressImage(buffer: Buffer, quality: string): Promise<Buffer> {
		if (!this.sharp) {
			return buffer; // 没有 sharp 就返回原图
		}

		// 质量配置（只压缩质量，不改变尺寸）
		const qualityConfig = {
			low: { jpegQuality: 50 },
			medium: { jpegQuality: 70 },
			high: { jpegQuality: 85 },
		};

		const config = qualityConfig[quality as keyof typeof qualityConfig] || qualityConfig.medium;

		try {
			const compressed = await (
				this.sharp(buffer) as unknown as {
					jpeg: (options: { quality: number }) => unknown;
					toBuffer: () => Promise<Buffer>;
				}
			)
				.jpeg({ quality: config.jpegQuality })
				.toBuffer();

			this.logger.debug(
				`图片压缩: ${buffer.length} -> ${compressed.length} 字节 (${Math.round((compressed.length / buffer.length) * 100)}%)`
			);
			return compressed;
		} catch (error) {
			this.logger.warn('图片压缩失败，使用原图:', error);
			return buffer;
		}
	}

	/**
	 * 获取屏幕信息（包括缩放）
	 */
	private async getScreenInfo(buffer: Buffer): Promise<{
		imageWidth: number;
		imageHeight: number;
		mouseWidth: number;
		mouseHeight: number;
		scale: number;
	}> {
		// 获取截图的实际像素尺寸
		let imageWidth = 1920;
		let imageHeight = 1080;

		if (this.sharp) {
			try {
				const metadata = await (
					this.sharp(buffer) as unknown as { metadata: () => Promise<{ width?: number; height?: number }> }
				).metadata();
				imageWidth = metadata.width || 1920;
				imageHeight = metadata.height || 1080;
			} catch {
				// 忽略错误
			}
		}

		// 获取 nut.js 的鼠标坐标系统尺寸
		let mouseWidth = imageWidth;
		let mouseHeight = imageHeight;

		try {
			const nutjs = await import('@nut-tree-fork/nut-js');
			const { screen } = nutjs;
			mouseWidth = await screen.width();
			mouseHeight = await screen.height();
		} catch {
			// 忽略错误
		}

		// 计算缩放比例
		const scale = imageWidth / mouseWidth;

		return { imageWidth, imageHeight, mouseWidth, mouseHeight, scale };
	}

	/**
	 * 截图并返回 base64
	 * 如果启用 OCR-SoM，会同时返回元素列表和标注图
	 */
	private async capture(
		screen?: number,
		quality: string = 'medium'
	): Promise<{
		success: boolean;
		base64: string;
		format: string;
		originalSize: number;
		compressedSize: number;
		savedPath: string;
		imageSize: string;
		mouseCoordSize: string;
		scale: number;
		coordinateHelp: string;
		// OCR-SoM 相关
		ocrEnabled?: boolean;
		markedImage?: string;
		elements?: Array<{
			id: number;
			text: string;
			center: [number, number];
			mouseCenter: [number, number]; // 鼠标坐标系的中心点
		}>;
		elementsHelp?: string;
	}> {
		const options: { format?: string; screen?: number } = { format: 'png' };
		if (screen !== undefined) {
			options.screen = screen;
		}

		// 截图
		const originalBuffer = await this.screenshotDesktop!(options);
		const originalSize = originalBuffer.length;

		// 获取屏幕信息（包括缩放）
		const screenInfo = await this.getScreenInfo(originalBuffer);

		// 压缩（只压缩质量，不改变尺寸）
		const compressedBuffer = await this.compressImage(originalBuffer, quality);
		const base64 = compressedBuffer.toString('base64');

		// 保存到文件
		const filename = `screenshot_${Date.now()}.jpg`;
		const savedPath = join(SCREENSHOT_DIR, filename);
		await fs.writeFile(savedPath, compressedBuffer);

		// 生成坐标转换帮助信息
		const coordinateHelp =
			screenInfo.scale > 1.01
				? `⚠️ 重要：屏幕有 ${Math.round(screenInfo.scale * 100)}% 缩放！
图片坐标需要除以 ${screenInfo.scale.toFixed(2)} 才能用于点击。
例如：图片坐标 (1000, 800) → 点击坐标 (${Math.round(1000 / screenInfo.scale)}, ${Math.round(800 / screenInfo.scale)})`
				: `图片坐标可直接用于点击`;

		this.logger.info(
			`截图完成: ${originalSize} -> ${compressedBuffer.length} 字节 (压缩 ${Math.round((1 - compressedBuffer.length / originalSize) * 100)}%), 保存: ${savedPath}`
		);
		this.logger.info(
			`截图尺寸: ${screenInfo.imageWidth}x${screenInfo.imageHeight}, 鼠标坐标系: ${screenInfo.mouseWidth}x${screenInfo.mouseHeight}, 缩放: ${screenInfo.scale.toFixed(2)}x`
		);

		// 基础返回结果
		const result: {
			success: boolean;
			base64: string;
			format: string;
			originalSize: number;
			compressedSize: number;
			savedPath: string;
			imageSize: string;
			mouseCoordSize: string;
			scale: number;
			coordinateHelp: string;
			ocrEnabled?: boolean;
			markedImage?: string;
			elements?: Array<{
				id: number;
				text: string;
				center: [number, number];
				mouseCenter: [number, number];
			}>;
			elementsHelp?: string;
		} = {
			success: true,
			base64,
			format: 'jpeg',
			originalSize,
			compressedSize: compressedBuffer.length,
			savedPath,
			imageSize: `${screenInfo.imageWidth}x${screenInfo.imageHeight}`,
			mouseCoordSize: `${screenInfo.mouseWidth}x${screenInfo.mouseHeight}`,
			scale: screenInfo.scale,
			coordinateHelp,
		};

		// 尝试调用 OCR-SoM
		try {
			const config = ConfigManager.getInstance();
			const ocrEnabled = config.get<boolean>('ocr.enabled', true);
			
			if (ocrEnabled && ocrSomService.isConfigured()) {
				this.logger.info('调用 OCR-SoM 识别屏幕元素...');
				const somResult = await ocrSomService.analyze(base64, { returnImage: true });
				
				if (somResult.success && somResult.elements.length > 0) {
					result.ocrEnabled = true;
					result.markedImage = somResult.marked_image;
					
					// 转换元素列表，同时提供图片坐标和鼠标坐标
					result.elements = somResult.elements.map(el => {
						const [x1, y1, x2, y2] = el.box;
						const centerX = Math.round((x1 + x2) / 2);
						const centerY = Math.round((y1 + y2) / 2);
						return {
							id: el.id,
							text: el.text || `[${el.type}]`,
							center: [centerX, centerY] as [number, number],
							mouseCenter: [
								Math.round(centerX / screenInfo.scale),
								Math.round(centerY / screenInfo.scale),
							] as [number, number],
						};
					});
					
					// 生成元素使用帮助
					result.elementsHelp = `
📋 识别到 ${result.elements.length} 个可点击元素（见标注图中的编号）
⭐ 使用方法：找到目标元素的编号，使用其 mouseCenter 坐标点击
例如：要点击 [搜索] 按钮（id=5, mouseCenter=[720, 45]）
→ computer left_click coordinate:[720, 45]`;

					this.logger.info(`OCR-SoM 识别到 ${result.elements.length} 个元素`);
				}
			}
		} catch (e) {
			this.logger.warn('OCR-SoM 调用失败:', (e as Error).message);
		}

		return result;
	}

	/**
	 * 截图并保存到指定路径
	 */
	private async captureAndSave(
		screen?: number,
		savePath?: string,
		quality: string = 'medium'
	): Promise<{ success: boolean; path: string; originalSize: number; compressedSize: number }> {
		const options: { format?: string; screen?: number } = { format: 'png' };
		if (screen !== undefined) {
			options.screen = screen;
		}

		// 截图
		const originalBuffer = await this.screenshotDesktop!(options);
		const originalSize = originalBuffer.length;

		// 压缩
		const compressedBuffer = await this.compressImage(originalBuffer, quality);

		// 生成默认路径
		const finalPath = savePath || join(systemInfo.homedir, 'Desktop', `screenshot_${Date.now()}.jpg`);

		await fs.writeFile(finalPath, compressedBuffer);

		this.logger.info(`截图已保存: ${finalPath} (${originalSize} -> ${compressedBuffer.length} 字节)`);

		return {
			success: true,
			path: finalPath,
			originalSize,
			compressedSize: compressedBuffer.length,
		};
	}

	/**
	 * 列出可用屏幕
	 */
	private async listScreens(): Promise<{ success: boolean; screens: number[] }> {
		try {
			const module = await import('screenshot-desktop');
			if (module.listDisplays) {
				const displays = await module.listDisplays();
				return {
					success: true,
					screens: displays.map((d: { id: number }) => d.id),
				};
			}
		} catch {
			// 忽略错误
		}

		return {
			success: true,
			screens: [0],
		};
	}

	async cleanup(): Promise<void> {
		// 清理旧截图（保留最近 50 张）
		try {
			const files = await fs.readdir(SCREENSHOT_DIR);
			const screenshots = files
				.filter((f) => f.startsWith('screenshot_'))
				.sort()
				.reverse();

			if (screenshots.length > 50) {
				const toDelete = screenshots.slice(50);
				for (const file of toDelete) {
					await fs.unlink(join(SCREENSHOT_DIR, file));
				}
				this.logger.debug(`清理了 ${toDelete.length} 张旧截图`);
			}
		} catch {
			// 忽略清理错误
		}
	}
}

export default ScreenshotTool;
