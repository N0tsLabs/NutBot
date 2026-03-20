/**
 * 屏幕截图工具
 * 使用 screenshot-desktop 进行屏幕截图
 * 使用 sharp 进行图片压缩
 * 【优化】移除 OCR-SoM，直接返回截图给 AI 进行视觉分析
 * 【新增】集成窗口信息获取，帮助 AI 识别任务栏图标等
 */

import { BaseTool } from './registry.js';
import { systemInfo } from './exec.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getWindowInfo, formatWindowInfo } from '../utils/window-info.js';

// 截图保存目录 - 使用项目根目录下的 data 文件夹
const SCREENSHOT_DIR = join(process.cwd(), 'data', 'screenshots');

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
				metadata: () => Promise<{ width?: number; height?: number }>;
		  })
		| null = null;
	private available = false;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'screenshot',
			description: `屏幕截图工具，截取整个屏幕画面并返回给 AI 进行视觉分析。

【使用方式】
1. 调用 screenshot 工具截取屏幕
2. 将返回的 base64 图片直接发送给 AI
3. AI 通过视觉能力分析图片内容并返回操作坐标
4. 使用 computer 工具的 click 操作执行点击

【坐标说明】
- AI 必须返回相对坐标 [x, y]，范围 [0.0, 1.0]
- 例如：[0.5, 0.5] 表示屏幕中心，[1.0, 1.0] 表示右下角
- 不要返回绝对像素坐标，系统会自动处理屏幕缩放
- 支持多显示器，可通过 screen 参数指定`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型：capture(截图), save(保存), list_screens(列出屏幕)',
					required: false,
					default: 'capture',
					enum: ['capture', 'save', 'list_screens'],
				},
				screen: {
					type: 'number',
					description: '屏幕编号（多显示器时使用）',
				},
				path: {
					type: 'string',
					description: 'save 操作的保存路径',
				},
				quality: {
					type: 'string',
					description: '图片质量：low, medium, high',
					enum: ['low', 'medium', 'high'],
				},
			},
			...config,
		});

		// 注意：构造函数中不能 await，依赖检查在第一次 execute 时进行
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
			action?: string;
			screen?: number;
			path?: string;
			quality?: string;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		// 首次执行时检查依赖
		if (!this.available && !this.screenshotDesktop) {
			await this.checkDependency();
		}
		
		if (!this.available) {
			throw new Error('screenshot-desktop 未安装。请运行: npm install screenshot-desktop');
		}

		const { action = 'capture', screen, path: savePath, quality = 'medium' } = params;

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
	 * 压缩图片（使用 PNG 无损压缩，保持清晰度）
	 * 保持原始尺寸确保 AI 返回的坐标与屏幕坐标一致
	 * 【优化】使用 PNG 代替 JPEG，避免小图标模糊
	 * 【优化】高质量模式不压缩，直接返回原图
	 */
	private async compressImage(buffer: Buffer, quality: string): Promise<Buffer> {
		if (!this.sharp) {
			return buffer; // 没有 sharp 就返回原图
		}

		// high 质量直接返回原图，确保清晰度
		if (quality === 'high') {
			this.logger.debug('高质量模式: 跳过压缩，使用原图');
			return buffer;
		}

		// PNG 压缩配置（无损压缩，保持清晰度）
		const qualityConfig = {
			low: { compressionLevel: 9 },    // 最高压缩，文件小
			medium: { compressionLevel: 6 }, // 平衡
		};

		const config = qualityConfig[quality as keyof typeof qualityConfig] || qualityConfig.medium;

		try {
			const compressed = await this.sharp(buffer)
				.png({ compressionLevel: config.compressionLevel })
				.toBuffer();

			this.logger.debug(
				`图片压缩: ${buffer.length} -> ${compressed.length} 字节 (${Math.round((compressed.length / buffer.length) * 100)}%), 格式: PNG`
			);
			return compressed;
		} catch (error) {
			this.logger.warn('图片压缩失败，使用原图:', error);
			return buffer;
		}
	}

	/**
	 * 在终端显示图片（支持 iTerm2 和 Kitty 协议）
	 */
	private displayImageInTerminal(buffer: Buffer): void {
		try {
			const base64 = buffer.toString('base64');
			const fileSize = buffer.length;

			// 尝试使用 iTerm2 图像协议
			const iterm2Sequence = `\x1b]1337;File=inline=1;size=${fileSize}:${base64}\x07`;

			// 尝试使用 Kitty 图像协议
			const kittyStart = `\x1b_Gf=100,i=1,s=${fileSize},v=1`;
			const kittyEnd = `\x1b\\\x1b]1337;File=done`;
			const kittySequence = `${kittyStart};${base64}${kittyEnd}`;

			// 输出到控制台
			process.stdout.write(iterm2Sequence + '\n');
			process.stdout.write(kittySequence + '\n');

			this.logger.debug('图片已发送到终端显示');
		} catch (error) {
			this.logger.debug('终端图片显示失败:', error);
		}
	}

	/**
	 * 获取屏幕信息（包括缩放）
	 */
	private async getScreenInfo(buffer: Buffer): Promise<{
		imageWidth: number;
		imageHeight: number;
		scale: number;
	}> {
		// 获取截图的实际像素尺寸
		let imageWidth = 1920;
		let imageHeight = 1080;

		if (this.sharp) {
			try {
				const metadata = await this.sharp(buffer).metadata();
				imageWidth = metadata.width || 1920;
				imageHeight = metadata.height || 1080;
			} catch {
				// 忽略错误
			}
		}

		// 计算缩放比例（假设标准 DPI 为 96）
		const scale = 1;

		return { imageWidth, imageHeight, scale };
	}

	/**
	 * 截图并返回 base64
	 * 【优化】直接返回截图给 AI 进行视觉分析，不再调用 SoM
	 * 【重要】原封不动返回原始截图，不做任何压缩或处理
	 * 【新增】同时获取窗口信息，帮助 AI 识别任务栏图标等
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
		imageSize: { width: number; height: number };
		scale: number;
		windowInfo?: string;
	}> {
		const options: { format?: string; screen?: number } = { format: 'png' };
		if (screen !== undefined) {
			options.screen = screen;
		}

		// 截图 - 直接获取原始 buffer，不做任何处理
		const originalBuffer = await this.screenshotDesktop!(options);
		const originalSize = originalBuffer.length;

		// 获取屏幕信息
		const screenInfo = await this.getScreenInfo(originalBuffer);

		// 【重要】原封不动返回原始截图，不做任何压缩或处理
		// 确保 AI 收到的图片和测试用例中的图片完全一致
		const base64 = originalBuffer.toString('base64');

		// 保存到文件（保存原始图片）
		const filename = `screenshot_${Date.now()}.png`;
		const savedPath = join(SCREENSHOT_DIR, filename);
		await fs.writeFile(savedPath, originalBuffer);

		// 【新增】获取窗口信息
		let windowInfoText = '';
		try {
			const windowInfoResult = await getWindowInfo();
			if (windowInfoResult.success) {
				windowInfoText = formatWindowInfo(windowInfoResult);
				this.logger.debug(`获取到 ${windowInfoResult.windows.length} 个窗口信息`);
			}
		} catch (error) {
			this.logger.warn('获取窗口信息失败:', error);
		}

		this.logger.info(
			`截图完成: ${originalSize} 字节, 尺寸: ${screenInfo.imageWidth}x${screenInfo.imageHeight}, 格式: PNG (原图，无压缩)`
		);

		// 在终端显示图片
		this.displayImageInTerminal(originalBuffer);

		return {
			success: true,
			base64,
			format: 'png',
			originalSize,
			compressedSize: originalSize, // 无压缩，大小相同
			// 只返回文件名，前端通过 /screenshots/system/{filename} 访问
			savedPath: filename,
			imageSize: { width: screenInfo.imageWidth, height: screenInfo.imageHeight },
			scale: screenInfo.scale,
			windowInfo: windowInfoText || undefined,
		};
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
