/**
 * 应用管理工具
 * 支持打开、关闭、查找应用程序
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';
import { join } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

interface AppInfo {
	name: string;
	processName: string;
	pid?: number;
	path?: string;
	isRunning: boolean;
	message?: string;
	screenshot?: {
		base64: string;
		format: string;
		imageSize: { width: number; height: number };
	};
}

// Windows 常见应用路径映射
const WINDOWS_APP_PATHS: Record<string, string[]> = {
	'网易云音乐': [
		join(process.env.LOCALAPPDATA || '', 'Netease', 'CloudMusic', 'cloudmusic.exe'),
		join(process.env.PROGRAMFILES || '', 'Netease', 'CloudMusic', 'cloudmusic.exe'),
		join(process.env['PROGRAMFILES(X86)'] || '', 'Netease', 'CloudMusic', 'cloudmusic.exe'),
	],
	'微信': [
		join(process.env['PROGRAMFILES(X86)'] || '', 'Tencent', 'WeChat', 'WeChat.exe'),
		join(process.env.PROGRAMFILES || '', 'Tencent', 'WeChat', 'WeChat.exe'),
	],
	'qq': [
		join(process.env['PROGRAMFILES(X86)'] || '', 'Tencent', 'QQ', 'Bin', 'QQ.exe'),
		join(process.env.PROGRAMFILES || '', 'Tencent', 'QQ', 'Bin', 'QQ.exe'),
	],
	'chrome': [
		join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
		join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
		join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
	],
	'edge': [
		join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
		join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
	],
	'vscode': [
		join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
		join(process.env.PROGRAMFILES || '', 'Microsoft VS Code', 'Code.exe'),
	],
	'notepad': ['notepad.exe'],
	'calc': ['calc.exe'],
	'cmd': ['cmd.exe'],
	'powershell': ['powershell.exe'],
	'explorer': ['explorer.exe'],
};

// macOS 常见应用
const MACOS_APP_NAMES: Record<string, string> = {
	'网易云音乐': 'NeteaseMusic',
	'微信': 'WeChat',
	'qq': 'QQ',
	'chrome': 'Google Chrome',
	'edge': 'Microsoft Edge',
	'vscode': 'Visual Studio Code',
	'safari': 'Safari',
	'终端': 'Terminal',
};

export class AppTool extends BaseTool {
	static toolName = 'app';
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'app',
			description: `应用管理工具（备选方案）

【重要】有视觉能力时，优先使用 screenshot + computer 工具像人一样操作：
1. 截图查看桌面/任务栏是否有应用图标
2. 有直接点击图标打开
3. 没有则按 Win 键搜索

【适用场景】
- 无视觉能力时，直接打开应用
- 关闭正在运行的应用
- 检查应用是否正在运行

【使用示例】
- 打开应用: { "action": "open", "name": "网易云音乐", "wait": true }
- 关闭应用: { "action": "close", "name": "微信" }
- 检查运行状态: { "action": "isRunning", "name": "chrome" }

【注意】
- open 操作会自动处理：应用未运行则启动，已运行则聚焦到前台
- 操作后会自动返回当前屏幕截图`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: open(打开), close(关闭), isRunning(检查运行状态), list(列出运行应用), find(查找应用路径)',
					required: true,
					enum: ['open', 'close', 'isRunning', 'list', 'find'],
				},
				name: {
					type: 'string',
					description: '应用名称（支持模糊匹配，如"网易云音乐"、"微信"、"chrome"等）',
				},
				path: {
					type: 'string',
					description: '应用路径（可选，用于直接指定可执行文件路径）',
				},
				wait: {
					type: 'boolean',
					description: '是否等待应用启动完成（仅 open 操作有效，默认 false）',
				},
				force: {
					type: 'boolean',
					description: '是否强制关闭（仅 close 操作有效，默认 false）',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			name?: string;
			path?: string;
			wait?: boolean;
			force?: boolean;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, name, path, wait = false, force = false } = params;

		switch (action) {
			case 'open':
				if (!name && !path) throw new Error('open 操作需要 name 或 path 参数');
				return await this.openApp(name, path, wait);
			case 'close':
				if (!name) throw new Error('close 操作需要 name 参数');
				return await this.closeApp(name, force);
			case 'isRunning':
				if (!name) throw new Error('isRunning 操作需要 name 参数');
				return await this.isAppRunning(name);
			case 'list':
				return await this.listRunningApps();
			case 'find':
				if (!name) throw new Error('find 操作需要 name 参数');
				return await this.findAppPath(name);
			default:
				throw new Error(`未知的操作: ${action}`);
		}
	}

	/**
	 * 打开应用程序
	 */
	private async openApp(name?: string, customPath?: string, wait = false): Promise<AppInfo> {
		let appPath = customPath;
		let processName = '';

		// 如果没有指定路径，尝试查找
		if (!appPath && name) {
			const found = await this.findAppPath(name);
			if (found.path) {
				appPath = found.path;
				processName = found.processName;
			}
		}

		if (!appPath) {
			throw new Error(`未找到应用: ${name}，请检查应用名称或提供完整路径`);
		}

		// 检查应用是否已经在运行
		const isRunning = await this.isAppRunningByPath(appPath);
		if (isRunning) {
			this.logger.info(`应用 ${name || appPath} 已经在运行，尝试聚焦窗口`);
			const focused = await this.focusApp(appPath);
			
			// 等待窗口显示
			await new Promise(r => setTimeout(r, 500));
			
			// 自动截图返回给 AI
			let screenshot = undefined;
			try {
				const screenshotDesktop = (await import('screenshot-desktop')).default;
				const sharp = (await import('sharp')).default;
				const buffer = await screenshotDesktop({ format: 'png' });
				const compressedBuffer = await sharp(buffer)
					.jpeg({ quality: 70 })
					.toBuffer();
				const metadata = await sharp(compressedBuffer).metadata();
				screenshot = {
					base64: compressedBuffer.toString('base64'),
					format: 'jpeg',
					imageSize: { 
						width: metadata.width || 1920, 
						height: metadata.height || 1080 
					},
				};
			} catch (error) {
				this.logger.warn('应用聚焦后截图失败:', error);
			}
			
			return {
				name: name || appPath,
				processName: processName || appPath,
				isRunning: true,
				path: appPath,
				message: `应用 ${name || appPath} 已在运行，${focused ? '已成功聚焦到前台' : '聚焦可能失败'}。`,
				screenshot,
			};
		}

		// 启动应用
		try {
			if (systemInfo.isWindows) {
				// Windows: 使用 spawn 异步启动（不等待进程退出）
				const child = spawn('cmd', ['/c', 'start', '', `"${appPath}"`], {
					detached: true,
					windowsHide: true,
				});
				child.unref();
			} else if (systemInfo.isMac) {
				// macOS: 使用 open 命令（不等待）
				await execAsync(`open "${appPath}"`);
			} else {
				// Linux: 直接执行或使用 xdg-open
				const child = spawn(appPath, [], { detached: true });
				child.unref();
			}

			this.logger.info(`已启动应用: ${name || appPath}`);

			// 等待一小段时间让应用启动
			await new Promise(r => setTimeout(r, 2000));

			// 如果 wait=true，等待应用进程出现（最多等待 10 秒）
			if (wait) {
				const processName = appPath.split('\\').pop() || appPath.split('/').pop() || '';
				const maxWaitTime = 10000; // 最多等待 10 秒
				const checkInterval = 500; // 每 500ms 检查一次
				let waitedTime = 0;
				
				while (waitedTime < maxWaitTime) {
					const isRunning = await this.isAppRunningByPath(appPath);
					if (isRunning) {
						this.logger.info(`应用 ${name || appPath} 已成功启动并运行`);
						break;
					}
					await new Promise(r => setTimeout(r, checkInterval));
					waitedTime += checkInterval;
				}
				
				if (waitedTime >= maxWaitTime) {
					this.logger.warn(`等待应用 ${name || appPath} 启动超时，但可能仍在启动中`);
				}
			}

			// 等待应用窗口显示
			await new Promise(r => setTimeout(r, 1000));

			// 自动截图返回给 AI
			let screenshot = undefined;
			try {
				const screenshotDesktop = (await import('screenshot-desktop')).default;
				const sharp = (await import('sharp')).default;
				const buffer = await screenshotDesktop({ format: 'png' });
				const compressedBuffer = await sharp(buffer)
					.jpeg({ quality: 70 })
					.toBuffer();
				const metadata = await sharp(compressedBuffer).metadata();
				screenshot = {
					base64: compressedBuffer.toString('base64'),
					format: 'jpeg',
					imageSize: { 
						width: metadata.width || 1920, 
						height: metadata.height || 1080 
					},
				};
			} catch (error) {
				this.logger.warn('应用启动后截图失败:', error);
			}

			return {
				name: name || appPath,
				processName: processName || appPath,
				isRunning: true,
				path: appPath,
				message: `应用 ${name || appPath} 已启动${screenshot ? '，当前屏幕截图已返回' : ''}。`,
				screenshot,
			};
		} catch (error) {
			throw new Error(`启动应用失败: ${error}`);
		}
	}

	/**
	 * 关闭应用程序
	 */
	private async closeApp(name: string, force = false): Promise<{ success: boolean; message: string }> {
		try {
			if (systemInfo.isWindows) {
				// 查找进程
				const { stdout } = await execAsync(
					`tasklist /FI "IMAGENAME eq ${name}.exe" /FO CSV /NH`,
					{ windowsHide: true }
				);
				
				if (!stdout.includes(name)) {
					// 尝试模糊匹配
					const { stdout: allProcesses } = await execAsync('tasklist /FO CSV /NH', { windowsHide: true });
					const lines = allProcesses.split('\n');
					const matchingProcess = lines.find(line => 
						line.toLowerCase().includes(name.toLowerCase())
					);
					
					if (!matchingProcess) {
						return { success: false, message: `未找到运行中的进程: ${name}` };
					}
					
					const processName = matchingProcess.split(',')[0].replace(/"/g, '');
					await execAsync(`taskkill ${force ? '/F' : ''} /IM "${processName}"`, { windowsHide: true });
					return { success: true, message: `已关闭进程: ${processName}` };
				}
				
				await execAsync(`taskkill ${force ? '/F' : ''} /IM "${name}.exe"`, { windowsHide: true });
				return { success: true, message: `已关闭进程: ${name}.exe` };
			} else if (systemInfo.isMac) {
				// macOS: 使用 pkill
				const appName = MACOS_APP_NAMES[name] || name;
				await execAsync(`pkill ${force ? '-9' : ''} "${appName}"`);
				return { success: true, message: `已关闭应用: ${appName}` };
			} else {
				// Linux: 使用 pkill
				await execAsync(`pkill ${force ? '-9' : ''} "${name}"`);
				return { success: true, message: `已关闭进程: ${name}` };
			}
		} catch (error) {
			return { success: false, message: `关闭应用失败: ${error}` };
		}
	}

	/**
	 * 检查应用是否正在运行
	 */
	private async isAppRunning(name: string): Promise<{ running: boolean; pid?: number; info?: string }> {
		try {
			if (systemInfo.isWindows) {
				// 尝试精确匹配
				const { stdout } = await execAsync(
					`tasklist /FI "IMAGENAME eq ${name}.exe" /FO CSV /NH`,
					{ windowsHide: true }
				);
				
				if (stdout.includes(name)) {
					const lines = stdout.trim().split('\n');
					const firstProcess = lines[0];
					const parts = firstProcess.split(',');
					const pid = parseInt(parts[1]?.replace(/"/g, ''));
					return { running: true, pid, info: firstProcess };
				}
				
				// 模糊匹配
				const { stdout: allProcesses } = await execAsync('tasklist /FO CSV /NH', { windowsHide: true });
				const lines = allProcesses.split('\n');
				const matchingLine = lines.find(line => 
					line.toLowerCase().includes(name.toLowerCase())
				);
				
				if (matchingLine) {
					const parts = matchingLine.split(',');
					const processName = parts[0]?.replace(/"/g, '');
					const pid = parseInt(parts[1]?.replace(/"/g, ''));
					return { running: true, pid, info: processName };
				}
				
				return { running: false };
			} else {
				// macOS/Linux: 使用 pgrep
				try {
					const { stdout } = await execAsync(`pgrep -i "${name}"`);
					const pid = parseInt(stdout.trim());
					return { running: true, pid };
				} catch {
					return { running: false };
				}
			}
		} catch (error) {
			return { running: false };
		}
	}

	/**
	 * 列出当前运行的应用
	 */
	private async listRunningApps(): Promise<{ apps: AppInfo[]; count: number }> {
		try {
			if (systemInfo.isWindows) {
				const { stdout } = await execAsync('tasklist /FO CSV /NH', { windowsHide: true });
				const lines = stdout.trim().split('\n').filter(line => line);
				
				const apps: AppInfo[] = lines.map(line => {
					const parts = line.split(',');
					const processName = parts[0]?.replace(/"/g, '');
					const pid = parseInt(parts[1]?.replace(/"/g, ''));
					return {
						name: processName.replace('.exe', ''),
						processName,
						pid,
						isRunning: true,
					};
				});
				
				return { apps, count: apps.length };
			} else {
				// macOS/Linux
				const { stdout } = await execAsync('ps -eo pid,comm | grep -v PID');
				const lines = stdout.trim().split('\n').filter(line => line);
				
				const apps: AppInfo[] = lines.map(line => {
					const parts = line.trim().split(/\s+/);
					const pid = parseInt(parts[0]);
					const processName = parts[1];
					return {
						name: processName,
						processName,
						pid,
						isRunning: true,
					};
				});
				
				return { apps, count: apps.length };
			}
		} catch (error) {
			throw new Error(`获取运行应用列表失败: ${error}`);
		}
	}

	/**
	 * 查找应用路径
	 */
	private async findAppPath(name: string): Promise<{ name: string; path?: string; processName: string }> {
		if (systemInfo.isWindows) {
			// 检查预定义路径
			const paths = WINDOWS_APP_PATHS[name] || WINDOWS_APP_PATHS[name.toLowerCase()];
			if (paths) {
				for (const p of paths) {
					if (existsSync(p)) {
						return { name, path: p, processName: p.split('\\').pop() || name };
					}
				}
			}
			
			// 尝试使用 where 命令查找
			try {
				const { stdout } = await execAsync(`where "${name}" 2>nul || where "${name}.exe" 2>nul`, { windowsHide: true });
				const foundPath = stdout.trim().split('\n')[0];
				if (foundPath && existsSync(foundPath)) {
					return { name, path: foundPath, processName: foundPath.split('\\').pop() || name };
				}
			} catch {
				// 忽略错误
			}
			
			// 尝试常见路径
			const commonPaths = [
				join(process.env.PROGRAMFILES || '', name, `${name}.exe`),
				join(process.env['PROGRAMFILES(X86)'] || '', name, `${name}.exe`),
				join(process.env.LOCALAPPDATA || '', name, `${name}.exe`),
			];
			
			for (const p of commonPaths) {
				if (existsSync(p)) {
					return { name, path: p, processName: p.split('\\').pop() || name };
				}
			}
		} else if (systemInfo.isMac) {
			// macOS: 查找 Applications 目录
			const appName = MACOS_APP_NAMES[name] || name;
			const appPath = `/Applications/${appName}.app`;
			if (existsSync(appPath)) {
				return { name, path: appPath, processName: appName };
			}
		}
		
		return { name, processName: name };
	}

	/**
	 * 检查应用是否通过路径运行
	 */
	private async isAppRunningByPath(appPath: string): Promise<boolean> {
		const processName = appPath.split('\\').pop() || appPath.split('/').pop() || '';
		const result = await this.isAppRunning(processName.replace('.exe', ''));
		return result.running;
	}

	/**
	 * 聚焦应用窗口
	 */
	private async focusApp(appPath: string): Promise<boolean> {
		const processName = appPath.split('\\').pop() || appPath.split('/').pop() || '';
		const processNameWithoutExt = processName.replace('.exe', '');
		
		if (systemInfo.isWindows) {
			// 方法1: 使用 PowerShell 激活窗口
			try {
				// 使用单引号包裹 PowerShell 脚本，避免变量插值问题
				const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
}
"@

$processes = Get-Process | Where-Object { $_.ProcessName -like '*${processNameWithoutExt}*' -and $_.MainWindowHandle -ne 0 }
if ($processes) {
    $process = $processes | Select-Object -First 1
    $hwnd = $process.MainWindowHandle
    if ($hwnd -ne 0) {
        # 如果窗口最小化，先恢复
        if ([Win32]::IsIconic($hwnd)) {
            [Win32]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE
        }
        # 激活窗口
        [Win32]::SetForegroundWindow($hwnd) | Out-Null
        Write-Output "SUCCESS"
    } else {
        Write-Output "NO_WINDOW"
    }
} else {
    Write-Output "NO_PROCESS"
}
`;
				const { stdout } = await execAsync(`powershell -NoProfile -Command '${psScript}'`, { windowsHide: true });
				const result = stdout.trim();
				
				if (result === 'SUCCESS') {
					this.logger.info(`成功聚焦窗口: ${processNameWithoutExt}`);
					return true;
				} else if (result === 'NO_WINDOW') {
					this.logger.warn(`进程存在但没有窗口: ${processNameWithoutExt}`);
				} else if (result === 'NO_PROCESS') {
					this.logger.warn(`未找到进程: ${processNameWithoutExt}`);
				}
			} catch (error) {
				this.logger.warn(`PowerShell 聚焦窗口失败: ${error}`);
			}
			
			// 方法2: 使用 start 命令（备用方案）
			try {
				// 使用 start 命令的 /separate 参数可以激活已运行的应用
				await execAsync(`start "" "${appPath}"`, { windowsHide: true });
				this.logger.info(`使用 start 命令激活应用: ${processNameWithoutExt}`);
				return true;
			} catch (error) {
				this.logger.warn(`start 命令激活失败: ${error}`);
			}
		}
		
		return false;
	}
}

export default AppTool;
