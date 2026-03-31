/**
 * 窗口管理工具
 * 支持窗口列表、聚焦、调整大小等操作
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';

const execAsync = promisify(exec);

interface WindowInfo {
	title: string;
	processName?: string;
	pid?: number;
	handle?: string; // Windows 窗口句柄
	id?: string; // macOS/Linux 窗口 ID
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	active?: boolean;
}

export class WindowTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'window',
			description: '窗口管理工具，支持列出窗口、调整窗口大小和位置（注意：聚焦窗口请使用点击操作）',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: list(列出窗口), resize(调整大小), move(移动窗口), minimize(最小化), maximize(最大化), restore(恢复), close(关闭)。注意：聚焦窗口请直接点击任务栏图标或窗口',
					required: true,
					enum: ['list', 'resize', 'move', 'minimize', 'maximize', 'restore', 'close'],
				},
				title: {
					type: 'string',
					description: '窗口标题（支持部分匹配）',
				},
				processName: {
					type: 'string',
					description: '进程名称',
				},
				x: {
					type: 'number',
					description: 'move 操作的 X 坐标',
				},
				y: {
					type: 'number',
					description: 'move 操作的 Y 坐标',
				},
				width: {
					type: 'number',
					description: 'resize 操作的宽度',
				},
				height: {
					type: 'number',
					description: 'resize 操作的高度',
				},
				confirmClose: {
					type: 'boolean',
					description: 'close 操作的确认标记，必须为 true 才能关闭窗口',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			title?: string;
			processName?: string;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			confirmClose?: boolean;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, title, processName, x, y, width, height, confirmClose } = params;

		switch (action) {
			case 'list':
				return await this.listWindows();
			case 'resize':
				if (!title && !processName) throw new Error('resize 操作需要 title 或 processName 参数');
				if (width === undefined || height === undefined) throw new Error('resize 操作需要 width 和 height 参数');
				return await this.resizeWindow(title, processName, width, height);
			case 'move':
				if (!title && !processName) throw new Error('move 操作需要 title 或 processName 参数');
				if (x === undefined || y === undefined) throw new Error('move 操作需要 x 和 y 参数');
				return await this.moveWindow(title, processName, x, y);
			case 'minimize':
				if (!title && !processName) throw new Error('minimize 操作需要 title 或 processName 参数');
				return await this.minimizeWindow(title, processName);
			case 'maximize':
				if (!title && !processName) throw new Error('maximize 操作需要 title 或 processName 参数');
				return await this.maximizeWindow(title, processName);
			case 'restore':
				if (!title && !processName) throw new Error('restore 操作需要 title 或 processName 参数');
				return await this.restoreWindow(title, processName);
			case 'close':
				if (!title && !processName) throw new Error('close 操作需要 title 或 processName 参数');
				return await this.closeWindow(title, processName, confirmClose);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 列出所有窗口
	 */
	private async listWindows(): Promise<{
		success: boolean;
		windows: WindowInfo[];
		total: number;
	}> {
		let windows: WindowInfo[] = [];

		if (systemInfo.isWindows) {
			windows = await this.listWindowsWindows();
		} else if (systemInfo.isMac) {
			windows = await this.listWindowsMac();
		} else {
			windows = await this.listWindowsLinux();
		}

		this.logger.info(`列出窗口: ${windows.length} 个`);

		return {
			success: true,
			windows,
			total: windows.length,
		};
	}

	/**
	 * Windows: 列出窗口
	 */
	private async listWindowsWindows(): Promise<WindowInfo[]> {
		const psScript = `
			Add-Type @"
			using System;
			using System.Runtime.InteropServices;
			using System.Text;
			using System.Collections.Generic;
			
			public class WindowHelper {
				[DllImport("user32.dll")]
				public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
				
				[DllImport("user32.dll")]
				public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
				
				[DllImport("user32.dll")]
				public static extern bool IsWindowVisible(IntPtr hWnd);
				
				[DllImport("user32.dll")]
				public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
				
				public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
				
				public static List<object[]> GetWindows() {
					var windows = new List<object[]>();
					EnumWindows((hWnd, lParam) => {
						if (IsWindowVisible(hWnd)) {
							var title = new StringBuilder(256);
							GetWindowText(hWnd, title, 256);
							if (title.Length > 0) {
								uint pid;
								GetWindowThreadProcessId(hWnd, out pid);
								windows.Add(new object[] { hWnd.ToInt64(), title.ToString(), pid });
							}
						}
						return true;
					}, IntPtr.Zero);
					return windows;
				}
			}
"@
			$windows = [WindowHelper]::GetWindows()
			foreach ($w in $windows) {
				$proc = Get-Process -Id $w[2] -ErrorAction SilentlyContinue
				$procName = if ($proc) { $proc.ProcessName } else { "" }
				Write-Output "$($w[0])|$($w[1])|$($w[2])|$procName"
			}
		`;

		try {
			const { stdout } = await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, {
				encoding: 'utf-8',
				maxBuffer: 10 * 1024 * 1024,
			});

			return stdout
				.trim()
				.split('\n')
				.filter((line) => line.trim())
				.map((line) => {
					const [handle, title, pid, processName] = line.split('|');
					return {
						handle,
						title: title || '',
						pid: parseInt(pid) || undefined,
						processName: processName || undefined,
					};
				})
				.filter((w) => w.title); // 过滤空标题
		} catch (error) {
			this.logger.warn('获取窗口列表失败:', (error as Error).message);
			return [];
		}
	}

	/**
	 * macOS: 列出窗口
	 */
	private async listWindowsMac(): Promise<WindowInfo[]> {
		const script = `
			tell application "System Events"
				set windowList to {}
				repeat with proc in (every process whose visible is true)
					try
						repeat with win in (every window of proc)
							set winInfo to (name of proc) & "|" & (name of win) & "|" & (id of proc)
							set end of windowList to winInfo
						end repeat
					end try
				end repeat
				return windowList
			end tell
		`;

		try {
			const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

			return stdout
				.trim()
				.split(', ')
				.filter((line) => line.trim())
				.map((line) => {
					const [processName, title, pid] = line.split('|');
					return {
						title: title || processName || '',
						processName,
						pid: parseInt(pid) || undefined,
					};
				});
		} catch (error) {
			this.logger.warn('获取窗口列表失败:', (error as Error).message);
			return [];
		}
	}

	/**
	 * Linux: 列出窗口
	 */
	private async listWindowsLinux(): Promise<WindowInfo[]> {
		try {
			// 使用 wmctrl
			const { stdout } = await execAsync('wmctrl -l -p');

			return stdout
				.trim()
				.split('\n')
				.filter((line) => line.trim())
				.map((line) => {
					const parts = line.split(/\s+/);
					const id = parts[0];
					const pid = parseInt(parts[2]) || undefined;
					const title = parts.slice(4).join(' ');
					return {
						id,
						title,
						pid,
					};
				});
		} catch {
			try {
				// 备选：使用 xdotool
				const { stdout } = await execAsync('xdotool search --name "" getwindowname %@');
				return stdout
					.trim()
					.split('\n')
					.filter((line) => line.trim())
					.map((title) => ({ title }));
			} catch {
				this.logger.warn('Linux 窗口列表需要安装 wmctrl 或 xdotool');
				return [];
			}
		}
	}

	/**
	 * 聚焦窗口
	 */
	private async focusWindow(
		title?: string,
		processName?: string
	): Promise<{
		success: boolean;
		window?: string;
		error?: string;
	}> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			// 使用 Base64 编码避免引号和特殊字符问题
			const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WindowFocus {
		  [DllImport("user32.dll")]
		  public static extern bool SetForegroundWindow(IntPtr hWnd);
		  [DllImport("user32.dll")]
		  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$procs = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" -or $_.ProcessName -like "*${searchTerm}*" }
if (-not $procs) {
		  Write-Error "未找到匹配的进程: ${searchTerm}"
		  exit 1
}
$hwnd = $procs[0].MainWindowHandle
if ($hwnd -eq 0) {
		  Write-Error "进程没有窗口句柄"
		  exit 1
}
$showResult = [WindowFocus]::ShowWindow($hwnd, 9)
$focusResult = [WindowFocus]::SetForegroundWindow($hwnd)
if (-not $showResult -or -not $focusResult) {
		  Write-Error "窗口激活失败"
		  exit 1
}
Write-Output $procs[0].MainWindowTitle
`;
			// 将脚本转换为 Base64，避免引号和特殊字符问题
			const psBase64 = Buffer.from(psScript, 'utf16le').toString('base64');
			const { stdout, stderr } = await execAsync(`powershell -EncodedCommand ${psBase64}`, { encoding: 'utf-8' });
			
			if (stderr) {
				this.logger.error(`聚焦窗口失败: ${stderr}`);
				return { success: false, error: stderr.trim() };
			}
			
			this.logger.info(`聚焦窗口成功: ${stdout.trim() || searchTerm}`);
			return { success: true, window: stdout.trim() || searchTerm };
		} else if (systemInfo.isMac) {
			const script = `
				tell application "System Events"
					set frontApp to first process whose name contains "${searchTerm}" or (exists window 1 and name of window 1 contains "${searchTerm}")
					set frontmost of frontApp to true
				end tell
			`;
			await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
			this.logger.info(`聚焦窗口: ${searchTerm}`);
			return { success: true, window: searchTerm };
		} else {
			try {
				await execAsync(`wmctrl -a "${searchTerm}"`);
			} catch {
				await execAsync(`xdotool search --name "${searchTerm}" windowactivate`);
			}
			this.logger.info(`聚焦窗口: ${searchTerm}`);
			return { success: true, window: searchTerm };
		}
	}

	/**
	 * 调整窗口大小
	 */
	private async resizeWindow(
		title?: string,
		processName?: string,
		width?: number,
		height?: number
	): Promise<{
		success: boolean;
		width: number;
		height: number;
	}> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			const psScript = `
				Add-Type @"
				using System;
				using System.Runtime.InteropServices;
				public class WindowResize {
					[DllImport("user32.dll")]
					public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
					[DllImport("user32.dll")]
					public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
					[StructLayout(LayoutKind.Sequential)]
					public struct RECT { public int Left, Top, Right, Bottom; }
				}
"@
				$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
				if ($proc) {
					$hwnd = $proc.MainWindowHandle
					$rect = New-Object WindowResize+RECT
					[WindowResize]::GetWindowRect($hwnd, [ref]$rect)
					[WindowResize]::MoveWindow($hwnd, $rect.Left, $rect.Top, ${width}, ${height}, $true)
				}
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
		} else if (systemInfo.isMac) {
			const script = `
				tell application "System Events"
					set frontApp to first process whose name contains "${searchTerm}"
					tell frontApp
						set size of window 1 to {${width}, ${height}}
					end tell
				end tell
			`;
			await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
		} else {
			try {
				await execAsync(`wmctrl -r "${searchTerm}" -e 0,-1,-1,${width},${height}`);
			} catch {
				const { stdout } = await execAsync(`xdotool search --name "${searchTerm}"`);
				const winId = stdout.trim().split('\n')[0];
				if (winId) {
					await execAsync(`xdotool windowsize ${winId} ${width} ${height}`);
				}
			}
		}

		this.logger.info(`调整窗口大小: ${searchTerm} -> ${width}x${height}`);
		return { success: true, width: width!, height: height! };
	}

	/**
	 * 移动窗口
	 */
	private async moveWindow(
		title?: string,
		processName?: string,
		x?: number,
		y?: number
	): Promise<{
		success: boolean;
		x: number;
		y: number;
	}> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			const psScript = `
				Add-Type @"
				using System;
				using System.Runtime.InteropServices;
				public class WindowMove {
					[DllImport("user32.dll")]
					public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
					[DllImport("user32.dll")]
					public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
					[StructLayout(LayoutKind.Sequential)]
					public struct RECT { public int Left, Top, Right, Bottom; }
				}
"@
				$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
				if ($proc) {
					$hwnd = $proc.MainWindowHandle
					$rect = New-Object WindowMove+RECT
					[WindowMove]::GetWindowRect($hwnd, [ref]$rect)
					$w = $rect.Right - $rect.Left
					$h = $rect.Bottom - $rect.Top
					[WindowMove]::MoveWindow($hwnd, ${x}, ${y}, $w, $h, $true)
				}
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
		} else if (systemInfo.isMac) {
			const script = `
				tell application "System Events"
					set frontApp to first process whose name contains "${searchTerm}"
					tell frontApp
						set position of window 1 to {${x}, ${y}}
					end tell
				end tell
			`;
			await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
		} else {
			try {
				await execAsync(`wmctrl -r "${searchTerm}" -e 0,${x},${y},-1,-1`);
			} catch {
				const { stdout } = await execAsync(`xdotool search --name "${searchTerm}"`);
				const winId = stdout.trim().split('\n')[0];
				if (winId) {
					await execAsync(`xdotool windowmove ${winId} ${x} ${y}`);
				}
			}
		}

		this.logger.info(`移动窗口: ${searchTerm} -> (${x}, ${y})`);
		return { success: true, x: x!, y: y! };
	}

	/**
	 * 最小化窗口
	 */
	private async minimizeWindow(title?: string, processName?: string): Promise<{ success: boolean }> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			const psScript = `
				Add-Type @"
				using System;
				using System.Runtime.InteropServices;
				public class WindowMin { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }
"@
				$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
				if ($proc) { [WindowMin]::ShowWindow($proc.MainWindowHandle, 6) }
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
		} else if (systemInfo.isMac) {
			const script = `tell application "System Events" to set miniaturized of window 1 of (first process whose name contains "${searchTerm}") to true`;
			await execAsync(`osascript -e '${script}'`);
		} else {
			await execAsync(`xdotool search --name "${searchTerm}" windowminimize`);
		}

		this.logger.info(`最小化窗口: ${searchTerm}`);
		return { success: true };
	}

	/**
	 * 最大化窗口
	 */
	private async maximizeWindow(title?: string, processName?: string): Promise<{ success: boolean }> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			// 使用 PowerShell 文件执行，避免 here-string 在命令行中的解析问题
			const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WindowMax {
		  [DllImport("user32.dll")]
		  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
if ($proc) {
		  [WindowMax]::ShowWindow($proc.MainWindowHandle, 3)
		  Write-Host "已最大化窗口: $($proc.MainWindowTitle)"
} else {
		  Write-Host "未找到匹配的窗口"
}
`;
			// 写入临时文件执行
			const { writeFileSync, unlinkSync } = await import('fs');
			const { join } = await import('path');
			const { tmpdir } = await import('os');
			const tmpFile = join(tmpdir(), `nutbot-maximize-${Date.now()}.ps1`);
			writeFileSync(tmpFile, psScript, 'utf8');
			try {
				await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { encoding: 'utf-8' });
			} finally {
				try { unlinkSync(tmpFile); } catch {}
			}
		} else if (systemInfo.isMac) {
			const script = `tell application "System Events" to click (first button of window 1 of (first process whose name contains "${searchTerm}") whose subrole is "AXFullScreenButton")`;
			try {
				await execAsync(`osascript -e '${script}'`);
			} catch {
				// macOS 全屏按钮可能不存在，忽略错误
			}
		} else {
			await execAsync(`wmctrl -r "${searchTerm}" -b add,maximized_vert,maximized_horz`);
		}

		this.logger.info(`最大化窗口: ${searchTerm}`);
		return { success: true };
	}

	/**
	 * 恢复窗口
	 */
	private async restoreWindow(title?: string, processName?: string): Promise<{ success: boolean }> {
		const searchTerm = title || processName || '';

		if (systemInfo.isWindows) {
			const psScript = `
				Add-Type @"
				using System;
				using System.Runtime.InteropServices;
				public class WindowRestore { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }
"@
				$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
				if ($proc) { [WindowRestore]::ShowWindow($proc.MainWindowHandle, 9) }
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
		} else if (systemInfo.isMac) {
			const script = `tell application "System Events" to set miniaturized of window 1 of (first process whose name contains "${searchTerm}") to false`;
			await execAsync(`osascript -e '${script}'`);
		} else {
			await execAsync(`wmctrl -r "${searchTerm}" -b remove,maximized_vert,maximized_horz`);
		}

		this.logger.info(`恢复窗口: ${searchTerm}`);
		return { success: true };
	}

	/**
	 * 关闭窗口（需要确认）
	 */
	private async closeWindow(
		title?: string,
		processName?: string,
		confirmClose?: boolean
	): Promise<{
		success: boolean;
		closed: boolean;
		requireConfirmation: boolean;
		message?: string;
	}> {
		const searchTerm = title || processName || '';

		if (!confirmClose) {
			return {
				success: false,
				closed: false,
				requireConfirmation: true,
				message: '关闭窗口操作需要确认，请设置 confirmClose: true',
			};
		}

		if (systemInfo.isWindows) {
			const psScript = `
				$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${searchTerm}*" } | Select-Object -First 1
				if ($proc) { $proc.CloseMainWindow() }
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, { encoding: 'utf-8' });
		} else if (systemInfo.isMac) {
			const script = `tell application "System Events" to click button 1 of window 1 of (first process whose name contains "${searchTerm}")`;
			try {
				await execAsync(`osascript -e '${script}'`);
			} catch {
				// 尝试直接关闭应用
				await execAsync(`osascript -e 'tell application "${searchTerm}" to quit'`);
			}
		} else {
			await execAsync(`wmctrl -c "${searchTerm}"`);
		}

		this.logger.info(`关闭窗口: ${searchTerm}`);
		return {
			success: true,
			closed: true,
			requireConfirmation: false,
		};
	}

	async cleanup(): Promise<void> {
		// 无需清理
	}
}

export default WindowTool;
