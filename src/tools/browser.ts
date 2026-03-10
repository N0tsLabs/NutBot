/**
 * 浏览器自动化工具 - 简化版
 *
 * 核心设计（参考 browser-use）：
 * 1. 用 accessibility tree 获取页面可交互元素
 * 2. 数字索引标记元素，AI 只需要说"点 5 号"
 * 3. 纯 Playwright，不依赖任何浏览器插件
 */

import { BaseTool } from './registry.js';
import type { Page, BrowserContext } from 'playwright';

// 元素信息
interface ElementInfo {
	index: number;
	role: string;
	name: string;
	selector: string; // 用于实际点击的定位器
	url?: string; // 链接地址（仅 a 标签有）
}

// 页面状态
interface PageState {
	url: string;
	title: string;
	elements: string[]; // 格式化后的元素列表，如 "[0] button: 搜索"
	content?: string; // 页面主要内容文本
}

export class BrowserTool extends BaseTool {
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private playwrightAvailable = false;
	private elementMap: Map<number, ElementInfo> = new Map();
	private initPromise: Promise<void> | null = null;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'browser',
			description: `浏览器自动化工具。通过数字索引操作网页元素。

【使用流程】
1. goto(url) - 访问网页
2. state() - 获取当前页面元素列表（返回 [0], [1], [2]... 编号）
3. click(index) / type(index, text) - 操作指定编号的元素
4. 重复 2-3 直到完成任务

【示例】
用户：搜索B站视频
→ browser.goto("https://search.bilibili.com")
→ browser.state() 返回 "[0] searchbox: 搜索框, [1] button: 搜索"
→ browser.type(0, "影视飓风")
→ browser.click(1)

【规则】
- 每次操作后自动返回新页面状态
- 如果元素找不到会报错，需要重新 state() 获取最新列表`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: ['goto', 'state', 'click', 'type', 'press', 'scroll', 'tabs', 'switch_tab', 'back', 'close'],
				},
				url: {
					type: 'string',
					description: 'goto 的目标网址',
				},
				index: {
					type: 'number',
					description: '元素编号（从 state 结果获取）',
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
				key: {
					type: 'string',
					description: 'press 操作的按键：Enter, Tab, Escape, ArrowDown 等',
				},
				direction: {
					type: 'string',
					description: 'scroll 方向：up, down',
					enum: ['up', 'down'],
				},
			},
			...config,
		});

		this.initPromise = this.checkPlaywright();
	}

	private async checkPlaywright(): Promise<void> {
		try {
			await import('playwright');
			this.playwrightAvailable = true;
		} catch {
			this.playwrightAvailable = false;
			this.logger.warn('Playwright 未安装。安装: npm install playwright && npx playwright install chromium');
		}
	}

	async execute(params: Record<string, unknown>): Promise<unknown> {
		// 等待初始化完成
		if (this.initPromise) {
			await this.initPromise;
		}

		if (!this.playwrightAvailable) {
			throw new Error('Playwright 未安装。请运行:\nnpm install playwright\nnpx playwright install chromium');
		}

		const { action } = params;

		switch (action) {
			case 'goto':
				if (!params.url) throw new Error('goto 需要 url 参数');
				return await this.goto(params.url as string);
			case 'state':
				return await this.getState();
			case 'click':
				if (params.index === undefined) throw new Error('click 需要 index 参数');
				return await this.click(params.index as number);
			case 'type':
				if (params.index === undefined) throw new Error('type 需要 index 参数');
				if (!params.text) throw new Error('type 需要 text 参数');
				return await this.type(params.index as number, params.text as string);
			case 'press':
				if (!params.key) throw new Error('press 需要 key 参数');
				return await this.press(params.key as string);
			case 'scroll':
				return await this.scroll((params.direction as string) || 'down');
			case 'tabs':
				return await this.listTabs();
			case 'switch_tab':
				if (params.tab_index === undefined) throw new Error('switch_tab 需要 tab_index 参数');
				return await this.switchTab(params.tab_index as number);
			case 'back':
				return await this.goBack();
			case 'close':
				return await this.close();
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 确保浏览器已启动
	 */
	private async ensureBrowser(): Promise<Page> {
		if (this.page && !this.page.isClosed()) {
			return this.page;
		}

		const { chromium } = await import('playwright');

		// 尝试启动 Edge/Chrome（保留用户登录态）
		const edgePath = this.getBrowserPath('edge');
		const chromePath = this.getBrowserPath('chrome');

		this.logger.info(`尝试启动浏览器... Edge路径: ${edgePath}, Chrome路径: ${chromePath}`);

		// 优先尝试 Edge
		if (edgePath) {
			try {
				this.logger.info('正在启动 Edge...');
				this.context = await chromium.launchPersistentContext('', {
					headless: false,
					channel: 'msedge',
					args: ['--start-maximized', '--window-size=1920,1080'],
					viewport: null, // 使用实际窗口大小
				});
				this.page = this.context.pages()[0] || await this.context.newPage();
				await this.page.bringToFront(); // 确保窗口在前台
				this.logger.info('浏览器已启动 (Edge)');
				return this.page;
			} catch (e: any) {
				this.logger.warn('Edge 启动失败:', e.message);
			}
		}

		// 回退到 Chrome
		if (chromePath) {
			try {
				this.logger.info('正在启动 Chrome...');
				this.context = await chromium.launchPersistentContext('', {
					headless: false,
					channel: 'chrome',
					args: ['--start-maximized', '--window-size=1920,1080'],
					viewport: null,
				});
				this.page = this.context.pages()[0] || await this.context.newPage();
				await this.page.bringToFront();
				this.logger.info('浏览器已启动 (Chrome)');
				return this.page;
			} catch (e: any) {
				this.logger.warn('Chrome 启动失败:', e.message);
			}
		}

		// 最后回退到 Chromium
		this.logger.info('正在启动 Chromium...');
		this.context = await chromium.launchPersistentContext('', {
			headless: false,
			args: ['--start-maximized', '--window-size=1920,1080'],
			viewport: null,
		});
		this.page = this.context.pages()[0] || await this.context.newPage();
		await this.page.bringToFront();
		this.logger.info('浏览器已启动 (Chromium)');
		return this.page;
	}

	private getBrowserPath(browser: 'edge' | 'chrome'): string | null {
		const { platform } = process;

		if (browser === 'edge') {
			if (platform === 'win32') {
				return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
			}
			if (platform === 'darwin') return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
			return 'microsoft-edge';
		}

		if (browser === 'chrome') {
			if (platform === 'win32') {
				return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
			}
			if (platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
			return 'google-chrome';
		}

		return null;
	}

	/**
	 * 获取页面状态：URL + 标题 + 可交互元素列表
	 */
	private async getState(): Promise<PageState & { success: boolean }> {
		const page = await this.ensureBrowser();

		// 使用 evaluate 获取页面可交互元素
		const pageData = await page.evaluate(() => {
			interface ElementInfo {
				tag: string;
				role: string;
				name: string;
				url?: string;
				top: number;
				left: number;
				el: HTMLElement; // 临时保存元素引用
			}

			const interactiveElements: ElementInfo[] = [];

			// 查找所有可交互元素
			const selectors = [
				'a[href]',
				'button',
				'input:not([type="hidden"])',
				'select',
				'textarea',
				'[role="button"]',
				'[role="link"]',
				'[role="textbox"]',
				'[role="searchbox"]',
				'[role="combobox"]',
				'[onclick]'
			];

			const seen = new Set<string>();

			selectors.forEach((sel) => {
				const els = document.querySelectorAll(sel);
				els.forEach((el) => {
					const htmlEl = el as HTMLElement;

					// 跳过不可见元素
					if (htmlEl.offsetParent === null && sel !== 'a[href]') return;

					// 生成唯一标识
					const rect = htmlEl.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) return;

					// 获取元素文本或属性
					let name = '';
					if (htmlEl instanceof HTMLInputElement || htmlEl instanceof HTMLTextAreaElement) {
						name = htmlEl.placeholder || htmlEl.value || htmlEl.name || '';
					} else if (htmlEl instanceof HTMLButtonElement || htmlEl instanceof HTMLAnchorElement) {
						name = htmlEl.textContent?.trim() || htmlEl.title || '';
					} else {
						name = htmlEl.textContent?.trim() || htmlEl.getAttribute('aria-label') || htmlEl.title || '';
					}

					// 获取 role
					let role = htmlEl.getAttribute('role') || '';
					if (!role) {
						if (htmlEl instanceof HTMLAnchorElement) role = 'link';
						else if (htmlEl instanceof HTMLButtonElement) role = 'button';
						else if (htmlEl instanceof HTMLInputElement) {
							if (htmlEl.type === 'text' || htmlEl.type === 'search') role = 'textbox';
							else role = htmlEl.type;
						}
						else if (htmlEl instanceof HTMLSelectElement) role = 'combobox';
						else if (htmlEl instanceof HTMLTextAreaElement) role = 'textbox';
					}

					// 去重
					const key = `${role}:${name}:${rect.x}:${rect.y}`;
					if (seen.has(key)) return;
					seen.add(key);

					// 获取链接 URL
					let url: string | undefined;
					if (htmlEl instanceof HTMLAnchorElement) {
						url = htmlEl.href;
					}

					interactiveElements.push({
						tag: htmlEl.tagName.toLowerCase(),
						role,
						name: name.slice(0, 50),
						url,
						top: rect.top,
						left: rect.left,
						el: htmlEl
					});
				});
			});

			// 按位置排序（从上到下，从左到右）
			interactiveElements.sort((a, b) => {
				if (Math.abs(a.top - b.top) < 50) {
					return a.left - b.left;
				}
				return a.top - b.top;
			});

			// 给元素添加 data-nutbot-index 属性，并生成结果
			const result = interactiveElements.map((item, index) => {
				item.el.setAttribute('data-nutbot-index', String(index));
				return {
					tag: item.tag,
					role: item.role,
					name: item.name,
					url: item.url
				};
			});

			// 获取页面主要内容 - 让 AI 自己理解
			// 移除导航、脚本等无关内容，保留核心文本
			const body = document.body.cloneNode(true) as HTMLElement;
			const removeSelectors = 'script, style, nav, footer, header, aside, [role="navigation"], [role="banner"], .ad, .advertisement, .sidebar';
			body.querySelectorAll(removeSelectors).forEach(s => s.remove());
			const content = body.innerText || '';

			return {
				elements: result,
				content: content.trim() // 不限制大小，让 AI 自己理解
			};
		});

		// 清空并重建元素映射
		this.elementMap.clear();
		const elements: string[] = [];

		pageData.elements.forEach((el, index) => {
			const displayName = el.name || '(无名称)';
			this.elementMap.set(index, {
				index,
				role: el.role,
				name: displayName,
				selector: `[data-nutbot-index="${index}"]`,
				url: el.url
			});
			// 如果是链接元素且有 URL，显示 URL 信息
			if (el.url) {
				elements.push(`[${index}] ${el.role || el.tag}: ${displayName.slice(0, 40)} | URL: ${el.url}`);
			} else {
				elements.push(`[${index}] ${el.role || el.tag}: ${displayName.slice(0, 40)}`);
			}
		});

		this.logger.info(`页面状态: ${elements.length} 个可交互元素`);

		return {
			success: true,
			url: page.url(),
			title: await page.title(),
			elements,
			content: pageData.content
		};
	}

	/**
	 * 根据 accessibility node 生成 Playwright 选择器
	 */
	private generateSelector(node: any, index: number): string {
		// 优先级：role + name > testid > id > class
		if (node.name) {
			// 用 aria-label 或文字内容定位
			return `[aria-label="${node.name}"]`;
		}
		if (node.value) {
			return `[value="${node.value}"]`;
		}
		// 兜底：用 role 和索引
		return `[role="${node.role}"]:nth-of-type(${index + 1})`;
	}

	/**
	 * 访问 URL
	 */
	private async goto(url: string): Promise<PageState & { success: boolean; action: string }> {
		const page = await this.ensureBrowser();

		// 确保 URL 有协议
		const fullUrl = url.startsWith('http') ? url : `https://${url}`;

		await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

		this.logger.info(`已访问: ${fullUrl}`);

		// 自动返回状态
		const state = await this.getState();
		return { ...state, action: 'goto' };
	}

	/**
	 * 点击元素
	 */
	private async click(index: number): Promise<PageState & { success: boolean; action: string; clicked: string; newTab?: boolean }> {
		const page = await this.ensureBrowser();
		const element = this.elementMap.get(index);

		if (!element) {
			throw new Error(`找不到索引为 ${index} 的元素，请先执行 state() 获取最新列表`);
		}

		// 记录点击前的标签页数量
		const pagesBefore = this.context ? this.context.pages().length : 1;

		// 使用 locator 点击
		try {
			await page.locator(element.selector).first().click({ timeout: 5000 });
		} catch {
			// 如果失败，尝试 JavaScript 点击
			await page.evaluate((sel) => {
				const el = document.querySelector(sel);
				if (el) (el as HTMLElement).click();
			}, element.selector);
		}

		this.logger.info(`已点击 [${index}] ${element.role}: ${element.name}`);

		// 等待页面稳定或新标签页打开
		await page.waitForTimeout(1000);

		// 检查是否有新标签页打开
		if (this.context) {
			const pagesAfter = this.context.pages();
			if (pagesAfter.length > pagesBefore) {
				// 有新标签页打开，自动切换到新标签页
				const newPage = pagesAfter[pagesAfter.length - 1];
				this.page = newPage;
				await newPage.bringToFront();
				this.logger.info(`检测到新标签页，已自动切换: ${newPage.url()}`);
				
				// 等待新页面加载
				await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
				
				const state = await this.getState();
				return { ...state, action: 'click', clicked: `[${index}] ${element.name}`, newTab: true };
			}
		}

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'click', clicked: `[${index}] ${element.name}` };
	}

	/**
	 * 输入文本
	 */
	private async type(index: number, text: string): Promise<PageState & { success: boolean; action: string; typed: string }> {
		const page = await this.ensureBrowser();
		const element = this.elementMap.get(index);

		if (!element) {
			throw new Error(`找不到索引为 ${index} 的元素，请先执行 state() 获取最新列表`);
		}

		// 使用 locator 填充
		await page.locator(element.selector).first().fill(text, { timeout: 5000 });

		this.logger.info(`已在 [${index}] 输入: ${text}`);

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'type', typed: text };
	}

	/**
	 * 按键
	 */
	private async press(key: string): Promise<PageState & { success: boolean; action: string; pressed: string }> {
		const page = await this.ensureBrowser();

		await page.keyboard.press(key);
		this.logger.info(`已按键: ${key}`);

		// 等待页面响应（比如搜索提交后跳转）
		await page.waitForTimeout(1000);

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'press', pressed: key };
	}

	/**
	 * 滚动页面
	 */
	private async scroll(direction: string): Promise<PageState & { success: boolean; action: string }> {
		const page = await this.ensureBrowser();

		const delta = direction === 'up' ? -800 : 800;
		await page.evaluate((d) => window.scrollBy(0, d), delta);

		this.logger.info(`已滚动: ${direction}`);

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'scroll' };
	}

	/**
	 * 列出所有标签页
	 */
	private async listTabs(): Promise<{ success: boolean; action: string; tabs: Array<{ index: number; url: string; title: string; active: boolean }> }> {
		if (!this.context) {
			return { success: true, action: 'tabs', tabs: [] };
		}

		const pages = this.context.pages();
		const tabs = await Promise.all(
			pages.map(async (p, i) => ({
				index: i,
				url: p.url(),
				title: await p.title().catch(() => ''),
				active: p === this.page,
			}))
		);

		this.logger.info(`当前有 ${tabs.length} 个标签页`);
		return { success: true, action: 'tabs', tabs };
	}

	/**
	 * 切换到指定标签页
	 */
	private async switchTab(tabIndex: number): Promise<PageState & { success: boolean; action: string; switched_to: number }> {
		if (!this.context) {
			throw new Error('浏览器上下文未初始化');
		}

		const pages = this.context.pages();
		if (tabIndex < 0 || tabIndex >= pages.length) {
			throw new Error(`无效的标签页索引: ${tabIndex}，当前有 ${pages.length} 个标签页`);
		}

		this.page = pages[tabIndex];
		await this.page.bringToFront();
		this.logger.info(`已切换到标签页 ${tabIndex}: ${this.page.url()}`);

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'switch_tab', switched_to: tabIndex };
	}

	/**
	 * 返回上一页
	 */
	private async goBack(): Promise<PageState & { success: boolean; action: string }> {
		const page = await this.ensureBrowser();

		await page.goBack({ waitUntil: 'domcontentloaded' });
		this.logger.info('已返回上一页');

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'back' };
	}

	/**
	 * 关闭浏览器
	 */
	private async close(): Promise<{ success: boolean; message: string }> {
		if (this.context) {
			await this.context.close();
			this.context = null;
			this.page = null;
			this.elementMap.clear();
			this.logger.info('浏览器已关闭');
		}
		return { success: true, message: '浏览器已关闭' };
	}

	async cleanup(): Promise<void> {
		await this.close();
	}

	isOpen(): boolean {
		return this.page !== null && !this.page.isClosed();
	}
}

export default BrowserTool;
