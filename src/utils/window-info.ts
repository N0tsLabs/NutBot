/**
 * 窗口信息获取模块
 * 使用 Windows UI Automation API 获取屏幕上的元素树
 * 包括任务栏图标、应用窗口、系统托盘等
 */

import { execFile } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

const loggerInstance = logger.child('WindowInfo');

const TEMP_DIR = join(process.cwd(), 'data', 'temp');
if (!existsSync(TEMP_DIR)) {
	mkdirSync(TEMP_DIR, { recursive: true });
}

export interface WindowInfo {
	title: string;
	left: number;
	top: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
}

export interface UIElement {
	name: string;
	type: string;
	className?: string;
	left: number;
	top: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
	isTaskbar?: boolean;
	isTrayIcon?: boolean;
}

export interface WindowInfoResult {
	success: boolean;
	windows: WindowInfo[];
	taskbarWindows: WindowInfo[];
	elements: UIElement[]; // 新增：完整的 UI 元素树
	taskbarElements: UIElement[]; // 新增：任务栏元素（包括系统托盘）
	screenWidth: number;
	screenHeight: number;
	message?: string;
}

/**
 * 执行 PowerShell 脚本
 */
async function runPowerShell(script: string, timeout = 30000): Promise<any> {
	const scriptPath = join(TEMP_DIR, `window-info-${Date.now()}.ps1`);

	// 添加 UTF-8 编码设置
	const preamble = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
`;
	const fullScript = preamble + script;

	// 写入脚本文件 (带 BOM)
	const bomBuffer = Buffer.from([0xEF, 0xBB, 0xBF]);
	const contentBuffer = Buffer.from(fullScript, 'utf8');
	writeFileSync(scriptPath, Buffer.concat([bomBuffer, contentBuffer]));

	try {
		const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
			const child = execFile('powershell.exe', [
				'-NoProfile',
				'-ExecutionPolicy', 'Bypass',
				'-File', scriptPath
			], {
				timeout,
				maxBuffer: 50 * 1024 * 1024,
				windowsHide: true,
				encoding: 'utf8'
			}, (err, stdout, stderr) => {
				if (err) {
					reject(err);
					return;
				}
				resolve({ stdout });
			});
		});

		return JSON.parse(stdout);
	} finally {
		setTimeout(() => {
			try { unlinkSync(scriptPath); } catch {}
		}, 1000);
	}
}

/**
 * 获取屏幕上的所有 UI 元素信息
 * 使用 Windows UI Automation API
 */
export async function getWindowInfo(): Promise<WindowInfoResult> {
	try {
		// 1. 获取所有 UI 元素（包括任务栏）
		const script = `
Add-Type -AssemblyName UIAutomationClient
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null

$desktop = [System.Windows.Automation.AutomationElement]::RootElement

# 获取屏幕尺寸
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

$allElements = @()
$taskbarElements = @()

# 查找任务栏
$taskbarCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, "Shell_TrayWnd")
$taskbar = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $taskbarCondition)

if($taskbar) {
    $rect = $taskbar.Current.BoundingRectangle
    $taskbarElements += @{
        name = "Windows任务栏"
        type = "Taskbar"
        className = "Shell_TrayWnd"
        left = $rect.Left
        top = $rect.Top
        width = $rect.Width
        height = $rect.Height
        centerX = [math]::Round($rect.Left + $rect.Width/2)
        centerY = [math]::Round($rect.Top + $rect.Height/2)
        isTaskbar = $true
        isTrayIcon = $false
    }

    # 获取任务栏所有子元素
    $allChildren = $taskbar.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)

    for($i=0; $i -lt $allChildren.Count; $i++) {
        try {
            $child = $allChildren[$i]
            $name = $child.Current.Name
            $className = $child.Current.ClassName
            $rect = $child.Current.BoundingRectangle
            $controlType = $child.Current.ControlType.ProgrammaticName

            if($name -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
                $isTrayIcon = $className -eq "TrayNotifyWnd" -or
                              $name -match "Steam|Clash|QQ|微信|网络|音量|WiFi|时钟|输入法"

                $item = @{
                    name = $name
                    type = $controlType
                    className = $className
                    left = $rect.Left
                    top = $rect.Top
                    width = $rect.Width
                    height = $rect.Height
                    centerX = [math]::Round($rect.Left + $rect.Width/2)
                    centerY = [math]::Round($rect.Top + $rect.Height/2)
                    isTaskbar = $true
                    isTrayIcon = $isTrayIcon
                }
                $taskbarElements += $item
                $allElements += $item
            }
        } catch {}
    }
}

# 获取所有顶级窗口
$windows = @()
$children = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)

for($i=0; $i -lt $children.Count; $i++) {
    try {
        $win = $children[$i]
        $name = $win.Current.Name
        $rect = $win.Current.BoundingRectangle

        if($rect.Width -gt 10 -and $rect.Height -gt 10) {
            $windows += @{
                title = $name
                left = $rect.Left
                top = $rect.Top
                width = $rect.Width
                height = $rect.Height
                centerX = [math]::Round($rect.Left + $rect.Width/2)
                centerY = [math]::Round($rect.Top + $rect.Height/2)
            }

            $allElements += @{
                name = $name
                type = $win.Current.ControlType.ProgrammaticName
                className = $win.Current.ClassName
                left = $rect.Left
                top = $rect.Top
                width = $rect.Width
                height = $rect.Height
                centerX = [math]::Round($rect.Left + $rect.Width/2)
                centerY = [math]::Round($rect.Top + $rect.Height/2)
                isTaskbar = $false
                isTrayIcon = $false
            }
        }
    } catch {}
}

@{
    screenWidth = $screen.Width
    screenHeight = $screen.Height
    windows = $windows
    taskbarElements = $taskbarElements
    allElements = $allElements
} | ConvertTo-Json -Depth 10 -Compress
`;

		const result = await runPowerShell(script, 30000);

		// 转换为 WindowInfo 格式
		const windowInfos: WindowInfo[] = result.windows || [];
		const taskbarWindowInfos: WindowInfo[] = (result.taskbarElements || [])
			.filter((e: UIElement) => e.isTrayIcon)
			.map((e: UIElement) => ({
				title: e.name,
				left: e.left,
				top: e.top,
				width: e.width,
				height: e.height,
				centerX: e.centerX,
				centerY: e.centerY
			}));

		loggerInstance.debug(
			`获取到 ${windowInfos.length} 个窗口，${result.taskbarElements?.length || 0} 个任务栏元素`
		);

		return {
			success: true,
			windows: windowInfos,
			taskbarWindows: taskbarWindowInfos,
			elements: result.allElements || [],
			taskbarElements: result.taskbarElements || [],
			screenWidth: result.screenWidth || 1920,
			screenHeight: result.screenHeight || 1080,
		};
	} catch (error) {
		loggerInstance.warn('获取窗口信息失败:', error);

		// 回退到 nut.js
		try {
			const nutjs = await import('@nut-tree-fork/nut-js');
			const { getWindows, screen } = nutjs;
			const screenWidth = await screen.width();
			const screenHeight = await screen.height();
			const windows = await getWindows();

			const windowInfos: WindowInfo[] = [];
			for (const win of windows) {
				try {
					const title = await win.title;
					const region = await win.region;
					if (region && region.width > 0 && region.height > 0) {
						windowInfos.push({
							title: title || '(无标题)',
							left: region.left,
							top: region.top,
							width: region.width,
							height: region.height,
							centerX: region.left + region.width / 2,
							centerY: region.top + region.height / 2,
						});
					}
				} catch {}
			}

			return {
				success: true,
				windows: windowInfos,
				taskbarWindows: [],
				elements: [],
				taskbarElements: [],
				screenWidth,
				screenHeight,
				message: 'UI Automation 失败，回退到 nut.js（无法获取任务栏图标）',
			};
		} catch {
			return {
				success: false,
				windows: [],
				taskbarWindows: [],
				elements: [],
				taskbarElements: [],
				screenWidth: 1920,
				screenHeight: 1080,
				message: error instanceof Error ? error.message : '未知错误',
			};
		}
	}
}

/**
 * 格式化窗口信息为文本描述
 * 用于在截图时一起发送给 AI
 */
export function formatWindowInfo(result: WindowInfoResult): string {
	if (!result.success) {
		return '';
	}

	const lines: string[] = [];
	lines.push('## 屏幕 UI 元素信息');
	lines.push('');
	lines.push(`屏幕尺寸: ${result.screenWidth}x${result.screenHeight}`);
	lines.push('');

	// 任务栏元素（使用 UI Automation 获取的）
	if (result.taskbarElements && result.taskbarElements.length > 0) {
		lines.push('### 任务栏元素（系统托盘）');
		lines.push('');

		result.taskbarElements.forEach((el, i) => {
			if (el.isTrayIcon) {
				const relX = (el.centerX / result.screenWidth).toFixed(3);
				const relY = (el.centerY / result.screenHeight).toFixed(3);
				lines.push(`${i + 1}. "${el.name}" - 中心点: [${relX}, ${relY}] (像素: ${el.centerX}, ${el.centerY})`);
			}
		});

		lines.push('');
	}

	// 主要应用窗口
	const mainWindows = result.windows
		.filter((w) => w.width > 200 && w.height > 100)
		.sort((a, b) => b.height - a.height)
		.slice(0, 10);

	if (mainWindows.length > 0) {
		lines.push('### 主要应用窗口');
		lines.push('');
		mainWindows.forEach((win, i) => {
			const relX = (win.centerX / result.screenWidth).toFixed(3);
			const relY = (win.centerY / result.screenHeight).toFixed(3);
			lines.push(`${i + 1}. "${win.title}" - 位置: (${win.left}, ${win.top}), 大小: ${win.width}x${win.height}`);
			lines.push(`   中心点: [${relX}, ${relY}] (像素: ${win.centerX}, ${win.centerY})`);
		});
		lines.push('');
	}

	// 提示信息
	if (!result.taskbarElements || result.taskbarElements.length === 0) {
		lines.push('> 提示: 未获取到任务栏图标信息，建议检查 Windows UI Automation 服务');
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * 搜索特定窗口
 */
export async function findWindow(keyword: string): Promise<WindowInfo | null> {
	const result = await getWindowInfo();
	if (!result.success) return null;

	const keywordLower = keyword.toLowerCase();

	// 先在任务栏元素中搜索
	const taskbarMatch = result.taskbarElements?.find(
		(e) => e.name.toLowerCase().includes(keywordLower)
	);

	if (taskbarMatch) {
		return {
			title: taskbarMatch.name,
			left: taskbarMatch.left,
			top: taskbarMatch.top,
			width: taskbarMatch.width,
			height: taskbarMatch.height,
			centerX: taskbarMatch.centerX,
			centerY: taskbarMatch.centerY,
		};
	}

	// 再在窗口中搜索
	const found = result.windows.find((w) =>
		w.title.toLowerCase().includes(keywordLower)
	);

	return found || null;
}
