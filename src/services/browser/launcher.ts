/**
 * 简化的浏览器启动逻辑
 * 支持 Chrome、Edge、Chromium
 */

import { chromium, type BrowserContext } from 'playwright-core';
import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import type { BrowserConfig, BrowserType } from './types.js';

/** 默认用户数据目录 */
export const DEFAULT_USER_DATA_DIR = join(homedir(), '.nutbot', 'browser-data');

/** 浏览器可执行文件路径 */
const BROWSER_PATHS: Record<string, Record<string, string[]>> = {
	win32: {
		chrome: [
			'C:/Program Files/Google/Chrome/Application/chrome.exe',
			'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
			join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')
		],
		edge: [
			'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
			'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
		]
	},
	darwin: {
		chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
		edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
	},
	linux: {
		chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'],
		edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
	}
};

/** 查找浏览器可执行文件 */
export function findBrowserExecutable(type: BrowserType): string | undefined {
	if (type === 'chromium') return undefined; // 使用 Playwright 内置的 Chromium
	
	const platform = process.platform as keyof typeof BROWSER_PATHS;
	const paths = BROWSER_PATHS[platform]?.[type] || [];
	
	for (const path of paths) {
		if (existsSync(path)) return path;
	}
	
	return undefined;
}

/** 获取系统默认浏览器 */
export function getSystemDefaultBrowser(): { type: BrowserType; executablePath?: string } {
	const currentPlatform = platform();
	
	try {
		if (currentPlatform === 'win32') {
			// Windows: 使用 START 命令的模拟方式检测
			// 通过检查文件关联来确定默认浏览器
			try {
				// 方法1: 使用 assoc 命令检查 http 协议关联
				const assocResult = execSync('assoc http', { encoding: 'utf-8', timeout: 3000 });
				const assocMatch = assocResult.match(/http=(.+)/);
				if (assocMatch) {
					const fileType = assocMatch[1].trim();
					
					// 根据文件类型判断浏览器
					if (fileType.toLowerCase().includes('edge') || fileType.toLowerCase().includes('msedge')) {
						const edgePath = findBrowserExecutable('edge');
						if (edgePath) return { type: 'edge', executablePath: edgePath };
					} else if (fileType.toLowerCase().includes('chrome')) {
						const chromePath = findBrowserExecutable('chrome');
						if (chromePath) return { type: 'chrome', executablePath: chromePath };
					}
				}
			} catch {
				// 忽略错误，尝试下一个方法
			}
			
			// 方法2: 检查注册表中的默认浏览器设置
			try {
				const regResult = execSync(
					'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId 2>nul',
					{ encoding: 'utf-8', timeout: 3000, shell: 'cmd.exe' }
				);
				
				const regMatch = regResult.match(/ProgId\s+REG_SZ\s+(\S+)/i);
				if (regMatch) {
					const progId = regMatch[1];
					
					if (progId.toLowerCase().includes('edge') || progId.toLowerCase().includes('msedge')) {
						const edgePath = findBrowserExecutable('edge');
						if (edgePath) return { type: 'edge', executablePath: edgePath };
					} else if (progId.toLowerCase().includes('chrome')) {
						const chromePath = findBrowserExecutable('chrome');
						if (chromePath) return { type: 'chrome', executablePath: chromePath };
					}
				}
			} catch {
				// 忽略错误
			}
			
			// 方法3: 通过 where 命令查找 msedge 或 chrome
			try {
				const whereEdge = execSync('where msedge 2>nul', { encoding: 'utf-8', timeout: 3000, shell: 'cmd.exe' });
				const edgePath = whereEdge.trim().split('\n')[0].trim();
				if (edgePath && existsSync(edgePath)) {
					return { type: 'edge', executablePath: edgePath };
				}
			} catch {
				// 忽略错误
			}
			
			try {
				const whereChrome = execSync('where chrome 2>nul', { encoding: 'utf-8', timeout: 3000, shell: 'cmd.exe' });
				const chromePath = whereChrome.trim().split('\n')[0].trim();
				if (chromePath && existsSync(chromePath)) {
					return { type: 'chrome', executablePath: chromePath };
				}
			} catch {
				// 忽略错误
			}
		} else if (currentPlatform === 'darwin') {
			// macOS: 通过 defaults 命令查询
			try {
				const result = execSync(
					'defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep -A 3 "LSHandlerURLScheme = http"',
					{ encoding: 'utf-8', timeout: 5000 }
				);
				
				if (result.includes('chrome')) {
					const chromePath = findBrowserExecutable('chrome');
					if (chromePath) return { type: 'chrome', executablePath: chromePath };
				} else if (result.includes('edge')) {
					const edgePath = findBrowserExecutable('edge');
					if (edgePath) return { type: 'edge', executablePath: edgePath };
				}
			} catch {
				// 忽略错误
			}
		} else if (currentPlatform === 'linux') {
			// Linux: 通过 xdg-settings 查询
			try {
				const result = execSync('xdg-settings get default-web-browser', { encoding: 'utf-8', timeout: 5000 });
				const desktopFile = result.toLowerCase();
				
				if (desktopFile.includes('edge')) {
					const edgePath = findBrowserExecutable('edge');
					if (edgePath) return { type: 'edge', executablePath: edgePath };
				} else if (desktopFile.includes('chrome') || desktopFile.includes('chromium')) {
					const chromePath = findBrowserExecutable('chrome');
					if (chromePath) return { type: 'chrome', executablePath: chromePath };
				}
			} catch {
				// 忽略错误
			}
		}
	} catch (error) {
		console.log('[Browser] 获取系统默认浏览器失败:', error);
	}
	
	// 如果无法检测，按优先级尝试已安装的浏览器
	const edgePath = findBrowserExecutable('edge');
	if (edgePath) return { type: 'edge', executablePath: edgePath };
	
	const chromePath = findBrowserExecutable('chrome');
	if (chromePath) return { type: 'chrome', executablePath: chromePath };
	
	// 最后回退到 Chromium
	return { type: 'chromium' };
}

/** 获取默认配置 */
export function getDefaultConfig(): BrowserConfig {
	return {
		type: 'chromium',
		userDataDir: DEFAULT_USER_DATA_DIR,
		headless: false,
		viewportWidth: 1280,
		viewportHeight: 720,
		navigationTimeout: 30000
	};
}

/** 启动浏览器 */
export async function launchBrowser(config: BrowserConfig): Promise<BrowserContext> {
	// 启动参数
	const args = [
		'--disable-blink-features=AutomationControlled',
		'--disable-web-security',
		'--disable-features=IsolateOrigins,site-per-process',
		'--disable-site-isolation-trials',
		'--disable-setuid-sandbox',
		'--disable-dev-shm-usage',
		'--no-sandbox',
		'--window-size=1280,720',
		'--start-maximized',
		'--restore-last-session=false',
		'--disable-session-crashed-bubble',
		'--disable-infobars',
		'--disable-restore-session-state'
	];

	// 构建启动选项
	const launchOptions: any = {
		headless: config.headless ?? false,
		args,
		viewport: {
			width: config.viewportWidth ?? 1280,
			height: config.viewportHeight ?? 720
		},
		timeout: config.navigationTimeout ?? 30000,
		ignoreHTTPSErrors: true
	};

	// 优先使用指定的可执行文件路径
	if (config.executablePath) {
		launchOptions.executablePath = config.executablePath;
	} else if (config.type === 'chrome') {
		// 如果没有指定路径，使用 channel 参数让 Playwright 自动查找
		launchOptions.channel = 'chrome';
	} else if (config.type === 'edge') {
		launchOptions.channel = 'msedge';
	} else if (config.type === 'chromium') {
		// 如果是 chromium 类型且没有指定路径，尝试使用系统默认浏览器
		const defaultBrowser = getSystemDefaultBrowser();
		if (defaultBrowser.executablePath) {
			launchOptions.executablePath = defaultBrowser.executablePath;
			console.log(`[Browser] 使用系统默认浏览器: ${defaultBrowser.type} (${defaultBrowser.executablePath})`);
		} else if (defaultBrowser.type === 'chrome') {
			launchOptions.channel = 'chrome';
			console.log('[Browser] 使用系统默认浏览器: Chrome (channel)');
		} else if (defaultBrowser.type === 'edge') {
			launchOptions.channel = 'msedge';
			console.log('[Browser] 使用系统默认浏览器: Edge (channel)');
		}
		// 如果还是 chromium，则使用 Playwright 内置的 Chromium
	}

	// 启动持久化上下文
	const context = await chromium.launchPersistentContext(config.userDataDir, launchOptions);

	// 禁用自动化检测
	await context.addInitScript(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
		Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
	});

	return context;
}

/** 清理会话恢复文件 */
export async function clearSessionRestore(userDataDir: string): Promise<void> {
	const { rm, readdir } = await import('fs/promises');
	const { join } = await import('path');
	
	// 基础会话文件
	const filesToRemove = [
		'Last Session',
		'Last Tabs',
		'Current Session',
		'Current Tabs',
		'Last Session.dmp',
		'Current Session.dmp',
		'Last Tabs.dmp',
		'Current Tabs.dmp'
	];
	
	for (const file of filesToRemove) {
		try {
			await rm(join(userDataDir, file), { recursive: true, force: true });
		} catch {
			// 忽略错误
		}
	}
	
	// 清理 Session Storage 中的恢复数据
	try {
		const sessionStorageDir = join(userDataDir, 'Session Storage');
		if (existsSync(sessionStorageDir)) {
			const files = await readdir(sessionStorageDir);
			for (const file of files) {
				if (file.includes('Session') || file.includes('Tabs')) {
					try {
						await rm(join(sessionStorageDir, file), { force: true });
					} catch {
						// 忽略错误
					}
				}
			}
		}
	} catch {
		// 忽略错误
	}
	
	// 清理 Local Storage 中的恢复标记
	try {
		const localStorageDir = join(userDataDir, 'Local Storage', 'leveldb');
		if (existsSync(localStorageDir)) {
			const files = await readdir(localStorageDir);
			for (const file of files) {
				if (file.startsWith('Session') || file.includes('Restore')) {
					try {
						await rm(join(localStorageDir, file), { force: true });
					} catch {
						// 忽略错误
					}
				}
			}
		}
	} catch {
		// 忽略错误
	}
}
