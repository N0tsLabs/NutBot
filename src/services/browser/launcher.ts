/**
 * 简化的浏览器启动逻辑
 * 支持 Chrome、Edge、Chromium
 */

import { chromium, type BrowserContext } from 'playwright-core';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
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
		'--restore-last-session=false'
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
	const { rm } = await import('fs/promises');
	const { join } = await import('path');
	
	const filesToRemove = [
		'Last Session',
		'Last Tabs',
		'Current Session',
		'Current Tabs'
	];
	
	for (const file of filesToRemove) {
		try {
			await rm(join(userDataDir, file), { recursive: true, force: true });
		} catch {
			// 忽略错误
		}
	}
}
