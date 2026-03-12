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

// ============================================================================
// UI Automation (精确获取桌面元素)
// ============================================================================

interface UIElement {
	name: string;
	type: string;
	bbox: [number, number, number, number]; // [x, y, width, height]
	center: [number, number]; // 点击中心坐标
	automationId?: string;
}

// Windows UI Automation PowerShell 脚本
const UI_AUTOMATION_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient

function Get-UIElements {
    param(
        [System.Windows.Automation.AutomationElement]$element,
        [int]$depth = 0,
        [int]$maxDepth = 4
    )
    
    $results = @()
    
    try {
        $rect = $element.Current.BoundingRectangle
        $ctrlType = $element.Current.ControlType.ProgrammaticName -replace 'ControlType\\.', ''
        
        # 只收集可交互的元素类型
        $interactiveTypes = @('Button', 'MenuItem', 'ListItem', 'TreeItem', 'TabItem', 'Hyperlink', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'Text')
        
        if ($rect.Width -gt 5 -and $rect.Height -gt 5 -and $rect.X -ge -100 -and $rect.Y -ge -100) {
            # 收集所有有效元素，但标记是否可交互
            $isInteractive = $interactiveTypes -contains $ctrlType -or $element.Current.Name.Length -gt 0
            
            if ($isInteractive) {
                $obj = [PSCustomObject]@{
                    Name = $element.Current.Name
                    Type = $ctrlType
                    X = [int]$rect.X
                    Y = [int]$rect.Y
                    Width = [int]$rect.Width
                    Height = [int]$rect.Height
                    AutomationId = $element.Current.AutomationId
                }
                $results += $obj
            }
        }
        
        if ($depth -lt $maxDepth) {
            $children = $null
            try { $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) } catch {}
            if ($children) {
                foreach ($child in $children) {
                    $childResults = Get-UIElements -element $child -depth ($depth + 1) -maxDepth $maxDepth
                    $results += $childResults
                }
            }
        }
    } catch {}
    
    return $results
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$allElements = @()

foreach ($window in $windows) {
    try {
        $rect = $window.Current.BoundingRectangle
        if ($rect.Width -gt 50 -and $rect.Height -gt 50 -and $rect.X -gt -5000) {
            $windowElements = Get-UIElements -element $window -depth 0 -maxDepth 4
            $allElements += $windowElements
        }
    } catch {}
}

$json = $allElements | ConvertTo-Json -Depth 10 -Compress
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $json
`;

// 初始化 UI Automation 脚本
const UI_AUTOMATION_SCRIPT_PATH = join(SCRIPT_DIR, 'ui-automation.ps1');

// 尝试安全的文件写入，支持重试机制
try {
    writeFileSync(UI_AUTOMATION_SCRIPT_PATH, UI_AUTOMATION_SCRIPT, 'utf8');
} catch (writeError: any) {
    if (writeError.code === 'EBUSY' || writeError.code === 'EACCES') {
        // 文件被占用或权限问题，等待后重试
        await new Promise(resolve => setTimeout(resolve, 200));
        try {
            writeFileSync(UI_AUTOMATION_SCRIPT_PATH, UI_AUTOMATION_SCRIPT, 'utf8');
        } catch (retryError) {
            // 重试失败，使用临时文件名
            const tempPath = UI_AUTOMATION_SCRIPT_PATH + '.tmp';
            writeFileSync(tempPath, UI_AUTOMATION_SCRIPT, 'utf8');
            // 注意：后续使用 tempPath 替代 UI_AUTOMATION_SCRIPT_PATH
        }
    } else {
        throw writeError;
    }
}

/**
 * 获取屏幕上的 UI 元素（Windows 使用 UI Automation）
 */
async function getUIElements(): Promise<UIElement[]> {
	const platform = process.platform;

	if (platform === 'win32') {
		return getWindowsUIElements();
	} else if (platform === 'darwin') {
		return getMacOSUIElements();
	} else if (platform === 'linux') {
		return getLinuxUIElements();
	} else {
		return [];
	}
}

async function getWindowsUIElements(): Promise<UIElement[]> {
	try {
		const { stdout } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${UI_AUTOMATION_SCRIPT_PATH}"`, {
			maxBuffer: 50 * 1024 * 1024,
			timeout: 30000,
			encoding: 'utf8',
		});

		const data = JSON.parse(stdout);
		const rawElements = Array.isArray(data) ? data : [data];

		// 转换并计算点击中心
		return rawElements
			.filter((e: Record<string, unknown>) => e && (e.Width as number) > 0 && (e.Height as number) > 0)
			.map((e: Record<string, unknown>) => ({
				name: (e.Name as string) || '',
				type: ((e.Type as string) || 'Unknown').replace('ControlType.', ''),
				bbox: [e.X, e.Y, e.Width, e.Height] as [number, number, number, number],
				center: [
					Math.round((e.X as number) + (e.Width as number) / 2),
					Math.round((e.Y as number) + (e.Height as number) / 2),
				] as [number, number],
				automationId: e.AutomationId as string,
			}));
	} catch (error) {
		console.error('UI Automation 失败:', error);
		return [];
	}
}

// macOS Accessibility API 脚本
const MACOS_ACCESSIBILITY_SCRIPT = `
on run
    set output to "["
    set isFirst to true
    
    tell application "System Events"
        -- 获取所有可见进程
        set visibleProcesses to every process whose visible is true
        
        repeat with proc in visibleProcesses
            try
                set procName to name of proc
                
                -- 遍历每个窗口
                repeat with win in (every window of proc)
                    try
                        set winName to name of win
                        set winPos to position of win
                        set winSize to size of win
                        
                        if not isFirst then set output to output & ","
                        set isFirst to false
                        
                        set output to output & "{\\"name\\":\\"" & winName & "\\",\\"type\\":\\"Window\\",\\"x\\":" & (item 1 of winPos) & ",\\"y\\":" & (item 2 of winPos) & ",\\"width\\":" & (item 1 of winSize) & ",\\"height\\":" & (item 2 of winSize) & "}"
                        
                        -- 遍历窗口内的 UI 元素
                        repeat with elem in (every UI element of win)
                            try
                                set elemName to ""
                                try
                                    set elemName to name of elem
                                end try
                                set elemRole to role of elem
                                set elemPos to position of elem
                                set elemSize to size of elem
                                
                                if elemName is not "" or elemRole is in {"AXButton", "AXTextField", "AXStaticText", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuItem"} then
                                    set output to output & ",{\\"name\\":\\"" & elemName & "\\",\\"type\\":\\"" & elemRole & "\\",\\"x\\":" & (item 1 of elemPos) & ",\\"y\\":" & (item 2 of elemPos) & ",\\"width\\":" & (item 1 of elemSize) & ",\\"height\\":" & (item 2 of elemSize) & "}"
                                end if
                            end try
                        end repeat
                    end try
                end repeat
            end try
        end repeat
        
        -- 获取菜单栏元素
        try
            repeat with menuItem in (every menu bar item of menu bar 1 of process 1)
                try
                    set menuName to name of menuItem
                    set menuPos to position of menuItem
                    set menuSize to size of menuItem
                    
                    if not isFirst then set output to output & ","
                    set isFirst to false
                    
                    set output to output & ",{\\"name\\":\\"" & menuName & "\\",\\"type\\":\\"MenuBarItem\\",\\"x\\":" & (item 1 of menuPos) & ",\\"y\\":" & (item 2 of menuPos) & ",\\"width\\":" & (item 1 of menuSize) & ",\\"height\\":" & (item 2 of menuSize) & "}"
                end try
            end repeat
        end try
    end tell
    
    set output to output & "]"
    return output
end run
`;

async function getMacOSUIElements(): Promise<UIElement[]> {
	try {
		// 写入临时脚本文件
		const scriptPath = join(SCRIPT_DIR, 'ui-elements.scpt');
		writeFileSync(scriptPath, MACOS_ACCESSIBILITY_SCRIPT, 'utf8');

		const { stdout } = await execAsync(`osascript "${scriptPath}"`, { timeout: 30000, encoding: 'utf8' });

		const data = JSON.parse(stdout);
		return data.map((e: Record<string, unknown>) => ({
			name: (e.name as string) || '',
			type: ((e.type as string) || '').replace('AX', ''),
			bbox: [e.x, e.y, e.width, e.height] as [number, number, number, number],
			center: [
				Math.round((e.x as number) + (e.width as number) / 2),
				Math.round((e.y as number) + (e.height as number) / 2),
			] as [number, number],
		}));
	} catch (error) {
		console.error('macOS Accessibility 失败:', error);
		return [];
	}
}

// Linux AT-SPI2 Python 脚本
const LINUX_ATSPI_SCRIPT = `
import json
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

def get_elements(obj, depth=0, max_depth=3):
    elements = []
    try:
        comp = obj.get_component_iface()
        if comp:
            rect = comp.get_extents(Atspi.CoordType.SCREEN)
            name = obj.get_name() or ''
            role = obj.get_role_name() or ''
            
            # 只收集有效元素
            if rect.width > 5 and rect.height > 5 and (name or role in ['push button', 'text', 'entry', 'menu item', 'check box', 'radio button']):
                elements.append({
                    'name': name,
                    'type': role.replace(' ', '').title(),
                    'x': rect.x,
                    'y': rect.y,
                    'width': rect.width,
                    'height': rect.height
                })
        
        if depth < max_depth:
            for i in range(obj.get_child_count()):
                child = obj.get_child_at_index(i)
                if child:
                    elements.extend(get_elements(child, depth + 1, max_depth))
    except:
        pass
    return elements

desktop = Atspi.get_desktop(0)
all_elements = []

for i in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(i)
    if app:
        all_elements.extend(get_elements(app, 0, 4))

print(json.dumps(all_elements))
`;

async function getLinuxUIElements(): Promise<UIElement[]> {
	try {
		// 写入临时脚本文件
		const scriptPath = join(SCRIPT_DIR, 'ui-elements.py');
		writeFileSync(scriptPath, LINUX_ATSPI_SCRIPT, 'utf8');

		const { stdout } = await execAsync(`python3 "${scriptPath}"`, { timeout: 30000, encoding: 'utf8' });

		const data = JSON.parse(stdout);
		return data.map((e: Record<string, unknown>) => ({
			name: (e.name as string) || '',
			type: (e.type as string) || '',
			bbox: [e.x, e.y, e.width, e.height] as [number, number, number, number],
			center: [
				Math.round((e.x as number) + (e.width as number) / 2),
				Math.round((e.y as number) + (e.height as number) / 2),
			] as [number, number],
		}));
	} catch (error) {
		console.error('Linux AT-SPI2 失败:', error);
		// 可能是未安装依赖
		console.error('请安装: sudo apt install python3-gi gir1.2-atspi-2.0');
		return [];
	}
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
						'left_click',
						'right_click',
						'double_click',
						'scroll',
						'type',
						'key',
						'hotkey',
						'cursor_position',
						'list_elements',
						'click_element',
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
				element_name: {
					type: 'string',
					description: 'click_element 的目标元素名称，支持部分匹配',
				},
				filter_type: {
					type: 'string',
					description: 'list_elements 过滤类型：all, buttons, text, taskbar',
					enum: ['all', 'buttons', 'text', 'taskbar'],
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
			element_name?: string;
			filter_type?: string;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		// list_elements 和 click_element 不需要 nut.js
		if (params.action !== 'list_elements' && params.action !== 'click_element') {
			if (!this.available || !this.lib) {
				throw new Error('computer 工具不可用。请安装: npm install @nut-tree-fork/nut-js');
			}
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
			element_name,
			filter_type = 'all',
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

			case 'list_elements': {
				// 获取屏幕上所有可交互元素
				this.logger.info('正在获取屏幕元素...');
				const startTime = Date.now();
				let elements = await getUIElements();
				const elapsed = Date.now() - startTime;

				// 获取屏幕缩放比例并转换坐标
				const scale = await this.getScale();
				elements = elements.map((el) => ({
					...el,
					bbox: [
						Math.round(el.bbox[0] / scale),
						Math.round(el.bbox[1] / scale),
						Math.round(el.bbox[2] / scale),
						Math.round(el.bbox[3] / scale),
					] as [number, number, number, number],
					center: [Math.round(el.center[0] / scale), Math.round(el.center[1] / scale)] as [number, number],
				}));

				// 过滤元素
				if (filter_type === 'buttons') {
					elements = elements.filter((e) => ['Button', 'MenuItem', 'Hyperlink'].includes(e.type));
				} else if (filter_type === 'text') {
					elements = elements.filter((e) => ['Edit', 'Text', 'Document'].includes(e.type));
				} else if (filter_type === 'taskbar') {
					// 任务栏元素通常在屏幕底部
					const screenSize = (await this.lib?.getScreenSize()) || { height: 1080 };
					elements = elements.filter((e) => e.bbox[1] > screenSize.height - 100);
				}

				// 过滤掉空名称和超大元素
				elements = elements.filter((e) => e.name.trim().length > 0 && e.bbox[2] < 2000 && e.bbox[3] < 1500);

				this.logger.info(`获取到 ${elements.length} 个可交互元素 (${elapsed}ms)`);

				// 返回简化的元素列表供 AI 选择
				const simplifiedElements = elements.map((e) => ({
					name: e.name.slice(0, 50), // 截断长名称
					type: e.type,
					center: e.center, // 点击中心坐标
					size: [e.bbox[2], e.bbox[3]],
				}));

				return {
					success: true,
					action: 'list_elements',
					count: elements.length,
					elements: simplifiedElements,
					hint: '使用 click_element 操作并指定 element_name 来点击目标元素，或使用 left_click 操作并指定元素的 center 坐标',
				};
			}

			case 'click_element': {
				if (!element_name) {
					throw new Error('click_element 操作需要 element_name 参数');
				}

				// 获取元素列表
				this.logger.info(`正在查找元素: "${element_name}"`);
				let elements = await getUIElements();

				// 获取屏幕缩放比例并转换坐标
				const scale = await this.getScale();
				elements = elements.map((el) => ({
					...el,
					center: [Math.round(el.center[0] / scale), Math.round(el.center[1] / scale)] as [number, number],
				}));

				// 模糊匹配元素名称
				const searchTerm = element_name.toLowerCase();
				const matchedElements = elements.filter(
					(e) =>
						e.name.toLowerCase().includes(searchTerm) ||
						(e.automationId && e.automationId.toLowerCase().includes(searchTerm))
				);

				if (matchedElements.length === 0) {
					return {
						success: false,
						action: 'click_element',
						error: `未找到名称包含 "${element_name}" 的元素`,
						suggestion: '请使用 list_elements 查看可用元素列表',
					};
				}

				// 返回匹配的元素列表，让 AI 自己判断点击哪个
				// 不进行优先级排序，保留所有匹配元素供 AI 决策
				const sortedElements = matchedElements.sort((a, b) => a.name.length - b.name.length);

				// 如果有多个匹配，返回第一个（最短名称，通常是最精确的匹配）
				const targetElement = sortedElements[0];
				const [clickX, clickY] = targetElement.center;

				this.logger.info(
					`找到元素: "${targetElement.name}" (${targetElement.type}), 点击 (${clickX}, ${clickY})`
				);

				// 确保 lib 可用
				if (!this.lib) {
					throw new Error('computer 工具不可用');
				}

				// 点击元素中心
				const finalPos = await this.calibratedMove(clickX, clickY);
				await this.lib.mouse.leftClick();

				return withDelay({
					success: true,
					action: 'click_element',
					element: {
						name: targetElement.name,
						type: targetElement.type,
						center: targetElement.center,
					},
					actualCoordinate: finalPos,
					matchedCount: matchedElements.length,
				});
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
