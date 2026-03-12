/**
 * 统一的浏览器管理器
 * 合并 browser-service.ts 和 browser.ts 的功能
 * 简化设计，单一职责
 */

import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserConfig, BrowserState, PageState, PageElement, BrowserType } from './types.js';
import { launchBrowser, getDefaultConfig, clearSessionRestore, DEFAULT_USER_DATA_DIR } from './launcher.js';
import { getPageEvaluatorScript } from './page-evaluator.js';
import { Logger } from '../../utils/logger.js';

// 动态导入配置管理器
async function getConfigManager() {
	const { configManager } = await import('../../utils/config.js');
	return configManager;
}

export class BrowserManager {
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private config: BrowserConfig;
	private logger: Logger;
	private elementCache: PageElement[] = [];

	constructor(config?: Partial<BrowserConfig>) {
		this.config = { ...getDefaultConfig(), ...config };
		this.logger = new Logger().init({ prefix: 'BrowserManager' });
	}

	/**
	 * 从全局配置加载浏览器配置
	 */
	private async loadConfigFromGlobal(): Promise<Partial<BrowserConfig>> {
		try {
			const configManager = await getConfigManager();
			const browserPath = configManager.get<string | null>('tools.browser.browserPath', null);
			
			if (!browserPath) {
				return {};
			}

			// 根据路径判断浏览器类型
			let type: BrowserType = 'chromium';
			if (browserPath.toLowerCase().includes('edge') || browserPath.toLowerCase().includes('msedge')) {
				type = 'edge';
			} else if (browserPath.toLowerCase().includes('chrome')) {
				type = 'chrome';
			}

			return {
				type,
				executablePath: browserPath,
				headless: configManager.get('tools.browser.headless', false),
				navigationTimeout: configManager.get('tools.browser.timeout', 60000),
			};
		} catch {
			return {};
		}
	}

	/**
	 * 启动浏览器
	 * 使用持久化上下文，保持登录状态
	 */
	async launch(config?: Partial<BrowserConfig>): Promise<void> {
		if (this.context) {
			this.logger.warn('浏览器已经启动');
			return;
		}

		// 加载全局配置
		const globalConfig = await this.loadConfigFromGlobal();

		// 合并配置：默认配置 < 全局配置 < 传入配置
		this.config = { ...this.config, ...globalConfig, ...config };

		this.logger.info(`启动浏览器: ${this.config.type}, 路径: ${this.config.executablePath || '自动检测'}`);

		// 清理会话恢复文件，防止自动恢复旧标签页
		await clearSessionRestore(this.config.userDataDir);

		// 启动浏览器
		this.context = await launchBrowser(this.config);

		// 获取或创建页面
		const pages = this.context.pages();
		if (pages.length > 0) {
			// 使用第一个页面，关闭其他页面
			this.page = pages[0];
			for (let i = 1; i < pages.length; i++) {
				try {
					await pages[i].close();
				} catch {
					// 忽略关闭错误
				}
			}
		} else {
			// 创建新页面
			this.page = await this.context.newPage();
		}

		// 设置默认超时
		this.page.setDefaultTimeout(this.config.navigationTimeout ?? 30000);

		this.logger.info('浏览器启动成功');
	}

	/**
	 * 关闭浏览器
	 */
	async close(): Promise<void> {
		if (!this.context) {
			return;
		}

		this.logger.info('关闭浏览器');
		
		try {
			await this.context.close();
		} catch (error) {
			this.logger.error('关闭浏览器失败', error);
		}

		this.context = null;
		this.page = null;
		this.elementCache = [];
	}

	/**
	 * 获取浏览器状态
	 */
	async getState(): Promise<BrowserState> {
		// 检查浏览器是否真的在运行（用户可能手动关闭了窗口）
		let isRunning = false;
		let pageCount = 0;
		
		if (this.context) {
			try {
				// 尝试获取页面列表，如果 context 已关闭会抛出错误
				const pages = this.context.pages();
				pageCount = pages.length;
				// 检查是否至少有一个页面是打开的
				isRunning = pages.some(p => !p.isClosed());
				
				// 如果浏览器已关闭，清理引用
				if (!isRunning) {
					this.logger.info('检测到浏览器窗口已关闭，清理引用');
					this.context = null;
					this.page = null;
					this.elementCache = [];
				}
			} catch {
				// context 已失效
				this.logger.info('浏览器上下文已失效，清理引用');
				this.context = null;
				this.page = null;
				this.elementCache = [];
				isRunning = false;
			}
		}
		
		const title = this.page && isRunning ? await this.page.title().catch(() => '') : '';
		return {
			isRunning,
			browserType: this.config.type,
			currentUrl: this.page && isRunning ? this.page.url() : '',
			currentTitle: title,
			pageCount
		};
	}

	/**
	 * 导航到指定 URL
	 */
	async goto(url: string): Promise<PageState> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		this.logger.info(`导航到: ${url}`);

		// 确保 URL 格式正确
		const targetUrl = url.startsWith('http') ? url : `https://${url}`;

		// 导航到目标页面
		await this.page.goto(targetUrl, {
			waitUntil: 'domcontentloaded',
			timeout: this.config.navigationTimeout
		});

		// 等待页面稳定
		await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
			// 忽略超时错误
		});

		// 获取页面状态
		return this.getPageState();
	}

	/**
	 * 获取交互元素选择器（与 page-evaluator.ts 保持一致）
	 */
	private getInteractiveSelectors(): string[] {
		return [
			'a', 'button', 'input', 'textarea', 'select',
			'[role="button"]', '[role="link"]', '[role="input"]', '[role="textbox"]',
			'[onclick]', '[tabindex]:not([tabindex="-1"])'
		];
	}

	/**
	 * 点击元素
	 */
	async click(elementIndex: number): Promise<PageState> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		const element = this.elementCache[elementIndex];
		if (!element) {
			throw new Error(`元素索引 ${elementIndex} 不存在`);
		}

		this.logger.info(`点击元素: ${element.name || element.text || elementIndex}`);

		// 在页面中查找并模拟真实点击（聚焦、鼠标事件、点击）
		await this.page.evaluate((data: { index: number; selectors: string[] }) => {
			const { index, selectors } = data;
			const elements = document.querySelectorAll(selectors.join(', '));
			let count = 0;
			for (let i = 0; i < elements.length; i++) {
				const el = elements[i];
				if ((el as HTMLElement).offsetParent !== null) {
					if (count === index) {
						const htmlEl = el as HTMLElement;
						
						// 聚焦元素
						htmlEl.focus();
						
						// 模拟鼠标事件序列
						htmlEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
						htmlEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
						htmlEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
						
						// 执行点击
						htmlEl.click();
						
						// 鼠标抬起
						htmlEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
						
						return;
					}
					count++;
				}
			}
		}, { index: elementIndex, selectors: this.getInteractiveSelectors() });

		// 等待页面加载
		await this.page.waitForTimeout(1000);
		await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

		return this.getPageState();
	}

	/**
	 * 输入文本
	 */
	async input(elementIndex: number, text: string): Promise<PageState> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		const element = this.elementCache[elementIndex];
		if (!element) {
			throw new Error(`元素索引 ${elementIndex} 不存在`);
		}

		this.logger.info(`输入文本到: ${element.name || elementIndex}`);

		// 在页面中查找并输入（模拟真实用户行为：聚焦、清空、输入）
		await this.page.evaluate((data: { index: number; text: string; selectors: string[] }) => {
			const { index, text, selectors } = data;
			const inputs = document.querySelectorAll(selectors.join(', '));
			let count = 0;
			for (let i = 0; i < inputs.length; i++) {
				const el = inputs[i];
				if ((el as HTMLElement).offsetParent !== null) {
					if (count === index) {
						const htmlEl = el as HTMLElement;
						if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
							// 聚焦元素
							htmlEl.focus();
							// 选中所有内容（如果有）
							el.select();
							// 清空当前值
							el.value = '';
							el.dispatchEvent(new Event('input', { bubbles: true }));
							// 输入新文本
							el.value = text;
							el.dispatchEvent(new Event('input', { bubbles: true }));
							el.dispatchEvent(new Event('change', { bubbles: true }));
						} else if (el.getAttribute('contenteditable') === 'true') {
							htmlEl.focus();
							el.textContent = text;
							el.dispatchEvent(new Event('input', { bubbles: true }));
						}
						return;
					}
					count++;
				}
			}
		}, { index: elementIndex, text, selectors: this.getInteractiveSelectors() });

		return this.getPageState();
	}

	/**
	 * 返回上一页
	 */
	async back(): Promise<PageState> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		this.logger.info('返回上一页');

		// 尝试浏览器后退
		const canGoBack = await this.page.evaluate(() => window.history.length > 1);
		
		if (canGoBack) {
			await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
		} else {
			this.logger.warn('没有历史记录可返回');
		}

		return this.getPageState();
	}

	/**
	 * 获取当前页面状态
	 */
	async getPageState(): Promise<PageState> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		// 执行页面评估脚本
		const result = await this.page.evaluate(getPageEvaluatorScript()) as {
			url: string;
			title: string;
			elements: Array<{
				type: string;
				tag: string;
				text: string;
				name: string;
				class?: string;
				isInteractive: boolean;
			}>;
			content: string;
		};

		// 更新元素缓存
		this.elementCache = result.elements.map((el, index: number) => ({
			...el,
			index
		}));

		return {
			url: result.url,
			title: result.title,
			elements: this.elementCache,
			content: result.content
		};
	}

	/**
	 * 截图
	 */
	async screenshot(): Promise<string> {
		if (!this.page) {
			throw new Error('浏览器未启动');
		}

		const buffer = await this.page.screenshot({
			type: 'png',
			fullPage: false
		});

		return buffer.toString('base64');
	}

	/**
	 * 获取当前页面
	 */
	getPage(): Page | null {
		return this.page;
	}

	/**
	 * 获取当前上下文
	 */
	getContext(): BrowserContext | null {
		return this.context;
	}

	/**
	 * 获取用户数据目录
	 */
	static getDefaultUserDataDir(): string {
		return DEFAULT_USER_DATA_DIR;
	}
}

// 导出单例实例
export const browserManager = new BrowserManager();
