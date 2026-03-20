/**
 * 浏览器服务 - 简化版
 * 
 * 使用新的 BrowserManager 统一管理浏览器
 * 只保留配置管理和 API 接口层
 */

import type { ConfigManager } from '../utils/config.js';
import { BrowserManager, browserManager, type BrowserType } from './browser/index.js';

export interface BrowserConfig {
	enabled: boolean;
	browserPath: string | null;
	headless: boolean;
	timeout: number;
	identity: string;
	disableImages?: boolean;
}

export interface DetectedBrowser {
	name: string;
	path: string;
	channel?: string;
}

export interface BrowserStatus {
	isOpen: boolean;
	url?: string;
	title?: string;
	tabCount?: number;
}

/**
 * 浏览器服务类 - 简化版
 * 委托所有浏览器操作给 BrowserManager
 */
class BrowserService {
	private config: ConfigManager | null = null;

	/**
	 * 初始化服务
	 */
	async init(config: ConfigManager): Promise<void> {
		this.config = config;
	}

	/**
	 * 获取浏览器配置
	 */
	getConfig(): BrowserConfig {
		if (!this.config) {
			return {
				enabled: true,
				browserPath: null,
				headless: false,
				timeout: 60000,
				identity: 'NutBot',
				disableImages: false,
			};
		}

		return {
			enabled: this.config.get('tools.browser.enabled', true),
			browserPath: this.config.get<string | null>('tools.browser.browserPath', null),
			headless: this.config.get('tools.browser.headless', false),
			timeout: this.config.get<number>('tools.browser.timeout', 60000),
			identity: this.config.get<string>('tools.browser.identity', 'NutBot'),
			disableImages: this.config.get('tools.browser.disableImages', false),
		};
	}

	/**
	 * 更新浏览器配置
	 */
	updateConfig(updates: Partial<BrowserConfig>): void {
		if (!this.config) return;

		if (updates.enabled !== undefined) {
			this.config.set('tools.browser.enabled', updates.enabled);
		}
		if (updates.browserPath !== undefined) {
			this.config.set('tools.browser.browserPath', updates.browserPath);
		}
		if (updates.headless !== undefined) {
			this.config.set('tools.browser.headless', updates.headless);
		}
		if (updates.timeout !== undefined) {
			this.config.set('tools.browser.timeout', updates.timeout);
		}
		if (updates.identity !== undefined) {
			this.config.set('tools.browser.identity', updates.identity);
		}
		if (updates.disableImages !== undefined) {
			this.config.set('tools.browser.disableImages', updates.disableImages);
		}
		this.config.save();
	}

	/**
	 * 自动检测系统浏览器
	 */
	async detectBrowsers(): Promise<DetectedBrowser[]> {
		const { findBrowserExecutable, getSystemDefaultBrowser } = await import('./browser/launcher.js');
		const browsers: DetectedBrowser[] = [];

		// 先获取系统默认浏览器
		const defaultBrowser = getSystemDefaultBrowser();
		
		// 如果检测到了默认浏览器且不是 chromium，优先添加
		if (defaultBrowser.type !== 'chromium' && defaultBrowser.executablePath) {
			if (defaultBrowser.type === 'edge') {
				browsers.push({ name: 'Microsoft Edge (默认)', path: defaultBrowser.executablePath, channel: 'msedge' });
			} else if (defaultBrowser.type === 'chrome') {
				browsers.push({ name: 'Google Chrome (默认)', path: defaultBrowser.executablePath, channel: 'chrome' });
			}
		}

		// 检测 Edge
		const edgePath = findBrowserExecutable('edge');
		if (edgePath && !browsers.find(b => b.path === edgePath)) {
			browsers.push({ name: 'Microsoft Edge', path: edgePath, channel: 'msedge' });
		}

		// 检测 Chrome
		const chromePath = findBrowserExecutable('chrome');
		if (chromePath && !browsers.find(b => b.path === chromePath)) {
			browsers.push({ name: 'Google Chrome', path: chromePath, channel: 'chrome' });
		}

		return browsers;
	}

	/**
	 * 打开独立浏览器
	 */
	async open(url?: string): Promise<{ success: boolean; message: string; browser?: string }> {
		try {
			const config = this.getConfig();
			
			// 确定浏览器类型和路径
			let browserType: BrowserType = 'chromium';
			let executablePath: string | undefined = config.browserPath || undefined;
			
			if (config.browserPath) {
				// 用户指定了浏览器路径
				if (config.browserPath.includes('edge') || config.browserPath.includes('msedge')) {
					browserType = 'edge';
				} else if (config.browserPath.includes('chrome')) {
					browserType = 'chrome';
				}
			} else {
				// 未指定路径，自动检测系统默认浏览器
				const { getSystemDefaultBrowser } = await import('./browser/launcher.js');
				const defaultBrowser = getSystemDefaultBrowser();
				browserType = defaultBrowser.type;
				executablePath = defaultBrowser.executablePath;
				console.log(`[BrowserService] 自动检测到系统默认浏览器: ${browserType}`);
			}

			// 如果浏览器未启动，先启动
			const state = await browserManager.getState();
			if (!state.isRunning) {
				await browserManager.launch({
					type: browserType,
					executablePath,
					headless: config.headless,
					navigationTimeout: config.timeout
				});
			}

			// 导航到指定 URL
			if (url) {
				await browserManager.goto(url);
			}

			return {
				success: true,
				message: url ? `已打开浏览器并导航到 ${url}` : '浏览器已启动',
				browser: executablePath || browserType
			};
		} catch (error) {
			return {
				success: false,
				message: `打开浏览器失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
	 * 导航到指定 URL（用于 API 调用）
	 */
	async navigate(url: string): Promise<{ success: boolean; message: string }> {
		try {
			await browserManager.goto(url);
			return { success: true, message: `已导航到 ${url}` };
		} catch (error) {
			return {
				success: false,
				message: `导航失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
	 * 关闭浏览器
	 */
	async close(): Promise<{ success: boolean; message: string }> {
		try {
			await browserManager.close();
			return { success: true, message: '浏览器已关闭' };
		} catch (error) {
			return {
				success: false,
				message: `关闭浏览器失败: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/**
	 * 获取浏览器状态
	 */
	async getStatus(): Promise<BrowserStatus> {
		const state = await browserManager.getState();
		return {
			isOpen: state.isRunning,
			url: state.currentUrl,
			title: state.currentTitle,
			tabCount: state.pageCount
		};
	}

	/**
	 * 获取 BrowserManager 实例
	 * 供其他模块使用
	 */
	getManager(): BrowserManager {
		return browserManager;
	}
}

// 导出单例
export const browserService = new BrowserService();
export default browserService;
