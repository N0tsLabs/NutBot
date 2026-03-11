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
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { systemInfo } from './exec.js';

// 浏览器截图保存目录
const BROWSER_SCREENSHOT_DIR = join(systemInfo.homedir, '.nutbot', 'browser-screenshots');

// 确保目录存在
if (!existsSync(BROWSER_SCREENSHOT_DIR)) {
	mkdirSync(BROWSER_SCREENSHOT_DIR, { recursive: true });
}

// 元素信息
interface ElementInfo {
	index: number;
	role: string;
	name: string;
	selector: string; // 用于实际点击的定位器
	url?: string; // 链接地址（仅 a 标签有）
	elementType: ElementType; // 元素类型分类
	priority: number; // 优先级（数值越小优先级越高）
	description?: string; // 额外描述信息
}

// 元素类型枚举
type ElementType = 'search' | 'navigation' | 'content' | 'promotion' | 'form' | 'button' | 'link' | 'other';

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
1. goto(url) - 访问网页（自动返回页面状态）
2. click(index) / type(index, text) - 操作指定编号的元素（自动返回页面状态）
3. 根据返回的最新元素列表继续操作

【自动 State 机制】
以下操作执行后会自动获取并返回页面状态（URL、标题、可交互元素列表）：
- goto - 导航到新页面后
- click - 点击元素后
- new_tab - 打开新标签页后
- back / forward - 浏览器前进后退后
- refresh - 刷新页面后
- type / fill - 输入内容后
- press - 按键后
- scroll - 滚动后
- switch_tab - 切换标签页后

【重要规则】
- 每次操作后页面元素索引会重新分配
- 使用返回的最新元素列表中的索引进行下一次操作
- 不要使用之前返回的过期索引，它们可能已经无效
- 如果元素找不到会报错，需要重新获取最新列表

【元素类型说明】
元素列表中的每个元素都有类型标记，帮助识别：
- [SEARCH] - 搜索框，最高优先级，通常是需要输入的地方
- [NAVIGATION] - 导航链接，如首页、分类等
- [FORM] - 表单输入框（可输入）
- [BUTTON] - 按钮（仅可点击，不可输入）
- [LINK] - 普通链接（仅可点击，不可输入）
- [PROMOTION] - 推广/广告，低优先级，尽量避免点击

【type 操作重要警告】
type 操作只能用于可输入元素（input、textarea、select、[contenteditable]）
禁止对以下元素使用 type 操作：
   - 按钮（BUTTON 类型）
   - 链接（LINK 类型）
   - 导航元素（NAVIGATION 类型）
只能对以下元素使用 type 操作：
   - 搜索框（SEARCH 类型）
   - 表单输入框（FORM 类型）
如果尝试对不可输入元素使用 type 操作，会报错："Element is not an <input>, <textarea>, <select> or [contenteditable]"

【避免误点推广链接】
警告：页面顶部常有推广横幅/广告，请注意：
1. 优先点击带有明确文本描述的元素（如"搜索"、"登录"）
2. 避免点击无名称或名称可疑的元素（如"点击领取"、"限时优惠"）
3. 注意元素类型标记：[PROMOTION] 表示可能是广告
4. 搜索框通常是 [SEARCH] 类型，优先选择此类元素进行搜索
5. 如果不确定，可以先截图查看页面布局

【选择元素的建议】
- 搜索功能：找 [SEARCH] 类型的输入框
- 导航跳转：找 [NAVIGATION] 类型的链接（只能 click）
- 提交表单：找 [BUTTON] 类型的按钮（只能 click）
- 输入文本：找 [FORM] 类型的输入框
- 避免点击：[PROMOTION] 类型的元素

【搜索场景优化建议】
如果页面搜索功能复杂或搜索框难以定位，可以直接使用 goto 跳转到搜索 URL：
- B站搜索：https://search.bilibili.com/all?keyword=关键词
- 百度搜索：https://www.baidu.com/s?wd=关键词
- Google搜索：https://www.google.com/search?q=关键词
这样可以绕过在页面上查找搜索框的步骤，直接获取搜索结果。

【截图功能说明】
- screenshot action: 截取浏览器页面截图，保存为文件并返回文件路径
- 使用场景：需要查看网页当前状态、确认页面布局、验证操作结果
- 与系统截图工具的区别：browser screenshot 专门用于截取浏览器页面，而非整个屏幕`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: ['goto', 'state', 'click', 'type', 'press', 'scroll', 'tabs', 'switch_tab', 'new_tab', 'back', 'forward', 'refresh', 'close', 'screenshot'],
				},
			url: {
				type: 'string',
				description: 'goto 或 new_tab 的目标网址。搜索场景建议：可直接使用搜索URL如 https://search.bilibili.com/all?keyword=关键词',
			},
				index: {
					type: 'number',
					description: '元素编号（必须从最新的 state 结果获取，每次操作后索引会重新分配）',
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本。⚠️ 注意：type 只能用于可输入元素（input、textarea、select），不能用于按钮或链接！',
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
				fullPage: {
					type: 'boolean',
					description: 'screenshot 操作是否截取整个页面（默认 false，只截取可视区域）。注意：此截图仅截取浏览器页面内容，保存为文件后返回文件路径',
				},
				selector: {
					type: 'string',
					description: 'screenshot 操作可选，截取特定元素的选择器',
				},
				tab_index: {
					type: 'number',
					description: 'switch_tab 操作的目标标签页索引（从 tabs 操作返回的列表中获取）',
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
			case 'new_tab':
				if (!params.url) throw new Error('new_tab 需要 url 参数');
				return await this.newTab(params.url as string);
			case 'back':
				return await this.goBack();
			case 'forward':
				return await this.goForward();
			case 'refresh':
				return await this.refresh();
			case 'close':
				return await this.close();
			case 'screenshot':
				return await this.screenshot(params.fullPage as boolean | undefined, params.selector as string | undefined);
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
		// 使用字符串形式传递 JavaScript 代码，避免 TypeScript 编译问题
		const pageData = await page.evaluate(`
			(function() {
				const HIGH_PRIORITY_SELECTORS = [
					'input[type="search"]',
					'[role="searchbox"]',
					'input[placeholder*="搜索"]',
					'input[placeholder*="search"]',
					'input[name*="search" i]',
					'input[name*="keyword" i]',
					'input[name*="query" i]',
					'input[id*="search" i]',
					'input[id*="keyword" i]',
					'input[class*="search" i]',
					'input[class*="search-input" i]',
					'[data-search]',
					'.search-input',
					'.search-box input',
					'.search-form input',
					'form[action*="search"] input[type="text"]'
				];

				const LOW_PRIORITY_SELECTORS = [
					'.banner', '.ad-banner', '.promo-banner', '.advertisement',
					'[class*="promo"]', '[class*="ad-"]', '[class*="banner"]',
					'[id*="promo"]', '[id*="ad-"]', '[id*="banner"]'
				];

				const SEARCH_KEYWORDS = ['搜索', 'search', 'query', 'find', '查找', 'query-input', 'keyword', '关键词', 'bilibili搜索', 'b站搜索'];
				const NAV_KEYWORDS = ['首页', 'home', '导航', 'nav', '菜单', 'menu', '分类', 'category'];
				const PROMO_KEYWORDS = [
					'广告', '推广', '赞助', '活动', '限时', '优惠', '抢购', '热卖', '爆款',
					'ad', 'promo', 'sponsored', 'campaign', 'limited', 'sale', 'hot',
					'上B站看', '点击领取', '立即参与', '马上抢', '点击查看'
				];

				const interactiveElements = [];
				const selectors = [
					'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
					'[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]',
					'[role="combobox"]', '[onclick]'
				];
				const seen = new Set();

				function matchesSelector(el, selectorList) {
					for (let i = 0; i < selectorList.length; i++) {
						try {
							if (el.matches(selectorList[i])) return true;
						} catch (e) {}
					}
					return false;
				}

				function containsKeyword(text, keywords) {
					const lowerText = text.toLowerCase();
					for (let i = 0; i < keywords.length; i++) {
						if (lowerText.indexOf(keywords[i].toLowerCase()) !== -1) return true;
					}
					return false;
				}

				function classifyElement(el, name, role) {
					const tagName = el.tagName.toLowerCase();
					const className = (el.className && el.className.toString().toLowerCase()) || '';
					const id = (el.id && el.id.toLowerCase()) || '';
					const placeholder = (el.placeholder && el.placeholder.toLowerCase()) || '';
					const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
					const fullText = name + ' ' + placeholder + ' ' + ariaLabel + ' ' + className + ' ' + id;

					if (matchesSelector(el, HIGH_PRIORITY_SELECTORS) ||
						containsKeyword(fullText, SEARCH_KEYWORDS) ||
						role === 'searchbox' ||
						(tagName === 'input' && el.type === 'search')) {
						return { type: 'search', priority: 1, description: '搜索输入框' };
					}

					if (containsKeyword(fullText, NAV_KEYWORDS) ||
						role === 'navigation' ||
						className.indexOf('nav') !== -1 ||
						className.indexOf('menu') !== -1 ||
						id.indexOf('nav') !== -1 ||
						id.indexOf('menu') !== -1) {
						return { type: 'navigation', priority: 2, description: '导航链接' };
					}

					if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
						role === 'textbox' || role === 'combobox') {
						return { type: 'form', priority: 3, description: (el.type || 'text') + '输入框' };
					}

					if (tagName === 'button' || role === 'button' || el.hasAttribute('onclick')) {
						return { type: 'button', priority: 4, description: '按钮' };
					}

					if (matchesSelector(el, LOW_PRIORITY_SELECTORS) ||
						containsKeyword(fullText, PROMO_KEYWORDS) ||
						className.indexOf('promo') !== -1 ||
						className.indexOf('ad-') !== -1 ||
						className.indexOf('banner') !== -1 ||
						id.indexOf('promo') !== -1 ||
						id.indexOf('ad-') !== -1 ||
						id.indexOf('banner') !== -1) {
						return { type: 'promotion', priority: 100, description: '推广/广告' };
					}

					if (tagName === 'a' || role === 'link') {
						if (!name || name === '(无名称)' || name.length < 2) {
							return { type: 'promotion', priority: 90, description: '可疑链接(无文本)' };
						}
						return { type: 'link', priority: 5, description: '链接' };
					}

					return { type: 'other', priority: 10 };
				}

				for (let s = 0; s < selectors.length; s++) {
					const els = document.querySelectorAll(selectors[s]);
					for (let e = 0; e < els.length; e++) {
						const el = els[e];
						if (el.offsetParent === null && selectors[s] !== 'a[href]') continue;
						const rect = el.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) continue;

						let name = '';
						const tag = el.tagName.toLowerCase();
						if (tag === 'input' || tag === 'textarea') {
							name = el.placeholder || el.value || el.name || '';
						} else if (tag === 'button' || tag === 'a') {
							name = (el.textContent && el.textContent.trim()) || el.title || '';
						} else {
							name = (el.textContent && el.textContent.trim()) || el.getAttribute('aria-label') || el.title || '';
						}

						let role = el.getAttribute('role') || '';
						if (!role) {
							if (tag === 'a') role = 'link';
							else if (tag === 'button') role = 'button';
							else if (tag === 'input') {
								if (el.type === 'text' || el.type === 'search') role = 'textbox';
								else role = el.type;
							}
							else if (tag === 'select') role = 'combobox';
							else if (tag === 'textarea') role = 'textbox';
						}

						const key = role + ':' + name + ':' + rect.x + ':' + rect.y;
						if (seen.has(key)) continue;
						seen.add(key);

						let url = undefined;
						if (tag === 'a') url = el.href;

						const classification = classifyElement(el, name, role);
						interactiveElements.push({
							tag: tag,
							role: role,
							name: name.slice(0, 50),
							url: url,
							top: rect.top,
							left: rect.left,
							el: el,
							elementType: classification.type,
							priority: classification.priority,
							description: classification.description
						});
					}
				}

				interactiveElements.sort(function(a, b) {
					if (a.priority !== b.priority) return a.priority - b.priority;
					if (Math.abs(a.top - b.top) < 50) return a.left - b.left;
					return a.top - b.top;
				});

				const result = [];
				for (let i = 0; i < interactiveElements.length; i++) {
					const item = interactiveElements[i];
					item.el.setAttribute('data-nutbot-index', String(i));
					result.push({
						tag: item.tag,
						role: item.role,
						name: item.name,
						url: item.url,
						elementType: item.elementType,
						priority: item.priority,
						description: item.description
					});
				}

				const body = document.body.cloneNode(true);
				const removeSelectors = 'script, style, nav, footer, header, aside, [role="navigation"], [role="banner"], .ad, .advertisement, .sidebar';
				const toRemove = body.querySelectorAll(removeSelectors);
				for (let i = 0; i < toRemove.length; i++) {
					toRemove[i].remove();
				}
				const content = body.innerText || '';

				return {
					elements: result,
					content: content.trim()
				};
			})()
		`);

		// 清空并重建元素映射
		this.elementMap.clear();
		const elements: string[] = [];

		// 添加类型断言
		const pageDataTyped = pageData as { elements: any[]; content: string };
		let displayIndex = 0;
		pageDataTyped.elements.forEach((el: any) => {
			const displayName = el.name || '(无名称)';

			// 跳过"无名称"的元素
			if (displayName === '(无名称)') {
				return;
			}

			const elementType = el.elementType as ElementType;
			const priority = el.priority as number;
			const description = el.description as string | undefined;

			this.elementMap.set(displayIndex, {
				index: displayIndex,
				role: el.role,
				name: displayName,
				selector: `[data-nutbot-index="${displayIndex}"]`,
				url: el.url,
				elementType,
				priority,
				description
			});

			// 构建简化的元素显示字符串: [index] [类别] role: name
			const elementStr = `[${displayIndex}] [${elementType.toUpperCase()}] ${el.role || el.tag}: ${displayName.slice(0, 40)}`;

			elements.push(elementStr);
			displayIndex++;
		});

		this.logger.info(`页面状态: ${elements.length} 个可交互元素`);

		return {
			success: true,
			url: page.url(),
			title: await page.title(),
			elements,
			content: pageDataTyped.content
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
			const availableCount = this.elementMap.size;
			throw new Error(
				`找不到索引为 ${index} 的元素。当前页面只有 ${availableCount} 个可交互元素（索引 0-${availableCount - 1}）。\n` +
				`可能原因：页面已变化或使用了过期的索引。请先执行 state() 获取最新元素列表。`
			);
		}

		// 记录点击前的标签页数量
		const pagesBefore = this.context ? this.context.pages().length : 1;

		// 使用 locator 点击
		try {
			await page.locator(element.selector).first().click({ timeout: 5000 });
		} catch {
			// 如果失败，尝试 JavaScript 点击
			await page.evaluate(function jsClick(sel) {
				const el = document.querySelector(sel);
				if (el) (el as HTMLElement).click();
				return true;
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
			const availableCount = this.elementMap.size;
			throw new Error(
				`找不到索引为 ${index} 的元素。当前页面只有 ${availableCount} 个可交互元素（索引 0-${availableCount - 1}）。\n` +
				`可能原因：页面已变化或使用了过期的索引。请先执行 state() 获取最新元素列表。`
			);
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
		await page.evaluate(function scrollPage(d) {
			window.scrollBy(0, d);
			return true;
		}, delta);

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
	 * 前进到下一页
	 */
	private async goForward(): Promise<PageState & { success: boolean; action: string }> {
		const page = await this.ensureBrowser();

		await page.goForward({ waitUntil: 'domcontentloaded' });
		this.logger.info('已前进到下一页');

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'forward' };
	}

	/**
	 * 刷新当前页面
	 */
	private async refresh(): Promise<PageState & { success: boolean; action: string }> {
		const page = await this.ensureBrowser();

		await page.reload({ waitUntil: 'domcontentloaded' });
		this.logger.info('已刷新页面');

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'refresh' };
	}

	/**
	 * 打开新标签页
	 */
	private async newTab(url: string): Promise<PageState & { success: boolean; action: string; newTab: boolean }> {
		if (!this.context) {
			throw new Error('浏览器上下文未初始化');
		}

		// 确保 URL 有协议
		const fullUrl = url.startsWith('http') ? url : `https://${url}`;

		// 创建新页面
		const newPage = await this.context.newPage();
		await newPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await newPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

		// 切换到新页面
		this.page = newPage;
		await newPage.bringToFront();
		this.logger.info(`已在新标签页打开: ${fullUrl}`);

		// 返回新状态
		const state = await this.getState();
		return { ...state, action: 'new_tab', newTab: true };
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

	/**
	 * 截图功能
	 * @param fullPage 是否截取整个页面（默认 false，只截取可视区域）
	 * @param selector 可选，截取特定元素的选择器
	 */
	private async screenshot(
		fullPage?: boolean,
		selector?: string
	): Promise<{ success: boolean; action: string; imagePath: string; imageUrl: string; format: string; message: string }> {
		const page = await this.ensureBrowser();

		let screenshotBuffer: Buffer;

		if (selector) {
			// 截取特定元素
			const element = page.locator(selector).first();
			await element.waitFor({ state: 'visible', timeout: 5000 });
			screenshotBuffer = await element.screenshot();
			this.logger.info(`已截取元素截图: ${selector}`);
		} else {
			// 截取页面
			screenshotBuffer = await page.screenshot({
				fullPage: fullPage || false,
			});
			this.logger.info(`已截取页面截图 (fullPage: ${fullPage || false})`);
		}

		// 保存到文件
		const filename = `browser_screenshot_${Date.now()}.png`;
		const imagePath = join(BROWSER_SCREENSHOT_DIR, filename);
		await fs.writeFile(imagePath, screenshotBuffer);

		// 生成可访问的 URL（相对于用户主目录）
		const imageUrl = `/api/screenshots/browser/${filename}`;

		this.logger.info(`浏览器截图已保存: ${imagePath} (${screenshotBuffer.length} 字节)`);

		return {
			success: true,
			action: 'screenshot',
			imagePath,
			imageUrl,
			format: 'png',
			message: `浏览器截图已保存，文件路径: ${imagePath}`,
		};
	}

	async cleanup(): Promise<void> {
		await this.close();
	}

	isOpen(): boolean {
		return this.page !== null && !this.page.isClosed();
	}
}

export default BrowserTool;
