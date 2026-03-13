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
			description: `桌面控制工具，通过坐标操作鼠标键盘。配合 screenshot 工具使用：先截图分析界面，再用坐标点击操作。`,
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
					description: '截图中的像素坐标 [x, y]，工具会自动处理屏幕缩放',
					items: { type: 'number' },
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
				key: {
					type: 'string',
					description: 'key 操作的按键：Enter, Tab, Escape, F1-F12, Up, Down, Left, Right',
				},
				keys: {
					type: 'array',
					description: 'hotkey 操作的按键组合，如 ["ctrl","c"]',
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
					};
					const mapped = keyMap[keyName.toLowerCase()] || keyName;
					const key = Key[mapped as keyof typeof Key];
					if (key !== undefined) {
						await keyboard.pressKey(key);
						await keyboard.releaseKey(key);
					}
				},
				hotkey: async (keys) => {
					const keyMap: Record<string, keyof typeof Key> = {
						ctrl: 'LeftControl',
						control: 'LeftControl',
						alt: 'LeftAlt',
						shift: 'LeftShift',
						win: 'LeftSuper',
						cmd: 'LeftSuper',
						super: 'LeftSuper',
						enter: 'Return',
						tab: 'Tab',
						escape: 'Escape',
						space: 'Space',
						backspace: 'Backspace',
						delete: 'Delete',
					};

					const keyObjects: (typeof Key)[keyof typeof Key][] = [];
					for (const k of keys) {
						const mapped = keyMap[k.toLowerCase()] || k.toUpperCase();
						const key = Key[mapped as keyof typeof Key];
						if (key !== undefined) {
							keyObjects.push(key);
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
	 */
	private async convertCoordinate(imageX: number, imageY: number): Promise<{ x: number; y: number }> {
		const scale = await this.getScale();
		const x = Math.round(imageX / scale);
		const y = Math.round(imageY / scale);

		if (scale > 1.01) {
			this.logger.debug(`坐标转换: 截图(${imageX}, ${imageY}) → 鼠标(${x}, ${y})`);
		}

		return { x, y };
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
				const { x, y } = await this.convertCoordinate(imgX, imgY);
				const finalPos = await this.calibratedMove(x, y);
				this.logger.debug(`鼠标移动到: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);
				return withDelay({
					success: true,
					action: 'mouse_move',
					imageCoordinate: { x: imgX, y: imgY },
					actualCoordinate: finalPos,
				});
			}

			case 'click':
			case 'left_click': {
				if (coordinate && coordinate.length === 2) {
					const [imgX, imgY] = coordinate;
					const { x, y } = await this.convertCoordinate(imgX, imgY);
					const finalPos = await this.calibratedMove(x, y);
					await this.lib.mouse.leftClick();
					this.logger.debug(`左键点击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);
					return withDelay({
						success: true,
						action: 'left_click',
						imageCoordinate: { x: imgX, y: imgY },
						actualCoordinate: finalPos,
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
					const { x, y } = await this.convertCoordinate(imgX, imgY);
					const finalPos = await this.calibratedMove(x, y);
					await this.lib.mouse.rightClick();
					this.logger.debug(`右键点击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);
					return withDelay({
						success: true,
						action: 'right_click',
						imageCoordinate: { x: imgX, y: imgY },
						actualCoordinate: finalPos,
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
					const { x, y } = await this.convertCoordinate(imgX, imgY);
					const finalPos = await this.calibratedMove(x, y);
					await this.lib.mouse.leftClick();
					await new Promise((r) => setTimeout(r, 50));
					await this.lib.mouse.leftClick();
					this.logger.debug(`双击: 截图(${imgX}, ${imgY}) → 实际(${finalPos.x}, ${finalPos.y})`);
					return withDelay({
						success: true,
						action: 'double_click',
						imageCoordinate: { x: imgX, y: imgY },
						actualCoordinate: finalPos,
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
				return withDelay({ success: true, action: 'type', text });
			}

			case 'key': {
				if (!key) {
					throw new Error('key 操作需要 key 参数');
				}
				await this.lib.key(key);
				this.logger.debug(`按键: ${key}`);
				return withDelay({ success: true, action: 'key', key });
			}

			case 'hotkey': {
				if (!keys || keys.length === 0) {
					throw new Error('hotkey 操作需要 keys 参数，例如 ["ctrl", "c"]');
				}
				await this.lib.hotkey(keys);
				this.logger.debug(`快捷键: ${keys.join('+')}`);
				return withDelay({ success: true, action: 'hotkey', keys });
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
