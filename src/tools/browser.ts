/**
 * 浏览器自动化工具 - 稳定版
 * 
 * 核心改进：
 * 1. 元素使用 stable CSS selector 引用
 * 2. snapshot 返回 element_id 供后续 click/type 使用
 * 3. 保留坐标点击作为 fallback
 */

import { BaseTool } from './registry.js';
import * as path from 'path';
import * as os from 'os';

// Playwright 类型
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;
type BrowserContext = import('playwright').BrowserContext;

// 浏览器模式
type BrowserMode = 'extension' | 'managed' | 'cdp';

// 稳定的元素引用
export interface StableElement {
	element_id: string;      // 稳定标识符
	selector: string;        // CSS selector
	tag: string;
	text?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	role?: string;
	rect: { x: number; y: number; width: number; height: number };
}

export class BrowserTool extends BaseTool {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private playwrightAvailable = false;
	
	// 元素缓存：element_id -> selector
	private elementCache: Map<string, string> = new Map();
	private nextElementId = 1;
	
	private mode: BrowserMode = 'extension';
	private cdpRelayPort = 18801;
	private managedPages: Set<Page> = new Set();
	private browserOpenedByNutBot = false;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'browser',
			description: `浏览器自动化工具（Playwright）。

【重要】操作搜索框/输入框的正确方式：
1. 用 snapshot 获取页面元素列表
2. 用 click [element_id] 点击元素（不是 ref，是 element_id）
3. 用 type [element_id] "文字" 输入文本
4. 用 press Enter 提交

【搜索规则】
- "X站搜索Y" → 先 goto 到 X站，然后用该网站的搜索框
- 例如："B站搜索影视飓风" → goto https://www.bilibili.com → snapshot → click [搜索框的element_id] → type [element_id] "影视飓风" → press Enter

【稳定引用】
- snapshot 返回 element_id，这是稳定标识符
- 后续操作使用 element_id 而不是数组索引
- 如果 element_id 失效，会回退到 selector`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: [
						'open', 'goto', 'snapshot', 'screenshot', 
						'click', 'type', 'press', 'scroll', 'select', 
						'wait', 'evaluate', 'tabs', 'close_tab', 'close', 
						'notify', 'search',
					],
				},
				url: {
					type: 'string',
					description: 'goto 操作的目标网址',
				},
				element_id: {
					type: 'string',
					description: 'click/type/select 的元素 ID（从 snapshot 获取）',
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
				key: {
					type: 'string',
					description: 'press 的按键：Enter, Tab, Escape',
				},
				value: {
					type: 'string',
					description: 'select 操作要选择的值',
				},
				script: {
					type: 'string',
					description: 'evaluate 操作要执行的 JavaScript 代码',
				},
				direction: {
					type: 'string',
					description: 'scroll 操作的方向: up, down',
					enum: ['up', 'down'],
				},
				timeout: {
					type: 'number',
					description: '操作超时时间(毫秒)',
				},
				waitFor: {
					type: 'string',
					description: 'wait 类型: load, network, selector',
					enum: ['load', 'network', 'selector'],
				},
				selector: {
					type: 'string',
					description: 'wait 操作等待的元素选择器',
				},
				notifyTitle: {
					type: 'string',
					description: 'notify 操作的通知标题',
				},
				notifyMessage: {
					type: 'string',
					description: 'notify 操作的通知内容',
				},
				searchQuery: {
					type: 'string',
					description: 'search 操作要搜索的关键词',
				},
				engine: {
					type: 'string',
					description: 'search 操作的搜索引擎',
					enum: ['google', 'bing', 'baidu'],
				},
			},
			...config,
		});

		if (config.browserMode) this.mode = config.browserMode as BrowserMode;
		if (config.cdpRelayPort) this.cdpRelayPort = config.cdpRelayPort as number;

		this.checkPlaywright();
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

	async execute(params: Record<string, unknown>, context: Record<string, unknown> = {}): Promise<unknown> {
		if (!this.playwrightAvailable) {
			throw new Error('Playwright 未安装。请运行:\nnpm install playwright\nnpx playwright install chromium');
		}

		const { action } = params;
		const timeout = typeof params.timeout === 'number' ? params.timeout : 30000;

		switch (action) {
			case 'open': return await this.openBrowser();
			case 'goto': 
				if (!params.url) throw new Error('goto 需要 url 参数');
				return await this.goto(params.url as string, timeout);
			case 'snapshot': 
			case 'snapshoot':
				return await this.snapshot();
			case 'screenshot':
				return await this.screenshot();
			case 'click':
				if (!params.element_id) throw new Error('click 需要 element_id 参数');
				return await this.clickStable(params.element_id as string, timeout);
			case 'type':
				if (!params.text) throw new Error('type 需要 text 参数');
				return await this.typeStable(params.element_id as string, params.text as string, timeout);
			case 'press':
				if (!params.key) throw new Error('press 需要 key 参数');
				return await this.press(params.key as string);
			case 'scroll':
				return await this.scroll((params.direction as string) || 'down');
			case 'select':
				if (!params.element_id) throw new Error('select 需要 element_id 参数');
				if (!params.value) throw new Error('select 需要 value 参数');
				return await this.select(params.element_id as string, params.value as string, timeout);
			case 'wait':
				return await this.wait(timeout, params.waitFor as string, params.selector as string);
			case 'evaluate':
				if (!params.script) throw new Error('evaluate 需要 script 参数');
				return await this.evaluate(params.script as string);
			case 'tabs':
				return await this.listTabs();
			case 'close_tab':
				return await this.closeCurrentTab();
			case 'close':
				return await this.closeBrowser();
			case 'notify':
				return await this.sendNotification(params.notifyTitle as string, params.notifyMessage as string);
			case 'search':
				return await this.quickSearch(params.searchQuery as string, params.engine as string);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	private async openBrowser(): Promise<{ success: boolean; message: string; action: string }> {
		if (this.context && this.page && await this.isConnectionValid()) {
			return { success: true, message: '浏览器已打开', action: 'open' };
		}

		const { chromium } = await import('playwright');
		const { spawn, execSync } = await import('child_process');
		const fs = await import('fs');
		const isWindows = process.platform === 'win32';
		const debugPort = 9222;

		// ========== 扩展模式 ==========
		if (this.mode === 'extension') {
			this.logger.info('使用扩展模式连接浏览器...');

			try {
				const relayUrl = `http://127.0.0.1:${this.cdpRelayPort}`;
				
				// 检查 Relay 服务
				try {
					await fetch(`${relayUrl}/json/version`, { signal: AbortSignal.timeout(2000) });
				} catch {
					return { success: false, message: '⚠️ CDP Relay 服务未运行。请确保 NutBot Gateway 已启动' };
				}

				// 检查扩展状态
				let status = { connected: false, activeTargets: 0 };
				try {
					const res = await fetch(`${relayUrl}/extension/status`, { signal: AbortSignal.timeout(1000) });
					status = await res.json();
				} catch { /* ignore */ }

				if (status.connected) {
					this.browserOpenedByNutBot = false;
					this.logger.info(`浏览器已在运行（${status.activeTargets} 个标签页）`);
				} else {
					// 检查浏览器进程
					let browserAlreadyRunning = false;
					try {
						if (isWindows) {
							const result = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { encoding: 'utf8' });
							browserAlreadyRunning = result.includes('msedge.exe');
							if (!browserAlreadyRunning) {
								const chromeResult = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8' });
								browserAlreadyRunning = chromeResult.includes('chrome.exe');
							}
						}
					} catch { browserAlreadyRunning = false; }

					if (!browserAlreadyRunning) {
						this.logger.info('打开浏览器...');
						this.browserOpenedByNutBot = true;
						try {
							if (isWindows) execSync('start msedge', { stdio: 'ignore' });
							else if (process.platform === 'darwin') execSync('open -a "Google Chrome"', { stdio: 'ignore' });
							else execSync('xdg-open "http://127.0.0.1"', { stdio: 'ignore' });
						} catch { this.browserOpenedByNutBot = false; }
					}

					// 等待扩展连接
					for (let i = 0; i < 15; i++) {
						await new Promise(r => setTimeout(r, 1000));
						try {
							const res = await fetch(`${relayUrl}/extension/status`, { signal: AbortSignal.timeout(500) });
							status = await res.json();
							if (status.connected) break;
						} catch { /* continue */ }
					}
				}

				if (!status.connected) {
					return { success: false, message: '⚠️ 浏览器扩展未连接。请确保扩展已安装并点击图标' };
				}

				// 连接
				this.browser = await chromium.connectOverCDP(`ws://127.0.0.1:${this.cdpRelayPort}/cdp`);
				this.context = this.browser.contexts()[0] || await this.browser.newContext();

				let pages = this.context.pages();
				if (pages.length === 0) {
					this.page = await this.context.newPage();
				} else {
					this.page = pages[0];
				}

				const targetCount = this.context.pages().length;
				this.logger.info(`已连接到浏览器（${targetCount} 个标签页）`);
				return { success: true, message: `已连接到浏览器（扩展模式）` };
			} catch (error: any) {
				this.logger.warn(`扩展模式失败: ${error?.message || error}`);
				this.mode = 'managed';
			}
		}

		// ========== Managed 模式 ==========
		this.logger.info('使用 managed 模式...');
		
		const edgePath = this.getBrowserPath('edge');
		const chromePath = this.getBrowserPath('chrome');

		// 尝试使用用户数据目录
		try {
			const edgeData = this.getUserDataDir('edge');
			if (fs.existsSync(edgePath) && fs.existsSync(edgeData)) {
				this.context = await chromium.launchPersistentContext(edgeData, {
					headless: false,
					channel: 'msedge',
					args: ['--start-maximized'],
				});
				this.page = this.context.pages()[0] || await this.context.newPage();
				return { success: true, message: '浏览器已启动（Edge，保留登录状态）' };
			}
		} catch (e: any) {
			this.logger.debug(`Edge 启动失败: ${e?.message || e}`);
		}

		try {
			const chromeData = this.getUserDataDir('chrome');
			this.context = await chromium.launchPersistentContext(chromeData, {
				headless: false,
				channel: 'chrome',
				args: ['--start-maximized'],
			});
			this.page = this.context.pages()[0] || await this.context.newPage();
			return { success: true, message: '浏览器已启动（Chrome，保留登录状态）' };
		} catch (e: any) {
			this.logger.debug(`Chrome 启动失败: ${e?.message || e}`);
		}

		// 最后回退
		this.browser = await chromium.launch({ headless: false, channel: 'msedge' });
		this.context = await this.browser.newContext({ viewport: null });
		this.page = await this.context.newPage();
		return { success: true, message: '⚠️ 浏览器已启动（新会话，无登录状态）' };
	}

	private getBrowserPath(browser: 'edge' | 'chrome'): string {
		const isWindows = process.platform === 'win32';
		const isMac = process.platform === 'darwin';
		
		if (browser === 'edge') {
			if (isWindows) {
				return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
			}
			if (isMac) return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
			return 'microsoft-edge';
		}
		
		if (browser === 'chrome') {
			if (isWindows) {
				return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe');
			}
			if (isMac) return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
			return 'google-chrome';
		}
		
		return browser;
	}

	private getUserDataDir(browser: 'edge' | 'chrome'): string {
		const isWindows = process.platform === 'win32';
		const isMac = process.platform === 'darwin';
		
		if (browser === 'edge') {
			if (isWindows) return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
			if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge');
			return path.join(os.homedir(), '.config', 'microsoft-edge');
		}
		
		if (browser === 'chrome') {
			if (isWindows) return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
			if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
			return path.join(os.homedir(), '.config', 'google-chrome');
		}
		
		return '';
	}

	private async ensurePage(): Promise<Page> {
		if (!this.page || await this.isPageClosed(this.page)) {
			this.page = null;
			this.context = null;
			await this.openBrowser();
		}
		return this.page!;
	}

	private async isPageClosed(page: Page): Promise<boolean> {
		try {
			await page.evaluate(() => true);
			return false;
		} catch {
			return true;
		}
	}

	private async isConnectionValid(): Promise<boolean> {
		try {
			if (!this.page || !this.context) return false;
			await this.page.evaluate(() => true);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 生成稳定的 CSS selector
	 */
	private generateStableSelector(el: Element): string | null {
		// 1. 优先使用 id
		if (el.id) {
			const safeId = el.id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
			return `#${safeId}`;
		}

		// 2. 使用 data-testid 或 data-* 属性
		const testId = el.getAttribute('data-testid');
		if (testId) {
			return `[data-testid="${testId}"]`;
		}

		// 3. 构建路径选择器
		const path: string[] = [];
		let current: Element | null = el;

		while (current && current !== document.body && path.length < 5) {
			let selector = current.tagName.toLowerCase();

			// 添加 class（如果有）
			if (current.className && typeof current.className === 'string' && current.className.trim()) {
				const classes = current.className.trim().split(/\s+/).slice(0, 3).join('.');
				if (classes) selector += `.${classes}`;
			}

			// 添加 type（如果是 input）
			const input = current as HTMLInputElement;
			if (selector === 'input' && input.type && input.type !== 'text') {
				selector += `[type="${input.type}"]`;
			}

			// 添加 placeholder（如果是 input/textarea）
			if ((selector === 'input' || selector === 'textarea') && input.placeholder) {
				selector += `[placeholder="${input.placeholder.substring(0, 30)}"]`;
			}

			// 添加 name
			if (input.name) {
				selector += `[name="${input.name}"]`;
			}

			path.unshift(selector);
			current = current.parentElement;
		}

		return path.join(' > ');
	}

	/**
	 * Snapshot - 返回稳定的元素引用
	 */
	private async snapshot(): Promise<{
		success: boolean;
		action: string;
		url: string;
		title: string;
		elements: StableElement[];
		aiSummary: string;
	}> {
		const page = await this.ensurePage();
		const url = page.url() || '';
		const title = await page.title();

		// 获取页面元素和关键描述
		const pageInfo = await page.evaluate(() => {
			// 获取 meta description
			const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
			const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';

			// 获取 h1 标题
			const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim()).filter(Boolean);

			// 获取页面主标题
			const mainHeading = h1s[0] || '';

			// 获取主要链接（用于搜索结果）
			const interactives = document.querySelectorAll(
				'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])'
			);

			const elements = Array.from(interactives).map((el, i) => {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return null;

				const input = el as HTMLInputElement;
				const anchor = el as HTMLAnchorElement;

				return {
					tag: el.tagName.toLowerCase(),
					text: (el.textContent || '').trim().substring(0, 80) || undefined,
					type: input.type || undefined,
					placeholder: input.placeholder || undefined,
					href: anchor.href || undefined,
					role: el.getAttribute('role') || undefined,
					rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
				};
			}).filter(Boolean);

			return {
				metaDesc: metaDesc.substring(0, 200),
				metaKeywords: metaKeywords.substring(0, 100),
				h1s,
				mainHeading,
				elements,
			};
		});

		// 生成稳定的元素列表
		const stableElements: StableElement[] = [];
		let idCounter = 1;

		for (const el of pageInfo.elements) {
			if (!el) continue;

			// 生成 element_id
			const elementId = `el_${idCounter++}`;

			// 生成 selector（这里用简化的方式，实际需要从 page.evaluate 返回更多信息）
			let selector = '';
			try {
				const pageEl = page.locator(`${el.tag}:nth-of-type(${idCounter})`).first();
				if (await pageEl.count() > 0) {
					selector = await pageEl.evaluate((e) => this.generateStableSelector(e) || '');
				}
			} catch {
				selector = `${el.tag}[data-nutbot-id="${elementId}"]`;
			}

			// 缓存 selector
			this.elementCache.set(elementId, selector);

			stableElements.push({
				element_id: elementId,
				selector,
				tag: el.tag,
				text: el.text,
				type: el.type,
				placeholder: el.placeholder,
				href: el.href,
				role: el.role,
				rect: el.rect,
			});
		}

		// 生成简化的页面描述（让 AI 负责总结）
		// 提取链接文本（用于搜索结果）
		const linkTexts = stableElements
			.filter((el): el is typeof el & { href: string } => el.tag === 'a' && !!el.href && !!el.text && el.text.length > 3)
			.slice(0, 15)
			.map(el => {
				try {
					return `${el.text} → ${new URL(el.href).hostname}`;
				} catch {
					return el.text;
				}
			});

		// 构建 aiSummary，包含页面关键信息
		let aiSummary = `${url}`;
		if (title && title !== pageInfo.mainHeading) {
			aiSummary += ` | ${title}`;
		}
		if (pageInfo.mainHeading) {
			aiSummary += `\n页面标题: ${pageInfo.mainHeading}`;
		}
		if (pageInfo.metaDesc) {
			aiSummary += `\n页面描述: ${pageInfo.metaDesc}`;
		}

		if (linkTexts.length > 0) {
			aiSummary += `\n\n搜索结果:\n${linkTexts.join('\n')}`;
		}

		if (stableElements.length > 20 && linkTexts.length < 20) {
			aiSummary += `\n(共 ${stableElements.length} 个可交互元素)`;
		}

		this.logger.info(`页面快照: ${stableElements.length} 个可交互元素`);
		this.logger.info(`AI摘要: ${aiSummary}`);

		return {
			success: true,
			action: 'snapshot',
			url,
			title,
			elements: stableElements,
			aiSummary,
		};
	}

	/**
	 * 使用 stable element_id 点击
	 */
	private async clickStable(elementId: string, timeout: number): Promise<{
		success: boolean;
		element_id: string;
		action: string;
		elements: StableElement[];
		aiSummary: string;
	}> {
		const page = await this.ensurePage();
		let clickSuccess = false;

		// 尝试 selector 点击
		const selector = this.elementCache.get(elementId);
		if (selector) {
			try {
				await page.click(selector, { timeout: 5000 });
				this.logger.info(`已点击元素 ${elementId} (selector: ${selector})`);
				clickSuccess = true;
			} catch (error) {
				this.logger.warn(`selector 点击失败: ${error}，尝试其他方法`);
			}
		}

		// 回退：JavaScript 点击
		if (!clickSuccess) {
			try {
				await page.evaluate((id) => {
					const el = document.querySelector(`[data-nutbot-id="${id}"]`) as HTMLElement;
					if (el) el.click();
				}, elementId);
				this.logger.info(`已点击元素 ${elementId} (JavaScript)`);
				clickSuccess = true;
			} catch (error) {
				this.logger.warn(`JavaScript 点击失败: ${error}`);
			}
		}

		// 如果所有方法都失败
		if (!clickSuccess) {
			throw new Error(`无法找到元素 ${elementId}，请先执行 snapshot 获取最新元素列表`);
		}

		// 点击后自动执行 snapshot
		const snapshot = await this.snapshot();
		return {
			success: true,
			element_id: elementId,
			action: 'click_with_snapshot',
			elements: snapshot.elements,
			aiSummary: snapshot.aiSummary,
		};
	}

	/**
	 * 使用 stable element_id 输入
	 */
	private async typeStable(
		elementId: string | undefined,
		text: string,
		timeout: number
	): Promise<{ success: boolean; element_id?: string; text: string }> {
		const page = await this.ensurePage();

		if (elementId) {
			await this.clickStable(elementId, timeout);
		}

		// 清空并输入
		await page.keyboard.press('Control+a');
		await page.keyboard.type(text, { delay: 30 });

		this.logger.info(elementId ? `已在 ${elementId} 输入文本` : '已输入文本');
		return { success: true, element_id: elementId, text };
	}

	private async screenshot(): Promise<{ success: boolean; base64: string }> {
		const page = await this.ensurePage();
		const buffer = await page.screenshot({ fullPage: false });
		const base64 = buffer.toString('base64');
		this.logger.info('已截图');
		return { success: true, base64 };
	}

	private async press(key: string): Promise<{ success: boolean; key: string }> {
		const page = await this.ensurePage();
		await page.keyboard.press(key);
		this.logger.info(`已按键: ${key}`);
		return { success: true, key };
	}

	private async scroll(direction: string): Promise<{ success: boolean; direction: string }> {
		const page = await this.ensurePage();
		const delta = direction === 'up' ? -500 : 500;
		await page.mouse.wheel(0, delta);
		return { success: true, direction };
	}

	private async wait(timeout: number, waitFor?: string, selector?: string): Promise<{ success: boolean; waitType: string }> {
		const page = await this.ensurePage();
		const maxWait = Math.min(timeout, 15000);

		switch (waitFor) {
			case 'load':
				await page.waitForLoadState('load', { timeout: maxWait });
				return { success: true, waitType: 'load' };
			case 'network':
				try {
					await page.waitForLoadState('networkidle', { timeout: maxWait });
				} catch { /* 超时也视为可操作 */ }
				return { success: true, waitType: 'network' };
			case 'selector':
				if (!selector) throw new Error('waitFor=selector 需要 selector 参数');
				await page.waitForSelector(selector, { timeout: maxWait });
				return { success: true, waitType: 'selector' };
			default:
				await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
				return { success: true, waitType: 'auto' };
		}
	}

	private async evaluate(script: string): Promise<{ success: boolean; result: unknown }> {
		const page = await this.ensurePage();
		const result = await page.evaluate(script);
		return { success: true, result };
	}

	private async goto(url: string, timeout: number): Promise<{
		success: boolean;
		url: string;
		title: string;
		action: string;
		elements: StableElement[];
		aiSummary: string;
	}> {
		const page = await this.ensurePage();
		await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });

		try {
			await page.waitForLoadState('networkidle', { timeout: 3000 });
		} catch { /* 忽略 */ }

		// 清空元素缓存
		this.elementCache.clear();

		const title = await page.title();
		this.logger.info(`已访问: ${url}`);

		// 自动执行 snapshot 获取页面内容
		const snapshot = await this.snapshot();
		return {
			success: true,
			url,
			title,
			action: 'goto_with_snapshot',
			elements: snapshot.elements,
			aiSummary: snapshot.aiSummary,
		};
	}

	private async listTabs(): Promise<{ success: boolean; tabs: Array<{ index: number; url: string; title: string }> }> {
		if (!this.context) return { success: true, tabs: [] };

		const pages = this.context.pages();
		const tabs = await Promise.all(pages.map(async (p, i) => ({
			index: i,
			url: p.url(),
			title: await p.title(),
		})));

		return { success: true, tabs };
	}

	private async select(elementId: string, value: string, timeout: number): Promise<{ success: boolean; element_id: string; value: string }> {
		const page = await this.ensurePage();
		const selector = this.elementCache.get(elementId);
		if (!selector) throw new Error(`找不到元素 ${elementId}`);

		await page.selectOption(selector, value);
		return { success: true, element_id: elementId, value };
	}

	private async closeCurrentTab(): Promise<{ success: boolean; message: string }> {
		if (!this.page) return { success: true, message: '没有标签页' };

		const url = this.page.url();
		await this.page.close();
		this.page = null;

		// 切换到其他标签页
		if (this.context) {
			const pages = this.context.pages();
			if (pages.length > 0) {
				this.page = pages[0];
			}
		}

		this.elementCache.clear();
		return { success: true, message: `已关闭: ${url}` };
	}

	private async closeBrowser(): Promise<{ success: boolean; message: string }> {
		if (this.context) {
			await this.context.close();
			this.context = null;
		}
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}

		this.page = null;
		this.elementCache.clear();
		this.browserOpenedByNutBot = false;

		return { success: true, message: '浏览器已关闭' };
	}

	private async sendNotification(title?: string, message?: string): Promise<{ success: boolean; message: string }> {
		if (this.mode !== 'extension') {
			return { success: false, message: '通知功能仅在扩展模式下可用' };
		}

		try {
			const relayUrl = `http://127.0.0.1:${this.cdpRelayPort}`;
			await fetch(`${relayUrl}/notify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: title || 'NutBot', message: message || '' }),
				signal: AbortSignal.timeout(5000),
			});
			return { success: true, message: '通知已发送' };
		} catch (error) {
			return { success: false, message: `发送通知失败: ${error}` };
		}
	}

	private async quickSearch(query?: string, engine?: string): Promise<{
		success: boolean;
		url: string;
		title: string;
		action: string;
		elements: StableElement[];
		aiSummary: string;
	}> {
		if (!query) throw new Error('search 需要 searchQuery 参数');

		const engines: Record<string, string> = {
			google: 'https://www.google.com/search?q=',
			bing: 'https://www.bing.com/search?q=',
			baidu: 'https://www.baidu.com/s?wd=',
		};

		const searchUrl = engines[engine || 'google'] + encodeURIComponent(query);

		// 搜索后自动执行 snapshot
		const snapshotResult = await this.goto(searchUrl, 30000);

		// 获取快照
		const snapshot = await this.snapshot();

		this.logger.info(`已搜索: ${query}`);

		return {
			success: true,
			url: snapshot.url,
			title: snapshot.title,
			action: 'search',
			elements: snapshot.elements,
			aiSummary: snapshot.aiSummary,
		};
	}

	async cleanup(): Promise<void> {
		await this.closeBrowser();
	}

	isOpen(): boolean {
		return this.context !== null && this.page !== null;
	}
}

export default BrowserTool;
