/**
 * Computer 控制工具
 * 鼠标键盘控制，用于截图+坐标操作方案
 * 支持 robotjs 或 nut.js
 */

import { BaseTool } from './registry.js';
import { systemInfo } from './exec.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// 脚本缓存目录
const SCRIPT_DIR = join(tmpdir(), 'nutbot-scripts');
if (!existsSync(SCRIPT_DIR)) {
	mkdirSync(SCRIPT_DIR, { recursive: true });
}

// PowerShell 脚本模板
const PS_UNICODE_SCRIPT = `
param([string]$text)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class UnicodeInput {
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
        public uint type;
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
        public uint padding1;
        public uint padding2;
    }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static void SendText(string text) {
        INPUT[] inputs = new INPUT[text.Length * 2];
        
        for (int i = 0; i < text.Length; i++) {
            ushort ch = (ushort)text[i];
            
            inputs[i * 2].type = INPUT_KEYBOARD;
            inputs[i * 2].ki.wVk = 0;
            inputs[i * 2].ki.wScan = ch;
            inputs[i * 2].ki.dwFlags = KEYEVENTF_UNICODE;
            
            inputs[i * 2 + 1].type = INPUT_KEYBOARD;
            inputs[i * 2 + 1].ki.wVk = 0;
            inputs[i * 2 + 1].ki.wScan = ch;
            inputs[i * 2 + 1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        }
        
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
"@

[UnicodeInput]::SendText($text)
`;

// 初始化脚本文件
const PS_SCRIPT_PATH = join(SCRIPT_DIR, 'unicode-input.ps1');
writeFileSync(PS_SCRIPT_PATH, PS_UNICODE_SCRIPT, 'utf8');

/**
 * 使用 PowerShell SendInput API 发送 Unicode 文本
 * 这是 Windows 上最可靠的方式，支持任何语言的文字，不使用剪贴板
 */
async function sendUnicodeText(text: string): Promise<void> {
	// 转义双引号和反引号（PowerShell 特殊字符）
	const escapedText = text
		.replace(/`/g, '``') // 反引号转义
		.replace(/"/g, '`"') // 双引号转义
		.replace(/\$/g, '`$'); // $ 符号转义

	await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT_PATH}" -text "${escapedText}"`, {
		encoding: 'utf8',
		windowsHide: true,
	});
}

// 控制库类型
type ControlLib = {
	moveMouse: (x: number, y: number) => Promise<void>;
	click: (x?: number, y?: number, button?: string) => Promise<void>;
	doubleClick: (x?: number, y?: number) => Promise<void>;
	rightClick: (x?: number, y?: number) => Promise<void>;
	scroll: (direction: string, amount: number) => Promise<void>;
	type: (text: string) => Promise<void>;
	key: (key: string) => Promise<void>;
	hotkey: (keys: string[]) => Promise<void>;
	getMousePos: () => Promise<{ x: number; y: number }>;
	getScreenSize: () => Promise<{ width: number; height: number }>;
	// 原始 mouse 对象 (用于校准)
	mouse: {
		setPosition: (pos: { x: number; y: number }) => Promise<unknown>;
		getPosition: () => Promise<{ x: number; y: number }>;
		leftClick: () => Promise<unknown>;
		rightClick: () => Promise<unknown>;
	};
};

// 全局缩放比例缓存
let globalScale: number | null = null;

export class ComputerTool extends BaseTool {
	private lib: ControlLib | null = null;
	private available = false;
	private libName: string = '';

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'computer',
			description: `桌面控制工具，通过坐标操作鼠标键盘。配合 screenshot 工具使用：先截图分析界面，再用坐标点击操作。

重要：coordinate 参数必须是相对坐标 [x, y]，范围是 [0.0, 1.0]。
例如：要点击屏幕中心，应返回 [0.5, 0.5]；要点击左上角，返回 [0.0, 0.0]；要点击右下角，返回 [1.0, 1.0]。
不要返回绝对像素坐标（如 [960, 540]），必须返回相对值！`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: [
						'mouse_move',
						'click',
						'left_click',
						'right_click',
						'double_click',
						'scroll',
						'type',
						'key',
						'hotkey',
						'cursor_position',
					],
				},
			coordinate: {
				type: 'array',
				description: '截图中的相对坐标 [x, y]，范围 [0.0, 1.0]。例如 [0.5, 0.5] 表示屏幕中心，[1.0, 1.0] 表示右下角。工具会自动转换为实际鼠标坐标。',
				items: { type: 'number' },
			},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
				key: {
					type: 'string',
					description: 'key 操作的按键：Enter, Tab, Escape, Space, Backspace, Delete, Up, Down, Left, Right, Home, End, PageUp, PageDown, F1-F12。注意：Windows 键请使用 hotkey 操作',
				},
				keys: {
					type: 'array',
					description: 'hotkey 操作的按键组合，如 ["ctrl","c"]、["win"]（打开开始菜单）、["alt","tab"]',
					items: { type: 'string' },
				},
				delay: {
					type: 'number',
					description: '操作后等待的毫秒数',
				},
				direction: {
					type: 'string',
					description: 'scroll 方向：up, down',
					enum: ['up', 'down'],
				},
				amount: {
					type: 'number',
					description: 'scroll 滚动量',
				},
			},
			...config,
		});

		this.initLib();
	}

	private async initLib(): Promise<void> {
		// 尝试加载 nut.js
		try {
			const nutjs = await import('@nut-tree-fork/nut-js');
			const { mouse, keyboard, screen, Key, Button } = nutjs;

			this.lib = {
				moveMouse: async (x, y) => {
					await mouse.setPosition({ x, y });
				},
				click: async (x, y) => {
					if (x !== undefined && y !== undefined) {
						await mouse.setPosition({ x, y });
					}
					await mouse.leftClick();
				},
				doubleClick: async (x, y) => {
					if (x !== undefined && y !== undefined) {
						await mouse.setPosition({ x, y });
					}
					await mouse.doubleClick(Button.LEFT);
				},
				rightClick: async (x, y) => {
					if (x !== undefined && y !== undefined) {
						await mouse.setPosition({ x, y });
					}
					await mouse.rightClick();
				},
				scroll: async (direction, amount) => {
					const scrollAmount = amount * 100; // nut.js 用像素
					if (direction === 'up') {
						await mouse.scrollUp(scrollAmount);
					} else {
						await mouse.scrollDown(scrollAmount);
					}
				},
				type: async (text) => {
					// 检测是否包含非 ASCII 字符
					const hasNonAscii = /[^\x00-\x7F]/.test(text);
					const platform = process.platform;

					if (hasNonAscii) {
						// 非 ASCII 字符（如中文）需要特殊处理
						if (platform === 'win32') {
							// Windows: 使用 SendInput API 直接发送 Unicode
							await sendUnicodeText(text);
						} else if (platform === 'darwin') {
							// macOS: 使用 AppleScript
							const escapedText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
							await execAsync(
								`osascript -e 'tell application "System Events" to keystroke "${escapedText}"'`
							);
						} else {
							// Linux: 使用 xdotool (需要安装: sudo apt install xdotool)
							const escapedText = text.replace(/'/g, "'\"'\"'");
							await execAsync(`xdotool type --clearmodifiers '${escapedText}'`);
						}
					} else {
						// ASCII 字符使用 nut.js 直接输入（跨平台）
						await keyboard.type(text);
					}
				},
				key: async (keyName) => {
					const keyMap: Record<string, keyof typeof Key> = {
						enter: 'Return',
						return: 'Return',
						tab: 'Tab',
						escape: 'Escape',
						esc: 'Escape',
						space: 'Space',
						backspace: 'Backspace',
						delete: 'Delete',
						up: 'Up',
						down: 'Down',
						left: 'Left',
						right: 'Right',
						home: 'Home',
						end: 'End',
						pageup: 'PageUp',
						pagedown: 'PageDown',
						f1: 'F1',
						f2: 'F2',
						f3: 'F3',
						f4: 'F4',
						f5: 'F5',
						f6: 'F6',
						f7: 'F7',
						f8: 'F8',
						f9: 'F9',
						f10: 'F10',
						f11: 'F11',
						f12: 'F12',
						win: 'LeftSuper',
						cmd: 'LeftSuper',
						super: 'LeftSuper',
						ctrl: 'LeftControl',
						control: 'LeftControl',
						alt: 'LeftAlt',
						shift: 'LeftShift',
					};
					const mapped = keyMap[keyName.toLowerCase()] || keyName;
					const key = Key[mapped as keyof typeof Key];
					if (key !== undefined) {
						await keyboard.pressKey(key);
						await keyboard.releaseKey(key);
					} else {
						throw new Error(`未知的按键: ${keyName}，请使用 hotkey 操作发送组合键，或检查按键名称`);
					}
				},
				hotkey: async (keys) => {
					const keyMap: Record<string, keyof typeof Key> = {
						ctrl: 'LeftControl',
						control: 'LeftControl',
						alt: 'LeftAlt',
						shift: 'LeftShift',
						win: 'LeftSuper',
						windows: 'LeftSuper',
						cmd: 'LeftSuper',
						super: 'LeftSuper',
						enter: 'Return',
						return: 'Return',
						tab: 'Tab',
						escape: 'Escape',
						esc: 'Escape',
						space: 'Space',
						backspace: 'Backspace',
						delete: 'Delete',
					};
	
					const keyObjects: (typeof Key)[keyof typeof Key][] = [];
					const platform = process.platform;
					
					for (const k of keys) {
						const keyLower = k.toLowerCase();
						let mapped = keyMap[keyLower];
						
						// Windows 平台特殊处理 Win 键
						if (!mapped && (keyLower === 'win' || keyLower === 'windows') && platform === 'win32') {
							// 在 Windows 上使用 PowerShell SendInput 发送 Win 键
							this.logger.debug('Windows 平台使用 PowerShell 发送 Win 键');
							await execAsync('powershell -NoProfile -Command "[System.Windows.Forms.SendKeys]::SendWait(\'{LWIN}\')"', {
								windowsHide: true,
							});
							continue;
						}
						
						if (!mapped) {
							mapped = k.toUpperCase() as keyof typeof Key;
						}
						
						const key = Key[mapped as keyof typeof Key];
						if (key !== undefined) {
							keyObjects.push(key);
						} else {
							this.logger.warn(`未知的按键: ${k} (映射: ${mapped})，已跳过`);
						}
					}
	
					// 按下所有键
					for (const key of keyObjects) {
						await keyboard.pressKey(key);
					}
					// 释放所有键（逆序）
					for (const key of [...keyObjects].reverse()) {
						await keyboard.releaseKey(key);
					}
				},
				getMousePos: async () => {
					const pos = await mouse.getPosition();
					return { x: pos.x, y: pos.y };
				},
				getScreenSize: async () => {
					const width = await screen.width();
					const height = await screen.height();
					return { width, height };
				},
				// 保留原始 mouse 对象用于精确校准
				mouse: {
					setPosition: (pos) => mouse.setPosition(pos),
					getPosition: () => mouse.getPosition(),
					leftClick: () => mouse.leftClick(),
					rightClick: () => mouse.rightClick(),
				},
			};

			this.available = true;
			this.libName = 'nut.js';
			this.logger.debug('使用 nut.js 作为控制库');
		} catch {
			this.available = false;
			this.logger.warn('nut.js 未安装，computer 工具不可用。安装: npm install @nut-tree-fork/nut-js');
		}
	}

	/**
	 * 获取屏幕缩放比例
	 * 截图尺寸 / 鼠标坐标系尺寸
	 */
	private async getScale(): Promise<number> {
		// 使用缓存
		if (globalScale !== null) {
			return globalScale;
		}

		try {
			// 获取鼠标坐标系尺寸
			const screenSize = await this.lib!.getScreenSize();

			// 获取截图尺寸
			const screenshotDesktop = (await import('screenshot-desktop')).default;
			const sharp = (await import('sharp')).default;

			const buffer = await screenshotDesktop({ format: 'png' });
			const metadata = await sharp(buffer).metadata();
			const imageWidth = metadata.width || screenSize.width;

			globalScale = imageWidth / screenSize.width;
			this.logger.info(
				`屏幕缩放比例: ${globalScale.toFixed(2)}x (截图: ${imageWidth}px, 鼠标系: ${screenSize.width}px)`
			);

			return globalScale;
		} catch (error) {
			this.logger.warn('获取缩放比例失败，使用默认值 1.0:', error);
			globalScale = 1.0;
			return 1.0;
		}
	}

	/**
	 * 将截图坐标转换为鼠标坐标
	 * 支持绝对坐标和相对坐标（0-1之间）
	 */
	private async convertCoordinate(imageX: number, imageY: number): Promise<{ x: number; y: number }> {
		const scale = await this.getScale();
		
		// 获取屏幕尺寸（鼠标坐标系）
		const screenSize = await this.lib!.getScreenSize();
		
		// 判断是否为相对坐标（0-1之间）
		const isRelativeX = imageX >= 0 && imageX <= 1;
		const isRelativeY = imageY >= 0 && imageY <= 1;
		
		let x: number;
		let y: number;
		
		if (isRelativeX && isRelativeY) {
			// 相对坐标：乘以屏幕尺寸
			x = Math.round(imageX * screenSize.width);
			y = Math.round(imageY * screenSize.height);
			this.logger.debug(`坐标转换(相对): 截图(${imageX}, ${imageY}) → 鼠标(${x}, ${y}) [屏幕: ${screenSize.width}x${screenSize.height}]`);
		} else {
			// 绝对坐标：除以缩放比例
			x = Math.round(imageX / scale);
			y = Math.round(imageY / scale);
			if (scale > 1.01) {
				this.logger.debug(`坐标转换(绝对): 截图(${imageX}, ${imageY}) → 鼠标(${x}, ${y}) [缩放: ${scale.toFixed(2)}x]`);
			}
		}

		return { x, y };
	}

	/**
	 * 生成带点击标记的截图
	 * 在截图上标记点击位置，便于调试
	 * 
	 * @param clickX - AI 提供的相对坐标 x (0-1)
	 * @param clickY - AI 提供的相对坐标 y (0-1)
	 * @param actualX - 实际点击的屏幕坐标 x
	 * @param actualY - 实际点击的屏幕坐标 y
	 * @param action - 点击动作类型
	 */
	private async createMarkedScreenshot(
		clickX: number,
		clickY: number,
		actualX: number,
		actualY: number,
		action: string
	): Promise<string | undefined> {
		try {
			const screenshotDesktop = (await import('screenshot-desktop')).default;
			const sharp = (await import('sharp')).default;
			const { existsSync, mkdirSync } = await import('fs');

			// 截图目录 - 使用项目根目录下的 data 文件夹
			const MARKED_DIR = join(process.cwd(), 'data', 'marked-clicks');
			if (!existsSync(MARKED_DIR)) {
				mkdirSync(MARKED_DIR, { recursive: true });
			}

			// 获取截图
			const buffer = await screenshotDesktop({ format: 'png' });
			const metadata = await sharp(buffer).metadata();
			const width = metadata.width || 1920;
			const height = metadata.height || 1080;

			// 将相对坐标转换为截图上的像素坐标
			// clickX 和 clickY 是 AI 提供的相对坐标 (0-1)
			const pixelX = Math.round(clickX * width);
			const pixelY = Math.round(clickY * height);

			// 创建 SVG 标记
			const markerSize = 30;
			const svg = `
				<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
					<defs>
						<marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
							<path d="M0,0 L10,5 L0,10" fill="#ff0000" />
						</marker>
					</defs>
					
					<!-- 十字准星 -->
					<line x1="${pixelX - markerSize}" y1="${pixelY}" x2="${pixelX + markerSize}" y2="${pixelY}" 
						stroke="#ff0000" stroke-width="3" />
					<line x1="${pixelX}" y1="${pixelY - markerSize}" x2="${pixelX}" y2="${pixelY + markerSize}" 
						stroke="#ff0000" stroke-width="3" />
					
					<!-- 中心点 -->
					<circle cx="${pixelX}" cy="${pixelY}" r="6" fill="#ff0000" />
					<circle cx="${pixelX}" cy="${pixelY}" r="10" fill="none" stroke="#ff0000" stroke-width="2" />
					
					<!-- 标签背景 -->
					<rect x="${pixelX + 15}" y="${pixelY - 35}" width="280" height="50" 
						fill="rgba(255, 0, 0, 0.8)" rx="4" />
					
					<!-- 标签文字 -->
					<text x="${pixelX + 20}" y="${pixelY - 18}" fill="white" font-size="14" font-weight="bold"
						font-family="Arial, sans-serif">${action}</text>
					<text x="${pixelX + 20}" y="${pixelY}" fill="white" font-size="12"
						font-family="Arial, sans-serif">相对: (${clickX.toFixed(3)}, ${clickY.toFixed(3)})</text>
					<text x="${pixelX + 20}" y="${pixelY + 14}" fill="white" font-size="12"
						font-family="Arial, sans-serif">实际: (${actualX}, ${actualY})</text>
				</svg>
			`;

			// 合成图片
			const markedBuffer = await sharp(buffer)
				.composite([{ input: Buffer.from(svg), blend: 'over' }])
				.png()
				.toBuffer();

			// 保存文件
			const filename = `click-${Date.now()}.png`;
			const filepath = join(MARKED_DIR, filename);
			await sharp(markedBuffer).toFile(filepath);

			this.logger.info(`已生成点击标记截图: ${filepath}`);
			// 返回文件名，前端通过 /screenshots/marked-clicks/{filename} 访问
			return filename;
		} catch (error) {
			this.logger.warn('生成点击标记截图失败:', error);
			return undefined;
		}
	}

	/**
	 * 在已有的截图 buffer 上生成带点击标记的截图
	 * 用于点击前生成标记图，让 AI 确认点击位置
	 */
	private async createMarkedScreenshotOnBuffer(
		buffer: Buffer,
		width: number,
		height: number,
		clickX: number,
		clickY: number,
		actualX: number,
		actualY: number,
		action: string
	): Promise<string | undefined> {
		try {
			const sharp = (await import('sharp')).default;
			const { existsSync, mkdirSync } = await import('fs');

			// 截图目录 - 使用项目根目录下的 data 文件夹
			const MARKED_DIR = join(process.cwd(), 'data', 'marked-clicks');
			if (!existsSync(MARKED_DIR)) {
				mkdirSync(MARKED_DIR, { recursive: true });
			}

			// 将相对坐标转换为截图上的像素坐标
			// clickX 和 clickY 是 AI 提供的相对坐标 (0-1)
			const pixelX = Math.round(clickX * width);
			const pixelY = Math.round(clickY * height);

			// 创建 SVG 标记
			const markerSize = 30;
			const svg = `
				<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
					<defs>
						<marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
							<path d="M0,0 L10,5 L0,10" fill="#ff0000" />
						</marker>
					</defs>
					
					<!-- 十字准星 -->
					<line x1="${pixelX - markerSize}" y1="${pixelY}" x2="${pixelX + markerSize}" y2="${pixelY}" 
						stroke="#ff0000" stroke-width="3" />
					<line x1="${pixelX}" y1="${pixelY - markerSize}" x2="${pixelX}" y2="${pixelY + markerSize}" 
						stroke="#ff0000" stroke-width="3" />
					
					<!-- 中心点 -->
					<circle cx="${pixelX}" cy="${pixelY}" r="6" fill="#ff0000" />
					<circle cx="${pixelX}" cy="${pixelY}" r="10" fill="none" stroke="#ff0000" stroke-width="2" />
					
					<!-- 标签背景 -->
					<rect x="${pixelX + 15}" y="${pixelY - 35}" width="280" height="50" 
						fill="rgba(255, 0, 0, 0.8)" rx="4" />
					
					<!-- 标签文字 -->
					<text x="${pixelX + 20}" y="${pixelY - 18}" fill="white" font-size="14" font-weight="bold"
						font-family="Arial, sans-serif">${action}</text>
					<text x="${pixelX + 20}" y="${pixelY}" fill="white" font-size="12"
						font-family="Arial, sans-serif">相对: (${clickX.toFixed(3)}, ${clickY.toFixed(3)})</text>
					<text x="${pixelX + 20}" y="${pixelY + 14}" fill="white" font-size="12"
						font-family="Arial, sans-serif">实际: (${actualX}, ${actualY})</text>
				</svg>
			`;

			// 合成图片
			const markedBuffer = await sharp(buffer)
				.composite([{ input: Buffer.from(svg), blend: 'over' }])
				.png()
				.toBuffer();

			// 保存文件
			const filename = `click-${Date.now()}.png`;
			const filepath = join(MARKED_DIR, filename);
			await sharp(markedBuffer).toFile(filepath);

			this.logger.info(`已生成点击标记截图(点击前): ${filepath}`);
			// 返回文件名，前端通过 /screenshots/marked-clicks/{filename} 访问
			return filename;
		} catch (error) {
			this.logger.warn('生成点击标记截图失败:', error);
			return undefined;
		}
	}

	/**
	 * 截图并返回 base64（用于 click 等操作后自动截图）
	 */
	private async captureScreenshot(): Promise<{
		success: boolean;
		base64?: string;
		format?: string;
		imageSize?: { width: number; height: number };
		error?: string;
	}> {
		try {
			const screenshotDesktop = (await import('screenshot-desktop')).default;
			const sharp = (await import('sharp')).default;

			// 截图
			const buffer = await screenshotDesktop({ format: 'png' });
			
			// 压缩为 JPEG 以减少传输大小
			const compressedBuffer = await sharp(buffer)
				.jpeg({ quality: 70 })
				.toBuffer();
			
			const metadata = await sharp(compressedBuffer).metadata();
			
			return {
				success: true,
				base64: compressedBuffer.toString('base64'),
				format: 'jpeg',
				imageSize: { 
					width: metadata.width || 1920, 
					height: metadata.height || 1080 
				},
			};
		} catch (error) {
			this.logger.warn('自动截图失败:', error);
			return {
				success: false,
				error: String(error),
			};
		}
	}

	/**
	 * 校准移动鼠标到精确位置
	 * nut.js 的 setPosition 有偏差，通过循环校准解决
	 */
	private async calibratedMove(targetX: number, targetY: number): Promise<{ x: number; y: number }> {
		const mouse = this.lib!.mouse;

		for (let i = 0; i < 5; i++) {
			const pos = await mouse.getPosition();
			const diffX = targetX - pos.x;
			const diffY = targetY - pos.y;

			// 偏差小于等于 2 像素，认为已精确
			if (Math.abs(diffX) <= 2 && Math.abs(diffY) <= 2) {
				this.logger.debug(`校准完成: 第${i + 1}次, 位置(${pos.x}, ${pos.y})`);
				return pos;
			}

			// 调整位置
			await mouse.setPosition({ x: pos.x + diffX, y: pos.y + diffY });
			await new Promise((r) => setTimeout(r, 30));
		}

		// 返回最终位置
		const finalPos = await mouse.getPosition();
		this.logger.debug(`校准结束: 最终位置(${finalPos.x}, ${finalPos.y}), 目标(${targetX}, ${targetY})`);
		return finalPos;
	}

	async execute(
		params: {
			action: string;
			coordinate?: [number, number];
			text?: string;
			key?: string;
			keys?: string[];
			direction?: string;
			amount?: number;
			delay?: number;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		if (!this.available || !this.lib) {
			throw new Error('computer 工具不可用。请安装: npm install @nut-tree-fork/nut-js');
		}

		const {
			action,
			coordinate,
			text,
			key,
			keys,
			direction,
			amount = 3,
			delay = 0,
		} = params;

		// 辅助函数：执行后等待
		const withDelay = async <T>(result: T): Promise<T> => {
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
				this.logger.debug(`等待 ${delay}ms`);
			}
			return result;
		};

		switch (action) {
		case 'mouse_move': {
			if (!coordinate || coordinate.length !== 2) {
				throw new Error('mouse_move 需要 coordinate 参数，格式: [x, y]');
			}
			const [imgX, imgY] = coordinate;
			const scale = await this.getScale();
			const { x, y } = await this.convertCoordinate(imgX, imgY);
			const finalPos = await this.calibratedMove(x, y);
			this.logger.debug(`鼠标移动到: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);
			
			// 获取屏幕信息用于调试
			const screenSize = await this.lib.getScreenSize();
			
			return withDelay({
				success: true,
				action: 'mouse_move',
				imageCoordinate: { x: imgX, y: imgY },
				convertedCoordinate: { x, y },
				actualCoordinate: finalPos,
				scale: scale,
				screenSize: screenSize,
			});
		}

		case 'click':
		case 'left_click': {
			if (coordinate && coordinate.length === 2) {
				const [imgX, imgY] = coordinate;
				const scale = await this.getScale();
				const { x, y } = await this.convertCoordinate(imgX, imgY);
				
				// 【关键】先截图（点击前），用于生成标记图让 AI 确认点击位置
				const screenshotDesktop = (await import('screenshot-desktop')).default;
				const sharp = (await import('sharp')).default;
				const preClickBuffer = await screenshotDesktop({ format: 'png' });
				const metadata = await sharp(preClickBuffer).metadata();
				const width = metadata.width || 1920;
				const height = metadata.height || 1080;
				
				// 在点击前的截图上生成标记图
				const markedImage = await this.createMarkedScreenshotOnBuffer(
					preClickBuffer, width, height, imgX, imgY, x, y, 'left_click'
				);
				
				const finalPos = await this.calibratedMove(x, y);
				// 增加延迟，确保鼠标移动完成后再点击
				await new Promise(r => setTimeout(r, 100));
				await this.lib.mouse.leftClick();
				this.logger.debug(`左键点击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);

				// 【关键】等待界面响应（优先使用用户传入的 delay）
				const waitTime = delay > 0 ? delay : 500;
				await new Promise(r => setTimeout(r, waitTime));

				// 自动截图返回给 AI（点击后）
				const screenshotResult = await this.captureScreenshot();

				// 获取屏幕信息用于调试
				const screenSize = await this.lib.getScreenSize();

				return withDelay({
					success: true,
					action: 'left_click',
					imageCoordinate: { x: imgX, y: imgY },
					convertedCoordinate: { x, y },
					actualCoordinate: finalPos,
					scale: scale,
					screenSize: screenSize,
					markedScreenshot: markedImage, // 这是点击前的标记图
					// 包含截图结果，让 AI 直接看到点击后的界面
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已在坐标 (${imgX.toFixed(3)}, ${imgY.toFixed(3)}) 执行左键点击。标记图显示的是点击前的界面状态，当前屏幕截图已返回，请分析点击后的界面状态。`,
				});
			} else {
				await this.lib.mouse.leftClick();
				this.logger.debug(`左键点击: 当前位置`);
				return withDelay({ success: true, action: 'left_click', coordinate: 'current' });
			}
		}

		case 'right_click': {
			if (coordinate && coordinate.length === 2) {
				const [imgX, imgY] = coordinate;
				const scale = await this.getScale();
				const { x, y } = await this.convertCoordinate(imgX, imgY);
				const finalPos = await this.calibratedMove(x, y);
				await this.lib.mouse.rightClick();
				this.logger.debug(`右键点击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);

				// 【关键】等待界面响应
				const waitTime = delay > 0 ? delay : 500;
				await new Promise(r => setTimeout(r, waitTime));

				// 自动截图返回给 AI
				const screenshotResult = await this.captureScreenshot();

				// 生成带标记的截图
				const markedImage = await this.createMarkedScreenshot(imgX, imgY, finalPos.x, finalPos.y, 'right_click');

				// 获取屏幕信息用于调试
				const screenSize = await this.lib.getScreenSize();

				return withDelay({
					success: true,
					action: 'right_click',
					imageCoordinate: { x: imgX, y: imgY },
					convertedCoordinate: { x, y },
					actualCoordinate: finalPos,
					scale: scale,
					screenSize: screenSize,
					markedScreenshot: markedImage,
					// 包含截图结果，让 AI 直接看到右键点击后的界面
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已在坐标 (${imgX.toFixed(3)}, ${imgY.toFixed(3)}) 执行右键点击，当前屏幕截图已返回，请分析右键菜单是否出现。`,
				});
			} else {
				await this.lib.mouse.rightClick();
				this.logger.debug(`右键点击: 当前位置`);
				return withDelay({ success: true, action: 'right_click', coordinate: 'current' });
			}
		}

		case 'double_click': {
			if (coordinate && coordinate.length === 2) {
				const [imgX, imgY] = coordinate;
				const scale = await this.getScale();
				const { x, y } = await this.convertCoordinate(imgX, imgY);
				const finalPos = await this.calibratedMove(x, y);
				await this.lib.mouse.leftClick();
				await new Promise((r) => setTimeout(r, 50));
				await this.lib.mouse.leftClick();
				this.logger.debug(`双击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);

				// 【关键】等待界面响应（双击打开应用需要时间，优先使用用户传入的 delay）
				const waitTime = delay > 0 ? delay : 800;
				await new Promise(r => setTimeout(r, waitTime));

				// 自动截图返回给 AI
				const screenshotResult = await this.captureScreenshot();

				// 生成带标记的截图
				const markedImage = await this.createMarkedScreenshot(imgX, imgY, finalPos.x, finalPos.y, 'double_click');

				// 获取屏幕信息用于调试
				const screenSize = await this.lib.getScreenSize();

				return withDelay({
					success: true,
					action: 'double_click',
					imageCoordinate: { x: imgX, y: imgY },
					convertedCoordinate: { x, y },
					actualCoordinate: finalPos,
					scale: scale,
					screenSize: screenSize,
					markedScreenshot: markedImage,
					// 包含截图结果，让 AI 直接看到双击后的界面
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已在坐标 (${imgX.toFixed(3)}, ${imgY.toFixed(3)}) 执行双击操作，当前屏幕截图已返回，请分析双击后的界面状态（如应用是否已打开）。`,
				});
			} else {
				await this.lib.doubleClick();
				this.logger.debug(`双击: 当前位置`);
				return withDelay({ success: true, action: 'double_click', coordinate: 'current' });
			}
		}

			case 'scroll': {
				const dir = direction || 'down';
				await this.lib.scroll(dir, amount);
				this.logger.debug(`滚动: ${dir} ${amount}`);
				return withDelay({ success: true, action: 'scroll', direction: dir, amount });
			}

			case 'type': {
				if (!text) {
					throw new Error('type 操作需要 text 参数');
				}
				await this.lib.type(text);
				this.logger.debug(`输入文本: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
				
				// 【关键】等待界面响应
				const waitTime = delay > 0 ? delay : 500;
				await new Promise(r => setTimeout(r, waitTime));
				
				// 自动截图返回给 AI
				const screenshotResult = await this.captureScreenshot();
				
				return withDelay({
					success: true,
					action: 'type',
					text,
					// 包含截图结果
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已输入文本"${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"，当前屏幕截图已返回，请分析输入后的界面状态。`,
				});
			}

			case 'key': {
				if (!key) {
					throw new Error('key 操作需要 key 参数');
				}
				await this.lib.key(key);
				this.logger.debug(`按键: ${key}`);
				
				// 【关键】等待界面响应
				const waitTime = delay > 0 ? delay : 500;
				await new Promise(r => setTimeout(r, waitTime));
				
				// 自动截图返回给 AI
				const screenshotResult = await this.captureScreenshot();
				
				return withDelay({
					success: true,
					action: 'key',
					key,
					// 包含截图结果
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已执行按键 ${key}，当前屏幕截图已返回，请分析按键后的界面状态。`,
				});
			}

			case 'hotkey': {
				if (!keys || keys.length === 0) {
					throw new Error('hotkey 操作需要 keys 参数，例如 ["ctrl", "c"]');
				}
				await this.lib.hotkey(keys);
				this.logger.debug(`快捷键: ${keys.join('+')}`);
				
				// 【关键】等待界面响应
				const waitTime = delay > 0 ? delay : 500;
				await new Promise(r => setTimeout(r, waitTime));
				
				// 自动截图返回给 AI，让 AI 看到按键后的界面状态
				const screenshotResult = await this.captureScreenshot();
				
				return withDelay({
					success: true,
					action: 'hotkey',
					keys,
					// 包含截图结果，让 AI 直接看到按键后的界面
					screenshot: screenshotResult.success ? {
						base64: screenshotResult.base64,
						format: screenshotResult.format,
						imageSize: screenshotResult.imageSize,
					} : undefined,
					message: `已执行快捷键 ${keys.join('+')}，当前屏幕截图已返回，请分析按键后的界面状态。`,
				});
			}

			case 'cursor_position': {
				const pos = await this.lib.getMousePos();
				this.logger.debug(`鼠标位置: (${pos.x}, ${pos.y})`);
				return withDelay({ success: true, action: 'cursor_position', coordinate: pos });
			}

			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	async cleanup(): Promise<void> {
		// 无需清理
	}
}

export default ComputerTool;
