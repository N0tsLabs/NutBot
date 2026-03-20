/**
 * 系统启动器工具
 * 快速启动系统应用、设置和常用功能
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';

const execAsync = promisify(exec);

interface LaunchResult {
	success: boolean;
	action: string;
	message?: string;
}

export class LauncherTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'launcher',
			description: `系统启动器工具，快速启动系统应用、设置和常用功能

【适用场景】
- 打开开始菜单/应用启动器
- 启动系统设置
- 打开文件资源管理器
- 启动任务管理器
- 打开计算器、记事本等系统工具
- 控制系统音量、亮度

【使用示例】
- 打开开始菜单: { "action": "startMenu" }
- 打开设置: { "action": "settings" }
- 打开文件资源管理器: { "action": "fileExplorer", "path": "C:\\Users" }
- 打开任务管理器: { "action": "taskManager" }
- 打开计算器: { "action": "calculator" }
- 设置音量: { "action": "setVolume", "level": 50 }`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: [
						'startMenu',      // 打开开始菜单
						'settings',       // 打开系统设置
						'fileExplorer',   // 打开文件资源管理器
						'taskManager',    // 打开任务管理器
						'calculator',     // 打开计算器
						'notepad',        // 打开记事本
						'terminal',       // 打开终端
						'runDialog',      // 打开运行对话框
						'search',         // 打开搜索
						'desktop',        // 显示桌面
						'lock',           // 锁定屏幕
						'sleep',          // 睡眠
						'shutdown',       // 关机
						'restart',        // 重启
						'setVolume',      // 设置音量
						'setBrightness',  // 设置亮度
					],
				},
				path: {
					type: 'string',
					description: '文件资源管理器打开的路径（仅 fileExplorer 操作有效）',
				},
				level: {
					type: 'number',
					description: '音量或亮度级别 0-100（仅 setVolume/setBrightness 操作有效）',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			path?: string;
			level?: number;
		},
		context: Record<string, unknown> = {}
	): Promise<LaunchResult> {
		const { action, path, level } = params;

		switch (action) {
			case 'startMenu':
				return await this.openStartMenu();
			case 'settings':
				return await this.openSettings();
			case 'fileExplorer':
				return await this.openFileExplorer(path);
			case 'taskManager':
				return await this.openTaskManager();
			case 'calculator':
				return await this.openCalculator();
			case 'notepad':
				return await this.openNotepad();
			case 'terminal':
				return await this.openTerminal();
			case 'runDialog':
				return await this.openRunDialog();
			case 'search':
				return await this.openSearch();
			case 'desktop':
				return await this.showDesktop();
			case 'lock':
				return await this.lockScreen();
			case 'sleep':
				return await this.sleep();
			case 'shutdown':
				return await this.shutdown();
			case 'restart':
				return await this.restart();
			case 'setVolume':
				if (level === undefined) throw new Error('setVolume 操作需要 level 参数 (0-100)');
				return await this.setVolume(level);
			case 'setBrightness':
				if (level === undefined) throw new Error('setBrightness 操作需要 level 参数 (0-100)');
				return await this.setBrightness(level);
			default:
				throw new Error(`未知的操作: ${action}`);
		}
	}

	/**
	 * 打开开始菜单
	 */
	private async openStartMenu(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				// 模拟按下 Win 键
				await execAsync('powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^{ESC}\')"', { windowsHide: true });
				return { success: true, action: 'startMenu', message: '已打开开始菜单' };
			} else if (systemInfo.isMac) {
				// macOS 没有开始菜单，打开 Launchpad
				await execAsync('open -a Launchpad');
				return { success: true, action: 'startMenu', message: '已打开 Launchpad' };
			} else {
				// Linux: 尝试打开应用菜单
				await execAsync('xdotool key super');
				return { success: true, action: 'startMenu', message: '已打开应用菜单' };
			}
		} catch (error) {
			return { success: false, action: 'startMenu', message: `打开开始菜单失败: ${error}` };
		}
	}

	/**
	 * 打开系统设置
	 */
	private async openSettings(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('start ms-settings:', { windowsHide: true });
				return { success: true, action: 'settings', message: '已打开系统设置' };
			} else if (systemInfo.isMac) {
				await execAsync('open -b com.apple.systempreferences');
				return { success: true, action: 'settings', message: '已打开系统偏好设置' };
			} else {
				await execAsync('gnome-control-center || unity-control-center || kde-systemsettings');
				return { success: true, action: 'settings', message: '已打开系统设置' };
			}
		} catch (error) {
			return { success: false, action: 'settings', message: `打开设置失败: ${error}` };
		}
	}

	/**
	 * 打开文件资源管理器
	 */
	private async openFileExplorer(openPath?: string): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				const targetPath = openPath || 'explorer';
				if (openPath) {
					await execAsync(`explorer "${openPath}"`, { windowsHide: true });
				} else {
					await execAsync('explorer', { windowsHide: true });
				}
				return { success: true, action: 'fileExplorer', message: `已打开文件资源管理器${openPath ? `: ${openPath}` : ''}` };
			} else if (systemInfo.isMac) {
				const targetPath = openPath || '.';
				await execAsync(`open "${targetPath}"`);
				return { success: true, action: 'fileExplorer', message: `已打开 Finder${openPath ? `: ${openPath}` : ''}` };
			} else {
				const targetPath = openPath || '.';
				await execAsync(`xdg-open "${targetPath}"`);
				return { success: true, action: 'fileExplorer', message: `已打开文件管理器${openPath ? `: ${openPath}` : ''}` };
			}
		} catch (error) {
			return { success: false, action: 'fileExplorer', message: `打开文件资源管理器失败: ${error}` };
		}
	}

	/**
	 * 打开任务管理器
	 */
	private async openTaskManager(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('taskmgr', { windowsHide: true });
				return { success: true, action: 'taskManager', message: '已打开任务管理器' };
			} else if (systemInfo.isMac) {
				await execAsync('open -a "Activity Monitor"');
				return { success: true, action: 'taskManager', message: '已打开活动监视器' };
			} else {
				await execAsync('gnome-system-monitor || ksysguard || xterm -e htop');
				return { success: true, action: 'taskManager', message: '已打开系统监视器' };
			}
		} catch (error) {
			return { success: false, action: 'taskManager', message: `打开任务管理器失败: ${error}` };
		}
	}

	/**
	 * 打开计算器
	 */
	private async openCalculator(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('calc', { windowsHide: true });
				return { success: true, action: 'calculator', message: '已打开计算器' };
			} else if (systemInfo.isMac) {
				await execAsync('open -a Calculator');
				return { success: true, action: 'calculator', message: '已打开计算器' };
			} else {
				await execAsync('gnome-calculator || kcalc || xcalc');
				return { success: true, action: 'calculator', message: '已打开计算器' };
			}
		} catch (error) {
			return { success: false, action: 'calculator', message: `打开计算器失败: ${error}` };
		}
	}

	/**
	 * 打开记事本
	 */
	private async openNotepad(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('notepad', { windowsHide: true });
				return { success: true, action: 'notepad', message: '已打开记事本' };
			} else if (systemInfo.isMac) {
				await execAsync('open -a TextEdit');
				return { success: true, action: 'notepad', message: '已打开文本编辑' };
			} else {
				await execAsync('gedit || kate || mousepad || nano');
				return { success: true, action: 'notepad', message: '已打开文本编辑器' };
			}
		} catch (error) {
			return { success: false, action: 'notepad', message: `打开记事本失败: ${error}` };
		}
	}

	/**
	 * 打开终端
	 */
	private async openTerminal(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				// 优先打开 Windows Terminal，否则打开 PowerShell
				try {
					await execAsync('wt', { windowsHide: true });
				} catch {
					await execAsync('powershell', { windowsHide: true });
				}
				return { success: true, action: 'terminal', message: '已打开终端' };
			} else if (systemInfo.isMac) {
				await execAsync('open -a Terminal');
				return { success: true, action: 'terminal', message: '已打开终端' };
			} else {
				await execAsync('gnome-terminal || konsole || xterm');
				return { success: true, action: 'terminal', message: '已打开终端' };
			}
		} catch (error) {
			return { success: false, action: 'terminal', message: `打开终端失败: ${error}` };
		}
	}

	/**
	 * 打开运行对话框
	 */
	private async openRunDialog(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^{ESC}r\')"', { windowsHide: true });
				return { success: true, action: 'runDialog', message: '已打开运行对话框' };
			} else if (systemInfo.isMac) {
				// macOS 使用 Spotlight
				await execAsync('osascript -e \'tell application "System Events" to key code 49 using {command down}\'');
				return { success: true, action: 'runDialog', message: '已打开 Spotlight' };
			} else {
				// Linux: 打开运行对话框
				await execAsync('xdotool key Alt+F2');
				return { success: true, action: 'runDialog', message: '已打开运行对话框' };
			}
		} catch (error) {
			return { success: false, action: 'runDialog', message: `打开运行对话框失败: ${error}` };
		}
	}

	/**
	 * 打开搜索
	 */
	private async openSearch(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				// Win + S 打开搜索
				await execAsync('powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^+{ESC}\')"', { windowsHide: true });
				return { success: true, action: 'search', message: '已打开搜索' };
			} else if (systemInfo.isMac) {
				// Command + Space 打开 Spotlight
				await execAsync('osascript -e \'tell application "System Events" to key code 49 using {command down}\'');
				return { success: true, action: 'search', message: '已打开 Spotlight' };
			} else {
				await execAsync('xdotool key super');
				return { success: true, action: 'search', message: '已打开搜索' };
			}
		} catch (error) {
			return { success: false, action: 'search', message: `打开搜索失败: ${error}` };
		}
	}

	/**
	 * 显示桌面
	 */
	private async showDesktop(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^{ESC}d\')"', { windowsHide: true });
				return { success: true, action: 'desktop', message: '已显示桌面' };
			} else if (systemInfo.isMac) {
				// F11 或 Mission Control
				await execAsync('osascript -e \'tell application "System Events" to key code 103\'');
				return { success: true, action: 'desktop', message: '已显示桌面' };
			} else {
				await execAsync('xdotool key super+d');
				return { success: true, action: 'desktop', message: '已显示桌面' };
			}
		} catch (error) {
			return { success: false, action: 'desktop', message: `显示桌面失败: ${error}` };
		}
	}

	/**
	 * 锁定屏幕
	 */
	private async lockScreen(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('rundll32.exe user32.dll,LockWorkStation', { windowsHide: true });
				return { success: true, action: 'lock', message: '已锁定屏幕' };
			} else if (systemInfo.isMac) {
				await execAsync('pmset displaysleepnow');
				return { success: true, action: 'lock', message: '已锁定屏幕' };
			} else {
				await execAsync('gnome-screensaver-command -l || xscreensaver-command -lock || loginctl lock-session');
				return { success: true, action: 'lock', message: '已锁定屏幕' };
			}
		} catch (error) {
			return { success: false, action: 'lock', message: `锁定屏幕失败: ${error}` };
		}
	}

	/**
	 * 睡眠
	 */
	private async sleep(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true });
				return { success: true, action: 'sleep', message: '已进入睡眠' };
			} else if (systemInfo.isMac) {
				await execAsync('pmset sleepnow');
				return { success: true, action: 'sleep', message: '已进入睡眠' };
			} else {
				await execAsync('systemctl suspend');
				return { success: true, action: 'sleep', message: '已进入睡眠' };
			}
		} catch (error) {
			return { success: false, action: 'sleep', message: `进入睡眠失败: ${error}` };
		}
	}

	/**
	 * 关机
	 */
	private async shutdown(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('shutdown /s /t 0', { windowsHide: true });
				return { success: true, action: 'shutdown', message: '正在关机' };
			} else if (systemInfo.isMac) {
				await execAsync('osascript -e \'tell app "System Events" to shut down\'');
				return { success: true, action: 'shutdown', message: '正在关机' };
			} else {
				await execAsync('systemctl poweroff');
				return { success: true, action: 'shutdown', message: '正在关机' };
			}
		} catch (error) {
			return { success: false, action: 'shutdown', message: `关机失败: ${error}` };
		}
	}

	/**
	 * 重启
	 */
	private async restart(): Promise<LaunchResult> {
		try {
			if (systemInfo.isWindows) {
				await execAsync('shutdown /r /t 0', { windowsHide: true });
				return { success: true, action: 'restart', message: '正在重启' };
			} else if (systemInfo.isMac) {
				await execAsync('osascript -e \'tell app "System Events" to restart\'');
				return { success: true, action: 'restart', message: '正在重启' };
			} else {
				await execAsync('systemctl reboot');
				return { success: true, action: 'restart', message: '正在重启' };
			}
		} catch (error) {
			return { success: false, action: 'restart', message: `重启失败: ${error}` };
		}
	}

	/**
	 * 设置音量
	 */
	private async setVolume(level: number): Promise<LaunchResult> {
		try {
			const clampedLevel = Math.max(0, Math.min(100, level));
			
			if (systemInfo.isWindows) {
				// 使用 PowerShell 设置音量
				const psScript = `
					Add-Type -TypeDefinition @"
					using System;
					using System.Runtime.InteropServices;
					public class Audio {
						[DllImport("user32.dll")]
						public static extern int SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
					}
					"@
					$volume = [math]::Round(${clampedLevel} / 100 * 65535)
					[Audio]::SendMessageW(0xffff, 0x319, 0, $volume)
				`;
				await execAsync(`powershell -Command "${psScript}"`, { windowsHide: true });
				return { success: true, action: 'setVolume', message: `音量已设置为 ${clampedLevel}%` };
			} else if (systemInfo.isMac) {
				await execAsync(`osascript -e "set volume output volume ${clampedLevel}"`);
				return { success: true, action: 'setVolume', message: `音量已设置为 ${clampedLevel}%` };
			} else {
				await execAsync(`amixer set Master ${clampedLevel}%`);
				return { success: true, action: 'setVolume', message: `音量已设置为 ${clampedLevel}%` };
			}
		} catch (error) {
			return { success: false, action: 'setVolume', message: `设置音量失败: ${error}` };
		}
	}

	/**
	 * 设置亮度
	 */
	private async setBrightness(level: number): Promise<LaunchResult> {
		try {
			const clampedLevel = Math.max(0, Math.min(100, level));
			
			if (systemInfo.isWindows) {
				// Windows 亮度控制较复杂，需要 WMI
				const psScript = `
					$brightness = ${clampedLevel}
					$monitor = Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods
					$monitor.WmiSetBrightness(1, $brightness)
				`;
				await execAsync(`powershell -Command "${psScript}"`, { windowsHide: true });
				return { success: true, action: 'setBrightness', message: `亮度已设置为 ${clampedLevel}%` };
			} else if (systemInfo.isMac) {
				await execAsync(`brightness -v ${clampedLevel / 100}`);
				return { success: true, action: 'setBrightness', message: `亮度已设置为 ${clampedLevel}%` };
			} else {
				await execAsync(`xbacklight -set ${clampedLevel}`);
				return { success: true, action: 'setBrightness', message: `亮度已设置为 ${clampedLevel}%` };
			}
		} catch (error) {
			return { success: false, action: 'setBrightness', message: `设置亮度失败: ${error}` };
		}
	}
}

export default LauncherTool;
