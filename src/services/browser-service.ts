/**
 * 浏览器服务 - 独立浏览器管理
 * 
 * 用于打开和管理独立的浏览器实例
 * 使用 NutBot 专属数据目录 (~/.nutbot/browser-data)
 * 
 * 功能特点：
 * - 使用 NutBot 专属数据目录，与系统浏览器隔离
 * - 自动注入隐藏自动化特征的脚本（内置，不可关闭）
 * - 自动检测系统浏览器（Edge/Chrome）
 * - User-Agent 中添加 NutBot 身份标识
 */

import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { ConfigManager } from '../utils/config.js';

export interface BrowserConfig {
	enabled: boolean;
	browserPath: string | null;
	headless: boolean;
	timeout: number;
	identity: string;
	disableImages?: boolean;  // 是否禁用图片加载
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
 * 隐藏自动化特征的脚本
 * 用于修改 navigator.webdriver 等属性，使浏览器看起来像真实用户
 */
const STEALTH_SCRIPT = `
// 隐藏 webdriver 标志
Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
});

// 模拟真实浏览器的 plugins
Object.defineProperty(navigator, 'plugins', {
    get: () => {
        const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];
        plugins.length = 3;
        return plugins;
    },
    configurable: true
});

// 设置语言
Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    configurable: true
});

// 添加 chrome 对象（Playwright 默认没有）
window.chrome = {
    runtime: {
        connect: function() {},
        sendMessage: function() {},
        onMessage: { addListener: function() {} },
        onConnect: { addListener: function() {} }
    },
    loadTimes: function() {},
    csi: function() {},
    app: {}
};

// 修改 permissions API
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
    );
}

// 隐藏自动化相关的属性
Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
    configurable: true
});

// 模拟硬件并发
Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true
});

// 模拟设备内存
Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true
});

// 移除 __webdriver_evaluate 等自动化标记
delete window.__webdriver_evaluate;
delete window.__selenium_evaluate;
delete window.__webdriver_script_function;
delete window.__webdriver_script_func;
delete window.__webdriver_script_fn;
delete window.__driver_evaluate;
delete window.__webdriver_unwrapped;
delete window.__webdriver_script_fn;
delete window.__fxdriver_evaluate;
delete window.__driver_unwrapped;
delete window.__webdriver_script_fn;
delete window.__lastWatirAlert;
delete window.__lastWatirConfirm;
delete window.__lastWatirPrompt;
delete window._Selenium_IDE_Recorder;
delete window._selenium;
delete window.calledSelenium;
delete document.__webdriver_evaluate;
delete document.__selenium_evaluate;
delete document.__webdriver_script_function;
delete document.__webdriver_script_func;
delete document.__webdriver_script_fn;
delete document.__fxdriver_evaluate;
delete document.__driver_unwrapped;
delete document.__webdriver_script_fn;
delete document.__lastWatirAlert;
delete document.__lastWatirConfirm;
delete document.__lastWatirPrompt;
delete document._Selenium_IDE_Recorder;
delete document._selenium;
delete document.calledSelenium;

// 模拟真实的 WebGL 信息
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
        return 'Intel Inc.';
    }
    if (parameter === 37446) {
        return 'Intel Iris OpenGL Engine';
    }
    return getParameter.call(this, parameter);
};

// 覆盖 toString 以防止检测
const originalToString = Function.prototype.toString;
Function.prototype.toString = function() {
    if (this === window.navigator.permissions.query) {
        return 'function query() { [native code] }';
    }
    return originalToString.call(this);
};

console.log('[NutBot] Anti-detection script loaded');
`;

/**
 * 浏览器服务类
 * 管理独立的浏览器实例
 */
class BrowserService {
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private config: ConfigManager | null = null;
	private playwrightAvailable = false;
	private nutBotDataDir: string | null = null;

	/**
	 * 初始化服务
	 */
	async init(config: ConfigManager): Promise<void> {
		this.config = config;
		await this.checkPlaywright();
		// 初始化 NutBot 专属数据目录
		this.nutBotDataDir = await this.getNutBotDataDir();
	}

	/**
	 * 检查 Playwright 是否可用
	 */
	private async checkPlaywright(): Promise<boolean> {
		try {
			await import('playwright');
			this.playwrightAvailable = true;
			return true;
		} catch {
			this.playwrightAvailable = false;
			return false;
		}
	}

	/**
	 * 获取 NutBot 专属用户数据目录
	 */
	private async getNutBotDataDir(): Promise<string> {
		const dataDir = path.join(os.homedir(), '.nutbot', 'browser-data');
		try {
			await fs.promises.mkdir(dataDir, { recursive: true });
		} catch {
			// 目录已存在或创建失败，忽略
		}
		return dataDir;
	}

	/**
	 * 获取浏览器配置
	 */
	getConfig(): BrowserConfig {
		if (!this.config) {
			console.warn('[BrowserService] 警告: config 未初始化，使用默认配置');
			return {
				enabled: true,
				browserPath: null,
				headless: false,
				timeout: 60000,
				identity: 'NutBot',
				disableImages: false,
			};
		}
		
		const config = {
			enabled: this.config.get('tools.browser.enabled', true),
			browserPath: this.config.get<string | null>('tools.browser.browserPath', null),
			headless: this.config.get('tools.browser.headless', false),
			timeout: this.config.get<number>('tools.browser.timeout', 60000),
			identity: this.config.get<string>('tools.browser.identity', 'NutBot'),
			disableImages: this.config.get('tools.browser.disableImages', false),
		};
		console.log(`[BrowserService] getConfig 返回: browserPath=${config.browserPath || 'null'}, headless=${config.headless}, disableImages=${config.disableImages}`);
		return config;
	}

	/**
	 * 更新浏览器配置
	 */
	updateConfig(updates: Partial<BrowserConfig>): void {
		if (!this.config) return;
		
		console.log('[BrowserService] updateConfig 收到的更新:', JSON.stringify(updates, null, 2));
		
		if (updates.enabled !== undefined) {
			this.config.set('tools.browser.enabled', updates.enabled);
		}
		if (updates.browserPath !== undefined) {
			console.log(`[BrowserService] 设置 browserPath: "${updates.browserPath}"`);
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
			console.log(`[BrowserService] 设置 disableImages: ${updates.disableImages}`);
			this.config.set('tools.browser.disableImages', updates.disableImages);
		}
		this.config.save();
		
		// 验证保存结果
		const savedConfig = this.getConfig();
		console.log('[BrowserService] 配置已保存，当前配置:', JSON.stringify(savedConfig, null, 2));
	}

	/**
	 * 生成带有身份标识的 User-Agent
	 */
	private async getUserAgentWithIdentity(baseUserAgent?: string): Promise<string> {
		const config = this.getConfig();
		const identity = config.identity || 'NutBot';
		
		// 获取基础 User-Agent
		let userAgent = baseUserAgent;
		if (!userAgent) {
			// 使用默认的 Chrome User-Agent
			const platform = process.platform;
			if (platform === 'win32') {
				userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
			} else if (platform === 'darwin') {
				userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
			} else {
				userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
			}
		}
		
		// 在 User-Agent 末尾添加身份标识
		// 格式: 原有UA + 空格 + Identity/Version
		return `${userAgent} ${identity}/1.0`;
	}

	/**
	 * 自动检测系统浏览器
	 */
	async detectBrowsers(): Promise<DetectedBrowser[]> {
		const browsers: DetectedBrowser[] = [];
		const { platform } = process;

		// Windows Edge 路径
		const edgePaths = platform === 'win32' ? [
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		] : platform === 'darwin' ? [
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		] : [
			'microsoft-edge',
			'/usr/bin/microsoft-edge',
		];

		// Chrome 路径
		const chromePaths = platform === 'win32' ? [
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			`${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
		] : platform === 'darwin' ? [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		] : [
			'google-chrome',
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
		];

		// 检查 Edge
		for (const browserPath of edgePaths) {
			try {
				if (platform === 'win32' || platform === 'darwin') {
					await fs.promises.access(browserPath);
					browsers.push({ 
						name: 'Microsoft Edge', 
						path: browserPath, 
						channel: 'msedge',
					});
					break;
				} else {
					// Linux 下检查命令是否存在
					browsers.push({ 
						name: 'Microsoft Edge', 
						path: browserPath, 
						channel: 'msedge',
					});
					break;
				}
			} catch {
				// 路径不存在，继续尝试
			}
		}

		// 检查 Chrome
		for (const browserPath of chromePaths) {
			try {
				if (platform === 'win32' || platform === 'darwin') {
					await fs.promises.access(browserPath);
					browsers.push({ 
						name: 'Google Chrome', 
						path: browserPath, 
						channel: 'chrome',
					});
					break;
				} else {
					// Linux 下检查命令是否存在
					browsers.push({ 
						name: 'Google Chrome', 
						path: browserPath, 
						channel: 'chrome',
					});
					break;
				}
			} catch {
				// 路径不存在，继续尝试
			}
		}

		return browsers;
	}

	/**
	 * 打开独立浏览器
	 * @param url 要打开的 URL（可选）
	 */
	async open(url?: string): Promise<{ success: boolean; message: string; browser?: string }> {
		console.log('[BrowserService] ========== open() 调试信息 ==========');
		
		if (!this.playwrightAvailable) {
			return {
				success: false,
				message: 'Playwright 未安装。请运行: npm install playwright && npx playwright install chromium',
			};
		}

		// 如果浏览器已经打开，直接导航
		if (this.page && !this.page.isClosed()) {
			if (url) {
				await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
			}
			await this.page.bringToFront();
			return { success: true, message: '浏览器已打开，已切换到前台', browser: 'existing' };
		}

		const config = this.getConfig();
		const detectedBrowsers = await this.detectBrowsers();
		
		console.log(`[BrowserService] ========== 配置调试信息 ==========`);
		console.log(`[BrowserService] config.browserPath 值: "${config.browserPath}"`);
		console.log(`[BrowserService] config.browserPath 类型: ${typeof config.browserPath}`);
		console.log(`[BrowserService] config.browserPath 长度: ${config.browserPath?.length}`);
		console.log(`[BrowserService] !!config.browserPath: ${!!config.browserPath}`);
		console.log(`[BrowserService] 检测到 ${detectedBrowsers.length} 个浏览器:`);
		for (const b of detectedBrowsers) {
			console.log(`  - ${b.name}: path=${b.path}, channel=${b.channel}`);
		}
		console.log(`[BrowserService] ======================================`);

		// 如果配置了浏览器路径，优先使用
		if (config.browserPath) {
			console.log(`[BrowserService] 使用配置的浏览器路径: ${config.browserPath}`);
			try {
				await this.launchBrowser(config.browserPath, config.headless);
				if (url && this.page) {
					await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
				}
				return { success: true, message: '浏览器已启动', browser: config.browserPath };
			} catch (e) {
				const error = e as Error;
				console.error('[BrowserService] ★★★ 启动失败（使用配置路径）★★★');
				console.error(`[BrowserService] 浏览器路径: ${config.browserPath}`);
				console.error(`[BrowserService] 错误消息: ${error.message}`);
				console.error(`[BrowserService] 错误堆栈: ${error.stack}`);
				console.error(`[BrowserService] 配置: ${JSON.stringify(config, null, 2)}`);
				return { success: false, message: `启动失败: ${error.message}` };
			}
		}

		// 尝试检测到的浏览器
		for (const browser of detectedBrowsers) {
			console.log(`[BrowserService] 尝试启动浏览器: ${browser.name}`);
			try {
				await this.launchWithChannel(browser, config.headless);
				if (url && this.page) {
					await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
				}
				return { success: true, message: '浏览器已启动', browser: browser.name };
			} catch (e) {
				const error = e as Error;
				console.warn(`[BrowserService] ★ ${browser.name} 启动失败 ★`);
				console.warn(`[BrowserService] 错误消息: ${error.message}`);
				console.warn(`[BrowserService] 错误堆栈: ${error.stack}`);
			}
		}

		// 回退到 Chromium
		console.log('[BrowserService] 所有检测到的浏览器都启动失败，回退到 Chromium');
		try {
			await this.launchWithChannel(null, config.headless);
			if (url && this.page) {
				await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
			}
			return { success: true, message: '浏览器已启动（Chromium）', browser: 'Chromium' };
		} catch (e) {
			const error = e as Error;
			console.error('[BrowserService] ★★★ Chromium 启动也失败 ★★★');
			console.error(`[BrowserService] 错误消息: ${error.message}`);
			console.error(`[BrowserService] 错误堆栈: ${error.stack}`);
			console.error(`[BrowserService] 配置: ${JSON.stringify(config, null, 2)}`);
			return { success: false, message: `启动失败: ${error.message}` };
		}
	}

	/**
	 * 注入隐藏自动化特征的脚本
	 */
	private async injectStealthScript(context: BrowserContext): Promise<void> {
		await context.addInitScript(STEALTH_SCRIPT);
		console.log('[BrowserService] 隐身脚本已注入');
	}

	/**
	 * 使用 channel 启动浏览器
	 */
	private async launchWithChannel(browser: DetectedBrowser | null, headless: boolean): Promise<void> {
		const config = this.getConfig();
		
		// 始终使用 NutBot 专属数据目录
		const userDataDir = this.nutBotDataDir || await this.getNutBotDataDir();
		const userAgent = await this.getUserAgentWithIdentity();
		const identity = config.identity || 'NutBot';
		
		console.log('[BrowserService] ========== 启动浏览器调试信息 ==========');
		console.log(`[BrowserService] 检测到的浏览器: ${browser ? `${browser.name} (channel: ${browser.channel}, path: ${browser.path})` : 'null'}`);
		console.log(`[BrowserService] 使用数据目录: ${userDataDir} (NutBot 专属)`);
		console.log('[BrowserService] ==========================================');
		
		const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
			headless,
			channel: browser?.channel === 'chromium' ? undefined : browser?.channel,
			args: [
				'--start-maximized',
				'--window-size=1920,1080',
				`--user-agent=${userAgent}`,
				'--disable-blink-features=AutomationControlled',  // 禁用自动化检测
				'--disable-infobars',  // 禁用信息栏
				'--disable-dev-shm-usage',
				'--no-sandbox',
			],
			viewport: null,
			userAgent,
			ignoreDefaultArgs: ['--enable-automation'],  // 忽略自动化标志
		};

		// 详细日志：Playwright 启动参数
		console.log('[BrowserService] ★★★ Playwright 启动参数 (launchWithChannel) ★★★');
		console.log(`[BrowserService] headless: ${launchOptions.headless}`);
		console.log(`[BrowserService] channel: ${launchOptions.channel || '未设置（将使用 Chromium）'}`);
		console.log(`[BrowserService] userDataDir: ${userDataDir}`);
		console.log(`[BrowserService] userAgent: ${launchOptions.userAgent}`);
		console.log(`[BrowserService] args: ${JSON.stringify(launchOptions.args, null, 2)}`);
		console.log(`[BrowserService] ignoreDefaultArgs: ${JSON.stringify(launchOptions.ignoreDefaultArgs)}`);
		console.log('[BrowserService] ==========================================');

		console.log(`[BrowserService] 使用数据目录: ${userDataDir} (NutBot 专属数据)`);
		console.log(`[BrowserService] 浏览器 channel: ${launchOptions.channel || '未设置（将使用 Chromium）'}`);

		this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
		
		// 注入隐身脚本（内置，始终启用）
		await this.injectStealthScript(this.context);
		
		this.page = this.context.pages()[0] || await this.context.newPage();
		
		// 设置页面标题标识
		try {
			await this.page.evaluate((id) => {
				console.log(`${id} Browser Session Started`);
			}, identity);
		} catch {
			// 忽略错误
		}
		
		await this.page.bringToFront();
	}

	/**
	 * 使用可执行文件路径启动浏览器
	 * @param executablePath 浏览器可执行文件路径
	 * @param headless 是否无头模式
	 */
	private async launchBrowser(executablePath: string, headless: boolean): Promise<void> {
		const config = this.getConfig();
		
		// 始终使用 NutBot 专属数据目录
		const userDataDir = this.nutBotDataDir || await this.getNutBotDataDir();
		const userAgent = await this.getUserAgentWithIdentity();
		const identity = config.identity || 'NutBot';
		
		console.log('[BrowserService] ========== launchBrowser 调试信息 ==========');
		console.log(`[BrowserService] executablePath: ${executablePath}`);
		console.log(`[BrowserService] 使用数据目录: ${userDataDir} (NutBot 专属)`);
		console.log('[BrowserService] ==========================================');
		
		console.log(`[BrowserService] 使用数据目录: ${userDataDir} (NutBot 专属数据)`);
		console.log(`[BrowserService] ★ 正在使用自定义浏览器路径启动: ${executablePath}`);
		
		const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
			headless,
			executablePath,
			args: [
				'--start-maximized', 
				'--window-size=1920,1080',
				`--user-agent=${userAgent}`,
				'--disable-blink-features=AutomationControlled',
				'--disable-infobars',
				'--disable-dev-shm-usage',
				'--no-sandbox',
			],
			viewport: null,
			userAgent,
			ignoreDefaultArgs: ['--enable-automation'],
		};
		
		// 详细日志：Playwright 启动参数
		console.log('[BrowserService] ★★★ Playwright 启动参数 ★★★');
		console.log(`[BrowserService] headless: ${launchOptions.headless}`);
		console.log(`[BrowserService] executablePath: ${launchOptions.executablePath}`);
		console.log(`[BrowserService] userDataDir: ${userDataDir}`);
		console.log(`[BrowserService] userAgent: ${launchOptions.userAgent}`);
		console.log(`[BrowserService] args: ${JSON.stringify(launchOptions.args, null, 2)}`);
		console.log(`[BrowserService] ignoreDefaultArgs: ${JSON.stringify(launchOptions.ignoreDefaultArgs)}`);
		console.log('[BrowserService] ==========================================');
		
		this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
		
		// 注入隐身脚本（内置，始终启用）
		await this.injectStealthScript(this.context);
		
		this.page = this.context.pages()[0] || await this.context.newPage();
		
		try {
			await this.page.evaluate((id) => {
				console.log(`${id} Browser Session Started`);
			}, identity);
		} catch {
			// 忽略错误
		}
		
		await this.page.bringToFront();
	}

	/**
	 * 关闭浏览器
	 */
	async close(): Promise<{ success: boolean; message: string }> {
		if (this.context) {
			await this.context.close();
			this.context = null;
			this.page = null;
			return { success: true, message: '浏览器已关闭' };
		}
		return { success: true, message: '浏览器未打开' };
	}

	/**
	 * 获取浏览器状态
	 */
	async getStatus(): Promise<BrowserStatus> {
		if (!this.page || this.page.isClosed()) {
			return { isOpen: false };
		}

		const tabCount = this.context ? this.context.pages().length : 1;
		const url = this.page.url();
		const title = await this.page.title().catch(() => '');

		return {
			isOpen: true,
			url,
			title,
			tabCount,
		};
	}

	/**
	 * 导航到 URL
	 */
	async navigate(url: string): Promise<{ success: boolean; message: string; url?: string }> {
		if (!this.page || this.page.isClosed()) {
			return { success: false, message: '浏览器未打开' };
		}

		try {
			const fullUrl = url.startsWith('http') ? url : `https://${url}`;
			await this.page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
			return { success: true, message: '导航成功', url: fullUrl };
		} catch (e) {
			return { success: false, message: `导航失败: ${(e as Error).message}` };
		}
	}

	/**
	 * 获取当前用户数据目录信息
	 */
	getCurrentDataDir(): string | null {
		return this.nutBotDataDir;
	}

	/**
	 * 截图功能
	 * @param fullPage 是否截取整个页面（默认 false，只截取可视区域）
	 * @param selector 可选，截取特定元素的选择器
	 */
	async screenshot(
		fullPage?: boolean,
		selector?: string
	): Promise<{ success: boolean; imageData: string; format: string; message?: string }> {
		if (!this.page || this.page.isClosed()) {
			return { success: false, imageData: '', format: 'png', message: '浏览器未打开' };
		}

		try {
			let screenshotBuffer: Buffer;

			if (selector) {
				// 截取特定元素
				const element = this.page.locator(selector).first();
				await element.waitFor({ state: 'visible', timeout: 5000 });
				screenshotBuffer = await element.screenshot();
				console.log(`[BrowserService] 已截取元素截图: ${selector}`);
			} else {
				// 截取页面
				screenshotBuffer = await this.page.screenshot({
					fullPage: fullPage || false,
				});
				console.log(`[BrowserService] 已截取页面截图 (fullPage: ${fullPage || false})`);
			}

			// 转换为 base64
			const imageData = screenshotBuffer.toString('base64');

			return {
				success: true,
				imageData,
				format: 'png',
			};
		} catch (e) {
			const error = e as Error;
			console.error('[BrowserService] 截图失败:', error.message);
			return {
				success: false,
				imageData: '',
				format: 'png',
				message: `截图失败: ${error.message}`,
			};
		}
	}
}

// 导出单例
export const browserService = new BrowserService();