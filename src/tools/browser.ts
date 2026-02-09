/**
 * 浏览器自动化工具
 * 使用 Playwright 进行网页操作
 * 参考 Moltbot 设计：snapshot + ref 方式操作
 *
 * 支持三种模式：
 * 1. extension - 通过浏览器扩展连接用户的浏览器（保留登录状态）
 * 2. managed - 启动独立的浏览器实例
 * 3. cdp - 连接到已运行的调试端口
 */

import { BaseTool } from './registry.js';
import { systemInfo } from './exec.js';
import * as path from 'path';
import * as os from 'os';

// Playwright 类型（动态导入）
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;
type BrowserContext = import('playwright').BrowserContext;

// 浏览器模式
type BrowserMode = 'extension' | 'managed' | 'cdp';

interface ElementRef {
	ref: number;
	tag: string;
	role?: string;
	name?: string;
	text?: string;
	href?: string;
	type?: string;
	placeholder?: string;
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	rect: { x: number; y: number; width: number; height: number };
}

export class BrowserTool extends BaseTool {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private playwrightAvailable = false;
	private elementRefs: Map<number, string> = new Map(); // ref -> selector
	private nextRef = 1;
	private mode: BrowserMode = 'extension'; // 默认使用扩展模式
	private cdpRelayPort = 18801; // CDP Relay 服务端口
	private managedPages: Set<Page> = new Set(); // NutBot 管理的页面，close 时需要关闭
	private initialPageUrl: string | null = null; // 记录打开时的初始页面 URL
	private browserOpenedByNutBot = false; // 浏览器是否由 NutBot 启动的
	private initialTabCount = 0; // 连接时浏览器已有的标签页数量

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'browser',
			description: `浏览器自动化工具（Playwright）。

【重要】操作搜索框/输入框的正确方式：
1. 用 snapshot 找到输入框元素的 ref
2. 用 click 点击该 ref 聚焦输入框
3. 用 type（带 ref）在该输入框输入文本
4. 用 press Enter 提交
❌ 不要用 press "/" 等快捷键，很多网站不支持

【智能操作】根据任务需求灵活选择操作，不要写死流程！
- 需要访问网页：goto（会自动连接浏览器）
- 需要看当前页面：snapshot
- 需要关闭浏览器：close
- 只有在其他操作失败提示"未连接"时才需要显式 open`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: [
						'open', // 打开浏览器
						'goto', // 访问网址（页面加载完成后返回）
						'snapshot', // 获取页面结构（返回可交互元素列表和 ref）
						'screenshot', // 截图
						'click', // 点击元素（需要 ref）
						'type', // 输入文本（需要 ref 指定输入框，或不传 ref 在当前焦点输入）
						'press', // 按键（用于 Enter/Tab/Escape 等，不要用快捷键聚焦输入框）
						'scroll', // 滚动
						'select', // 下拉选择
						'wait', // 等待（页面加载/网络空闲/元素出现）
						'evaluate', // 执行 JavaScript
						'tabs', // 列出标签页
						'close_tab', // 关闭当前标签页（任务完成后使用）
						'close', // 关闭浏览器连接
						'notify', // 发送浏览器通知（任务完成后通知用户）
						'search', // 快速搜索（支持常用搜索引擎）
					],
				},
				url: {
					type: 'string',
					description: 'goto 操作的目标网址（必须是完整 URL）',
				},
				ref: {
					type: 'number',
					description: 'click/type/select 的元素引用号（从 snapshot 获取）。type 必须传 ref 以指定输入框',
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
				key: {
					type: 'string',
					description: 'press 的按键：Enter(提交), Tab(切换焦点), Escape(取消)。不要用快捷键聚焦输入框',
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
					description: '操作超时时间(毫秒)。wait 默认 10000，条件满足即返回',
				},
				waitFor: {
					type: 'string',
					description:
						'wait 类型: load(页面 load 即返回), network(先 load 再等网络空闲，超时也视为可操作), selector(等元素)',
					enum: ['load', 'network', 'selector'],
				},
				selector: {
					type: 'string',
					description: 'wait 操作等待的元素选择器（waitFor=selector 时使用）',
				},
				notifyTitle: {
					type: 'string',
					description: 'notify 操作的通知标题',
				},
				notifyMessage: {
					type: 'string',
					description: 'notify 操作的通知内容（任务完成的总结）',
				},
				searchQuery: {
					type: 'string',
					description: 'search 操作要搜索的关键词',
				},
				engine: {
					type: 'string',
					description: 'search 操作的搜索引擎 (google/bing/baidu，默认 google)',
					enum: ['google', 'bing', 'baidu'],
				},
			},
			...config,
		});

		// 从配置中读取默认模式
		if (config.browserMode) {
			this.mode = config.browserMode as BrowserMode;
		}
		if (config.cdpRelayPort) {
			this.cdpRelayPort = config.cdpRelayPort as number;
		}

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

		async execute(
		params: {
			action: string;
			url?: string;
			ref?: number;
			text?: string;
			key?: string;
			value?: string;
			script?: string;
			direction?: string;
			timeout?: number;
			waitFor?: string;
			selector?: string;
			notifyTitle?: string;
			notifyMessage?: string;
			searchQuery?: string;
			engine?: string;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		if (!this.playwrightAvailable) {
			throw new Error('Playwright 未安装。请运行:\nnpm install playwright\nnpx playwright install chromium');
		}

		const {
			action,
			url,
			ref,
			text,
			key,
			value,
			script,
			direction,
			timeout: rawTimeout,
			waitFor,
			selector,
		} = params;
		const timeout = typeof rawTimeout === 'number' ? rawTimeout : action === 'wait' ? 10000 : 30000;

		// 不暴露 mode 给 AI，始终优先用 extension（用户浏览器+登录状态），失败再回退
		switch (action) {
			case 'open':
				return await this.openBrowser();
			case 'goto':
				if (!url) throw new Error('goto 操作需要 url 参数');
				return await this.goto(url, timeout);
			case 'snapshot':
			case 'snapshoot': // AI 常见拼写
				return await this.snapshot();
			case 'screenshot':
				return await this.screenshot();
			case 'click':
				if (ref === undefined) throw new Error('click 操作需要 ref 参数（从 snapshot 获取）');
				return await this.click(ref, timeout);
			case 'type':
				if (!text) throw new Error('type 操作需要 text 参数');
				return await this.type(ref, text, timeout); // ref 可选，不传则在当前焦点输入
			case 'press':
				if (!key) throw new Error('press 操作需要 key 参数');
				return await this.press(key);
			case 'scroll':
				return await this.scroll(direction || 'down');
			case 'select':
				if (ref === undefined) throw new Error('select 操作需要 ref 参数');
				if (!value) throw new Error('select 操作需要 value 参数');
				return await this.select(ref, value, timeout);
			case 'wait':
				return await this.wait(timeout, waitFor, selector);
			case 'evaluate':
				if (!script) throw new Error('evaluate 操作需要 script 参数');
				return await this.evaluate(script);
			case 'tabs':
				return await this.listTabs();
			case 'close_tab':
				return await this.closeCurrentTab();
			case 'close':
				return await this.closeBrowser();
			case 'notify':
				return await this.sendNotification(params.notifyTitle, params.notifyMessage);
			case 'search':
				return await this.quickSearch(params.searchQuery, params.engine);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	private async openBrowser(): Promise<{ success: boolean; message: string }> {
		// 验证现有连接是否仍然有效
		if (this.context && this.page && !(await this.isConnectionValid())) {
			this.logger.info('现有连接已失效，重新建立连接');
			this.context = null;
			this.page = null;
		}

		if (this.context && this.page) {
			return { success: true, message: '浏览器已打开' };
		}

		const { chromium } = await import('playwright');
		const { spawn, execSync } = await import('child_process');
		const fs = await import('fs');

		const isWindows = process.platform === 'win32';
		const isMac = process.platform === 'darwin';
		const debugPort = 9222;

		// ========== 扩展模式：通过 CDP Relay 连接用户的浏览器 ==========
		if (this.mode === 'extension') {
			this.logger.info('使用扩展模式连接浏览器...');

			try {
				// 检查 CDP Relay 是否可用
				const relayUrl = `http://127.0.0.1:${this.cdpRelayPort}`;
				const response = await fetch(`${relayUrl}/json/version`, {
					signal: AbortSignal.timeout(2000),
				});

				if (!response.ok) {
					throw new Error('CDP Relay 服务未响应');
				}

				// 快速检查一次扩展状态
				let status = { connected: false, activeTargets: 0 };
				try {
					const statusResponse = await fetch(`${relayUrl}/extension/status`, {
						signal: AbortSignal.timeout(1000),
					});
					status = (await statusResponse.json()) as { connected: boolean; activeTargets: number };
				} catch {
					// 忽略
				}

				// 如果扩展已连接，说明浏览器已经打开（用户手动打开的）
				if (status.connected) {
					this.browserOpenedByNutBot = false;
					this.initialTabCount = status.activeTargets;
					this.logger.info(`浏览器已在运行（${status.activeTargets} 个标签页）`);
				} else {
					// 扩展未连接，先检查浏览器进程是否已经在运行
					const { execSync } = await import('child_process');
					const isWindows = process.platform === 'win32';
					
					let browserAlreadyRunning = false;
					try {
						if (isWindows) {
							// Windows: 检查 Edge 或 Chrome 进程
							const result = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { encoding: 'utf8' });
							browserAlreadyRunning = result.includes('msedge.exe');
							if (!browserAlreadyRunning) {
								const chromeResult = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf8' });
								browserAlreadyRunning = chromeResult.includes('chrome.exe');
							}
						} else if (process.platform === 'darwin') {
							// macOS: 检查浏览器进程
							const result = execSync('pgrep -x "Google Chrome" || pgrep -x "Microsoft Edge" || true', { encoding: 'utf8' });
							browserAlreadyRunning = result.trim().length > 0;
						} else {
							// Linux: 检查浏览器进程
							const result = execSync('pgrep -x chrome || pgrep -x chromium || pgrep -x microsoft-edge || true', { encoding: 'utf8' });
							browserAlreadyRunning = result.trim().length > 0;
						}
					} catch {
						// 检查失败，假设浏览器未运行
					}

					if (browserAlreadyRunning) {
						// 浏览器已在运行，但扩展未连接
						this.browserOpenedByNutBot = false;
						this.logger.info('浏览器已在运行但扩展未连接，等待用户点击扩展图标...');
					} else {
						// 浏览器未运行，需要打开
						this.logger.info('扩展未连接，正在打开浏览器...');
						this.browserOpenedByNutBot = true; // 标记浏览器是由 NutBot 打开的
						
						try {
							// 只打开浏览器，不指定 URL，扩展会自动创建标签页
							if (isWindows) {
								// Windows: 打开 Edge
								execSync(`start msedge`, { stdio: 'ignore' });
							} else if (process.platform === 'darwin') {
								execSync(`open -a "Google Chrome" || open -a "Microsoft Edge"`, { stdio: 'ignore' });
							} else {
								// Linux: 打开默认浏览器
								execSync(`xdg-open "http://127.0.0.1:${this.cdpRelayPort}"`, { stdio: 'ignore' });
							}
						} catch {
							// 打开失败
							this.browserOpenedByNutBot = false;
							this.logger.info('打开浏览器失败');
						}
					}

					// 轮询等待扩展连接（每 1 秒检查，最多 15 秒）
					const pollInterval = 1000;
					const pollUntil = Date.now() + 15000;
					while (Date.now() < pollUntil && !status.connected) {
						await new Promise((r) => setTimeout(r, pollInterval));
						try {
							const retryRes = await fetch(`${relayUrl}/extension/status`, {
								signal: AbortSignal.timeout(1000),
							});
							status = (await retryRes.json()) as { connected: boolean; activeTargets: number };
						} catch {
							// 忽略
						}
					}
					
					// 记录连接时的初始标签页数量
					this.initialTabCount = status.activeTargets;
				}

				if (!status.connected) {
					return {
						success: false,
						message: `⚠️ 浏览器扩展未连接。请确保：\n1. Edge/Chrome 浏览器已打开\n2. NutBot 扩展已安装并启用\n3. 若扩展刚安装，请刷新任意页面或点击扩展图标`,
					};
				}

				// 通过 CDP Relay 连接（无标签页时 Relay 会在收到 Target.setAutoAttach 后自动创建初始标签页）
				this.browser = await chromium.connectOverCDP(`ws://127.0.0.1:${this.cdpRelayPort}/cdp`);
				const contexts = this.browser.contexts();
				this.context = contexts[0] || (await this.browser.newContext());

				// 等待 Relay 自动创建的标签页出现（最多 5 秒），否则再 newPage() 让扩展创建
				let pages = this.context.pages();
				const deadline = Date.now() + 5000;
				while (pages.length === 0 && Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 200));
					pages = this.context.pages();
				}

				let isNewPage = false;
				if (pages.length === 0) {
					this.page = await this.context.newPage();
					isNewPage = true;
				} else {
					this.page = pages[0];
					// 检查是否是扩展创建的初始标签页（about:blank）
					const url = this.page.url();
					isNewPage = url === 'about:blank' || url === '';
				}

				// 如果是 NutBot 通过扩展创建的页面，记录下来，close 时需要关闭
				if (isNewPage) {
					this.managedPages.add(this.page);
					this.initialPageUrl = this.page.url();
				}

				// 聚焦到当前页面
				try {
					await this.page.bringToFront();
				} catch {
					// 忽略聚焦失败
				}

				const targetCount = this.context.pages().length;
				this.logger.info(`已通过扩展连接到浏览器（${targetCount} 个标签页）`);
				return {
					success: true,
					message: `已连接到用户浏览器（扩展模式，${targetCount} 个标签页，可完全自动化）`,
				};
			} catch (error: any) {
				const errMsg = error?.message || String(error);
				this.logger.warn(`扩展模式连接失败: ${errMsg}`);

				// 如果是 Relay 未运行，给出提示
				if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('未响应')) {
					return {
						success: false,
						message: '⚠️ CDP Relay 服务未运行。请确保 NutBot Gateway 已启动',
					};
				}

				// 其他错误，回退到 managed 模式
				this.logger.info('回退到 managed 模式...');
				this.mode = 'managed';
			}
		}

		// ========== 辅助函数：获取浏览器路径和数据目录 ==========
		const getEdgePath = () => {
			if (isWindows) {
				const paths = [
					'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
					'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
					path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
				];
				for (const p of paths) {
					if (fs.existsSync(p)) return p;
				}
			}
			if (isMac) return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
			return 'microsoft-edge';
		};

		const getChromePath = () => {
			if (isWindows) {
				const paths = [
					'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
					'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
					path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
				];
				for (const p of paths) {
					if (fs.existsSync(p)) return p;
				}
			}
			if (isMac) return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
			return 'google-chrome';
		};

		const getEdgeUserDataDir = () => {
			if (isWindows) return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
			if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge');
			return path.join(os.homedir(), '.config', 'microsoft-edge');
		};

		const getChromeUserDataDir = () => {
			if (isWindows) return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
			if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
			return path.join(os.homedir(), '.config', 'google-chrome');
		};

		// ========== 辅助函数：等待 CDP 端口可用 ==========
		const waitForCDP = async (port: number, maxWaitMs: number = 15000): Promise<boolean> => {
			const startTime = Date.now();
			while (Date.now() - startTime < maxWaitMs) {
				try {
					const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
						signal: AbortSignal.timeout(500),
					});
					if (response.ok) return true;
				} catch {
					// 继续等待
				}
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
			return false;
		};

		// ========== 辅助函数：通过 CDP 连接浏览器 ==========
		const connectViaCDP = async (port: number): Promise<{ success: boolean; message: string } | null> => {
			try {
				const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
					signal: AbortSignal.timeout(1000),
				});
				if (response.ok) {
					this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
					const contexts = this.browser.contexts();
					this.context = contexts[0] || (await this.browser.newContext());
					// 在已有浏览器中新建标签页
					this.page = await this.context.newPage();
					this.logger.info('已通过 CDP 连接到浏览器');
					return { success: true, message: '已连接到浏览器（保留登录状态）' };
				}
			} catch {
				// 连接失败
			}
			return null;
		};

		// ========== 步骤1：尝试连接到已运行的调试模式浏览器 ==========
		this.logger.info('尝试连接到已运行的调试模式浏览器...');
		const existingConnection = await connectViaCDP(debugPort);
		if (existingConnection) {
			return existingConnection;
		}

		// ========== 步骤2：启动用户的默认浏览器（带调试端口）==========
		// 这种方式可以保留用户的登录状态，因为使用用户的原生浏览器和数据目录
		this.logger.info('启动用户浏览器（带调试端口）...');

		// 尝试 Edge
		const edgePath = getEdgePath();
		const edgeDataDir = getEdgeUserDataDir();

		if (fs.existsSync(edgePath) && fs.existsSync(edgeDataDir)) {
			this.logger.info(`启动 Edge: ${edgePath}`);

			try {
				// 使用用户的浏览器和数据目录，添加调试端口
				const browserProcess = spawn(
					edgePath,
					[
						`--remote-debugging-port=${debugPort}`,
						'--restore-last-session', // 恢复上次会话
						'--no-first-run',
						'--disable-background-networking',
						'about:blank', // 打开空白页，不干扰用户
					],
					{
						detached: true,
						stdio: 'ignore',
						windowsHide: false,
					}
				);
				browserProcess.unref();

				// 等待 CDP 端口可用
				this.logger.info('等待浏览器启动...');
				const cdpReady = await waitForCDP(debugPort, 15000);

				if (cdpReady) {
					const connection = await connectViaCDP(debugPort);
					if (connection) {
						this.logger.info('Edge 浏览器已启动并连接（保留登录状态）');
						return { success: true, message: '浏览器已启动（Edge，保留登录状态）' };
					}
				} else {
					this.logger.warn('Edge CDP 端口未能在时限内就绪');
				}
			} catch (err: any) {
				this.logger.warn(`启动 Edge 失败: ${err?.message || err}`);
			}
		}

		// 尝试 Chrome
		const chromePath = getChromePath();
		const chromeDataDir = getChromeUserDataDir();

		if (fs.existsSync(chromePath) && fs.existsSync(chromeDataDir)) {
			this.logger.info(`启动 Chrome: ${chromePath}`);

			try {
				const browserProcess = spawn(
					chromePath,
					[
						`--remote-debugging-port=${debugPort}`,
						'--restore-last-session',
						'--no-first-run',
						'--disable-background-networking',
						'about:blank',
					],
					{
						detached: true,
						stdio: 'ignore',
						windowsHide: false,
					}
				);
				browserProcess.unref();

				this.logger.info('等待浏览器启动...');
				const cdpReady = await waitForCDP(debugPort, 15000);

				if (cdpReady) {
					const connection = await connectViaCDP(debugPort);
					if (connection) {
						this.logger.info('Chrome 浏览器已启动并连接（保留登录状态）');
						return { success: true, message: '浏览器已启动（Chrome，保留登录状态）' };
					}
				} else {
					this.logger.warn('Chrome CDP 端口未能在时限内就绪');
				}
			} catch (err: any) {
				this.logger.warn(`启动 Chrome 失败: ${err?.message || err}`);
			}
		}

		// ========== 步骤3：回退方案 - 使用 Playwright 内置方式 ==========
		this.logger.warn('无法启动用户浏览器，尝试 Playwright 内置方式...');

		const launchOptions = {
			headless: false,
			args: [
				'--start-maximized',
				'--disable-blink-features=AutomationControlled',
				`--remote-debugging-port=${debugPort}`,
			],
			viewport: null as any,
		};

		// 尝试使用 Edge 用户数据目录
		try {
			this.context = await chromium.launchPersistentContext(edgeDataDir, {
				...launchOptions,
				channel: 'msedge',
			});
			this.page = this.context.pages()[0] || (await this.context.newPage());
			this.logger.info('启动 Edge 浏览器（Playwright 方式，保留登录状态）');
			return { success: true, message: '浏览器已启动（Edge，保留登录状态）' };
		} catch (edgeError: any) {
			const errMsg = edgeError?.message || '';
			this.logger.debug(`Playwright Edge 启动失败: ${errMsg}`);

			// 如果是因为用户数据目录被占用，提示用户
			if (errMsg.includes('user data directory is already in use')) {
				this.logger.warn('Edge 用户数据目录被占用。提示：请关闭所有 Edge 窗口后重试，或者以调试模式启动 Edge');
			}
		}

		// 尝试 Chrome
		try {
			this.context = await chromium.launchPersistentContext(chromeDataDir, {
				...launchOptions,
				channel: 'chrome',
			});
			this.page = this.context.pages()[0] || (await this.context.newPage());
			this.logger.info('启动 Chrome 浏览器（Playwright 方式，保留登录状态）');
			return { success: true, message: '浏览器已启动（Chrome，保留登录状态）' };
		} catch (chromeError: any) {
			this.logger.debug(`Playwright Chrome 启动失败: ${chromeError?.message || chromeError}`);
		}

		// ========== 步骤4：最后回退 - 新会话（无登录状态）==========
		this.logger.warn('⚠️ 无法使用用户配置，将以新会话启动（无登录状态）');
		this.logger.warn('提示：请关闭所有浏览器窗口后重试，以获得登录状态');

		try {
			this.browser = await chromium.launch({
				headless: false,
				channel: 'msedge',
				args: ['--start-maximized'],
			});
			this.context = await this.browser.newContext({ viewport: null });
			this.page = await this.context.newPage();
			return { success: true, message: '⚠️ 浏览器已启动（新会话，无登录状态）' };
		} catch {
			// Edge 失败，尝试 Chromium
		}

		this.browser = await chromium.launch({ headless: false });
		this.context = await this.browser.newContext({ viewport: null });
		this.page = await this.context.newPage();
		return { success: true, message: '⚠️ 浏览器已启动（Chromium，新会话，无登录状态）' };
	}

	private async ensurePage(): Promise<Page> {
		if (!this.page || await this.isPageClosed(this.page)) {
			this.logger.info('页面连接已失效，重新建立连接');
			this.page = null;
			this.context = null;
			await this.openBrowser();
		}
		return this.page!;
	}

	/**
	 * 检查页面是否已关闭
	 */
	private async isPageClosed(page: Page): Promise<boolean> {
		try {
			// 尝试一个轻量级操作来验证连接
			await page.evaluate(() => true);
			return false;
		} catch (error) {
			// 如果操作失败，说明页面已关闭
			return true;
		}
	}

	/**
	 * 检查浏览器连接是否有效
	 */
	private async isConnectionValid(): Promise<boolean> {
		try {
			if (!this.page || !this.context) {
				return false;
			}

			// 验证页面是否响应
			await this.page.evaluate(() => true);
			return true;
		} catch (error) {
			return false;
		}
	}

	/**
	 * 快速搜索 - 内置常用搜索引擎
	 */
	private async quickSearch(query: string | undefined, engine: string | undefined): Promise<{ success: boolean; url: string; title: string }> {
		if (!query) {
			throw new Error('search 操作需要 searchQuery 参数');
		}

		// 常用搜索引擎URL模板
		const searchEngines: Record<string, string> = {
			google: 'https://www.google.com/search?q=',
			bing: 'https://www.bing.com/search?q=',
			baidu: 'https://www.baidu.com/s?wd=',
		};

		const searchEngine = engine || 'google';
		const baseUrl = searchEngines[searchEngine] || searchEngines.google;
		const searchUrl = baseUrl + encodeURIComponent(query);

		const page = await this.ensurePage();
		await page.goto(searchUrl);

		const title = await page.title();

		this.logger.info(`已搜索: ${searchEngine} - "${query}" -> ${searchUrl}`);
		return { success: true, url: searchUrl, title };
	}

	private async goto(url: string, timeout: number): Promise<{ success: boolean; url: string; title: string }> {
		const page = await this.ensurePage();

		// 跳转并等待网络基本稳定
		await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });

		// 聚焦到当前页面（让用户看到操作的页面）
		try {
			await page.bringToFront();
		} catch {
			// 忽略聚焦失败
		}

		// 额外等待一小段时间让页面渲染
		try {
			await page.waitForLoadState('networkidle', { timeout: 3000 });
		} catch {
			// 忽略超时，有些页面一直有网络活动
		}

		const title = await page.title();

		// 重置元素引用
		this.elementRefs.clear();
		this.nextRef = 1;

		this.logger.info(`已访问: ${url}`);
		return { success: true, url, title };
	}

	/**
	 * 获取页面快照 - 返回可交互元素列表
	 * 参考 Moltbot 的 snapshot 设计，集成文本压缩功能
	 */
	private async snapshot(): Promise<{
		success: boolean;
		action: string;
		url: string;
		title: string;
		elements: ElementRef[];
		text: string;
		compressedText?: string;
		searchAnalysis?: {
			found: boolean;
			confidence: number;
			elements: Array<{
				ref: number;
				type: string;
				placeholder?: string;
				text?: string;
				reason: string;
			}>;
		};
	}> {
		const page = await this.ensurePage();

		// 重置引用
		this.elementRefs.clear();
		this.nextRef = 1;

		const url = page.url();
		const title = await page.title();

		// 获取可交互元素（不限制数量）
		const elements: ElementRef[] = await page.evaluate(() => {
			const interactiveSelectors = [
				'a[href]',
				'button',
				'input',
				'select',
				'textarea',
				'[role="button"]',
				'[role="link"]',
				'[role="checkbox"]',
				'[role="radio"]',
				'[role="tab"]',
				'[role="menuitem"]',
				'[onclick]',
				'[tabindex]:not([tabindex="-1"])',
			];

			const elements: any[] = [];
			const seen = new Set<any>();

			for (const selector of interactiveSelectors) {
				const els = document.querySelectorAll(selector);
				for (const el of els) {
					if (seen.has(el)) continue;
					seen.add(el);

					const rect = el.getBoundingClientRect();
					// 跳过不可见元素
					if (rect.width === 0 || rect.height === 0) continue;
					if (rect.top > window.innerHeight || rect.bottom < 0) continue;

					const tagName = el.tagName.toLowerCase();
					const input = el as any;

					elements.push({
						ref: 0, // 后面填充
						tag: tagName,
						role: el.getAttribute('role') || undefined,
						name: el.getAttribute('name') || undefined,
						text: (el.textContent || '').trim().substring(0, 100) || undefined,
						href: (el as any).href || undefined,
						type: input.type || undefined,
						placeholder: input.placeholder || undefined,
						value: input.value || undefined,
						checked: input.checked || undefined,
						disabled: input.disabled || undefined,
						rect: {
							x: Math.round(rect.x),
							y: Math.round(rect.y),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						},
					});
				}
			}

			return elements;
		});

		// 分配 ref 并存储选择器
		for (let i = 0; i < elements.length; i++) {
			const ref = this.nextRef++;
			elements[i].ref = ref;

			// 生成唯一选择器（简化版）
			const el = elements[i];
			let selector = el.tag;
			if (el.name) selector += `[name="${el.name}"]`;
			else if (el.type) selector += `[type="${el.type}"]`;

			// 存储为 nth-child 选择器
			this.elementRefs.set(ref, `:nth-match(${selector}, ${i + 1})`);
		}

		// 获取页面主要文本内容 - 增强版本
		const textContent = await page.evaluate(() => {
			// @ts-ignore
			const body = document.body?.innerText || '';
			
			// 尝试获取更详细的文本内容，特别是B站等复杂页面
			let additionalContent: string[] = [];
			
			try {
				// 查找可能包含粉丝数的元素
				// @ts-ignore
				const fanElements = document.querySelectorAll('[class*="fan"], [class*="follow"], [class*="count"], [class*="number"]');
				// @ts-ignore
				fanElements.forEach((el) => {
					const text = el.innerText?.trim();
					if (text && (text.includes('万') || text.includes('千') || /\d+/.test(text))) {
						additionalContent.push(`粉丝信息: ${text}`);
					}
				});
				
				// 查找可能包含用户信息的元素
				// @ts-ignore
				const userElements = document.querySelectorAll('[class*="user"], [class*="name"], [class*="title"]');
				// @ts-ignore
				userElements.forEach((el) => {
					const text = el.innerText?.trim();
					if (text && text.length > 0 && text.length < 100) {
						additionalContent.push(`用户信息: ${text}`);
					}
				});
			} catch (e) {
				console.warn('获取额外内容时出错:', e);
			}
			
			const combined = body + '\n' + additionalContent.join('\n');
			return combined.substring(0, 8000); // 增加长度限制
		});

		// 文本压缩和搜索框分析
		const searchAnalysis = this.analyzeSearchElements(elements);
		const compressedText = this.compressStructureToText({
			url,
			title,
			totalCount: elements.length,
			elements: elements, // 给AI全部元素，不限制数量用于压缩
			searchAnalysis
		});

		this.logger.info(`页面快照: ${elements.length} 个可交互元素，已启用文本压缩`);

		const result = {
			success: true,
			action: 'snapshot', // 标识这是snapshot操作
			url,
			title,
			elements: elements, // 给AI全部元素，不限制数量
			text: textContent,
			compressedText,
			searchAnalysis,
		};

		// 调试日志：检查返回结果中的元素数量
		this.logger.info(`🔍 调试：返回结果中的elements数量: ${result.elements.length}`);
		
		// 验证关键内容
		const hasKeyContents = result.elements.some(el => 
			el.text?.includes('影视飓风') || 
			el.text?.includes('456万') || 
			el.text?.includes('粉丝')
		);
		this.logger.info(`🔍 调试：包含关键内容: ${hasKeyContents}`);

		return result;
	}

	/**
	 * 智能搜索框分析
	 */
	private analyzeSearchElements(elements: ElementRef[]): {
		found: boolean;
		confidence: number;
		elements: Array<{
			ref: number;
			type: string;
			placeholder?: string;
			text?: string;
			reason: string;
		}>;
	} {
		const searchIndicators = [
			'search', '搜索', '搜一搜', '查找', 'find', 'search for',
			'query', '关键词', 'keyword', 'input', 'input search',
			'searchbox', 'search box', 'search input'
		];

		const searchElements: Array<{
			ref: number;
			type: string;
			placeholder?: string;
			text?: string;
			reason: string;
		}> = [];

		let maxConfidence = 0;

		for (const element of elements) {
			let confidence = 0;
			const reasons: string[] = [];

			// 检查标签类型
			if (element.tag === 'input') {
				confidence += 20;
				reasons.push('input元素');
			}

			// 检查type属性
			if (element.type === 'search' || element.type === 'text') {
				confidence += 30;
				reasons.push(`type="${element.type}"`);
			}

			// 检查placeholder
			if (element.placeholder) {
				const placeholderLower = element.placeholder.toLowerCase();
				for (const indicator of searchIndicators) {
					if (placeholderLower.includes(indicator)) {
						confidence += 25;
						reasons.push(`占位符包含"${indicator}"`);
						break;
					}
				}
			}

			// 检查文本内容
			if (element.text) {
				const textLower = element.text.toLowerCase();
				for (const indicator of searchIndicators) {
					if (textLower.includes(indicator)) {
						confidence += 15;
						reasons.push(`文本包含"${indicator}"`);
						break;
					}
				}
			}

			// 检查name属性
			if (element.name) {
				const nameLower = element.name.toLowerCase();
				for (const indicator of searchIndicators) {
					if (nameLower.includes(indicator)) {
						confidence += 20;
						reasons.push(`name属性包含"${indicator}"`);
						break;
					}
				}
			}

			if (confidence >= 20) { // 至少20分才认为是搜索框
				searchElements.push({
					ref: element.ref!,
					type: element.type || 'text',
					placeholder: element.placeholder,
					text: element.text,
					reason: reasons.join(', ')
				});
				maxConfidence = Math.max(maxConfidence, confidence);
			}
		}

		return {
			found: searchElements.length > 0,
			confidence: maxConfidence,
			elements: searchElements
		};
	}

	/**
	 * 文本压缩：将页面结构压缩为AI友好的文本格式
	 */
	private compressStructureToText(structure: {
		url: string;
		title: string;
		totalCount: number;
		elements: ElementRef[];
		searchAnalysis: any;
	}): string {
		// 简化输出，只返回JSON结构
		const simplifiedData = {
			url: structure.url,
			title: structure.title,
			totalElements: structure.totalCount,
			elements: structure.elements.map((el: any) => ({
				ref: el.ref,
				tag: el.tag,
				text: el.text,
				type: el.type,
				placeholder: el.placeholder,
				href: el.href,
				position: el.rect
			})),
			searchFound: structure.searchAnalysis.found,
			searchElements: structure.searchAnalysis.elements?.map((el: any) => ({
				ref: el.ref,
				type: el.type,
				placeholder: el.placeholder,
				text: el.text,
				confidence: el.confidence
			})) || []
		};

		return JSON.stringify(simplifiedData, null, 2);
	}

	private async screenshot(): Promise<{ success: boolean; base64: string }> {
		const page = await this.ensurePage();

		const buffer = await page.screenshot({ fullPage: false });
		const base64 = buffer.toString('base64');

		this.logger.info('已截图');
		return { success: true, base64 };
	}

	private async click(ref: number, timeout: number): Promise<{ success: boolean; ref: number }> {
		const page = await this.ensurePage();

		// 在操作前验证连接是否仍然有效
		if (await this.isPageClosed(page)) {
			this.logger.info('页面连接已失效，重新建立连接');
			await this.openBrowser();
			const newPage = await this.ensurePage();
			
			// 重新获取页面元素
			const elements = await this.snapshot();
			const element = elements.elements.find((e) => e.ref === ref);
			
			if (!element) {
				throw new Error(`重新连接后找不到 ref=${ref} 的元素，请先执行 snapshot 获取最新元素列表`);
			}
			
			return this.performClick(newPage, ref, element);
		}

		// 获取当前页面元素列表
		const elements = await this.snapshot();
		const element = elements.elements.find((e) => e.ref === ref);

		if (!element) {
			throw new Error(`找不到 ref=${ref} 的元素，请先执行 snapshot 获取最新元素列表`);
		}

		return this.performClick(page, ref, element);
	}

	/**
	 * 执行点击操作
	 */
	private async performClick(page: Page, ref: number, element: any): Promise<{ success: boolean; ref: number }> {
		// 增强的点击机制：优先使用CSS选择器，备选坐标点击
		const selector = this.elementRefs.get(ref);
		
		if (selector) {
			try {
				// 使用Playwright的内置点击方法（更准确）
				await page.click(selector, { timeout: 5000 });
				this.logger.info(`已点击元素 ref=${ref} (使用选择器: ${selector})`);
			} catch (error) {
				this.logger.warn(`选择器点击失败，回退到坐标点击: ${error}`);
				// 回退到坐标点击
				await this.clickByCoordinates(ref, element);
			}
		} else {
			// 没有选择器，使用坐标点击
			await this.clickByCoordinates(ref, element);
		}

		return { success: true, ref };
	}

	/**
	 * 通过坐标点击元素
	 */
	private async clickByCoordinates(ref: number, element: any): Promise<void> {
		const page = await this.ensurePage();
		
		const { x, y, width, height } = element.rect;
		// 使用元素中心点点击
		const centerX = x + width / 2;
		const centerY = y + height / 2;

		// 添加点击前的短暂等待，确保页面稳定
		await new Promise(resolve => setTimeout(resolve, 100));
		
		await page.mouse.click(centerX, centerY);

		this.logger.info(`已点击元素 ref=${ref} (坐标: ${centerX}, ${centerY}, 尺寸: ${width}x${height})`);
	}

	private async type(
		ref: number | undefined,
		text: string,
		timeout: number
	): Promise<{ success: boolean; ref?: number; text: string }> {
		const page = await this.ensurePage();

		if (ref !== undefined) {
			// 如果指定了 ref，先点击该元素
			await this.click(ref, timeout);
		}
		// 否则在当前焦点位置输入

		// 清空并输入
		await page.keyboard.press('Control+a');
		await page.keyboard.type(text, { delay: 50 }); // 添加输入延迟，更自然

		this.logger.info(ref !== undefined ? `已在 ref=${ref} 输入文本` : '已在当前焦点输入文本');
		return { success: true, ref, text };
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

	private async select(
		ref: number,
		value: string,
		timeout: number
	): Promise<{ success: boolean; ref: number; value: string }> {
		const page = await this.ensurePage();

		const elements = await this.snapshot();
		const element = elements.elements.find((e) => e.ref === ref);

		if (!element || element.tag !== 'select') {
			throw new Error(`ref=${ref} 不是一个 select 元素`);
		}

		// 点击下拉框
		await this.click(ref, timeout);
		// 选择选项
		await page.selectOption(`select[name="${element.name}"]`, value);

		return { success: true, ref, value };
	}

	private async wait(
		timeout: number,
		waitFor?: string,
		selector?: string
	): Promise<{ success: boolean; waitType: string; detail?: string }> {
		const page = await this.ensurePage();
		const maxWait = Math.min(timeout, 15000); // 单次等待最多 15s，避免长时间卡住

		switch (waitFor) {
			case 'load':
				// 等待 load 事件（若已加载会立即返回）
				await page.waitForLoadState('load', { timeout: maxWait });
				this.logger.info('页面加载完成');
				return { success: true, waitType: 'load', detail: '页面已加载' };

			case 'network':
				// 先等 load，再等网络空闲；网络空闲在很多站点难以达到，用短超时，超时也视为可操作
				try {
					await page.waitForLoadState('load', { timeout: Math.min(maxWait, 5000) });
				} catch {
					// 忽略
				}
				try {
					await page.waitForLoadState('networkidle', { timeout: Math.min(maxWait, 8000) });
					this.logger.info('网络空闲');
					return { success: true, waitType: 'network', detail: '网络已空闲' };
				} catch {
					this.logger.info('网络空闲超时，页面已可操作');
					return { success: true, waitType: 'network', detail: '页面已加载，可继续操作' };
				}

			case 'selector':
				if (!selector) {
					throw new Error('waitFor=selector 需要提供 selector 参数');
				}
				await page.waitForSelector(selector, { timeout: maxWait });
				this.logger.info(`元素已出现: ${selector}`);
				return { success: true, waitType: 'selector', detail: `元素 ${selector} 已出现` };

			default:
				const startTime = Date.now();
				const shortWait = Math.min(maxWait, 3000);
				try {
					await page.waitForLoadState('domcontentloaded', { timeout: shortWait });
				} catch {
					// 忽略
				}
				const actualWait = Date.now() - startTime;
				this.logger.info(`等待完成: ${actualWait}ms`);
				return { success: true, waitType: 'auto', detail: `等待了 ${actualWait}ms` };
		}
	}

	private async evaluate(script: string): Promise<{ success: boolean; result: unknown }> {
		const page = await this.ensurePage();
		const result = await page.evaluate(script);
		return { success: true, result };
	}

	private async listTabs(): Promise<{
		success: boolean;
		tabs: Array<{ index: number; url: string; title: string }>;
	}> {
		if (!this.context) {
			return { success: true, tabs: [] };
		}

		const pages = this.context.pages();
		const tabs = await Promise.all(
			pages.map(async (p, i) => ({
				index: i,
				url: p.url(),
				title: await p.title(),
			}))
		);

		return { success: true, tabs };
	}

	/**
	 * 发送浏览器通知（通过扩展）
	 */
	private async sendNotification(
		title?: string,
		message?: string
	): Promise<{ success: boolean; message: string }> {
		if (!message) {
			return { success: false, message: 'notify 操作需要 notifyMessage 参数' };
		}

		// 只有扩展模式支持通知
		if (this.mode !== 'extension') {
			this.logger.warn('通知功能仅在扩展模式下可用');
			return { success: false, message: '通知功能仅在扩展模式下可用' };
		}

		try {
			const relayUrl = `http://127.0.0.1:${this.cdpRelayPort}`;
			const response = await fetch(`${relayUrl}/notify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: title || 'NutBot 任务完成',
					message,
				}),
				signal: AbortSignal.timeout(5000),
			});

			if (response.ok) {
				const result = await response.json() as { success?: boolean };
				if (result.success) {
					this.logger.info(`已发送通知: ${title || 'NutBot'}`);
					return { success: true, message: '通知已发送' };
				}
			}

			return { success: false, message: '发送通知失败' };
		} catch (error) {
			this.logger.warn(`发送通知失败: ${(error as Error).message}`);
			return { success: false, message: `发送通知失败: ${(error as Error).message}` };
		}
	}

	/**
	 * 关闭当前标签页（不关闭整个浏览器）
	 */
	private async closeCurrentTab(): Promise<{ success: boolean; message: string }> {
		if (!this.page || this.page.isClosed()) {
			return { success: true, message: '没有需要关闭的标签页' };
		}

		const url = this.page.url();
		this.logger.info(`关闭当前标签页: ${url}`);

		// 扩展模式下通过 CDP 关闭标签页
		if (this.mode === 'extension') {
			try {
				const browser = this.page.context().browser();
				if (browser) {
					const cdpSession = await browser.newBrowserCDPSession();
					const { targetInfos } = (await cdpSession.send('Target.getTargets')) as {
						targetInfos: Array<{ targetId: string; url: string; type: string }>;
					};

					const target = targetInfos.find((t) => t.url === url && t.type === 'page');
					if (target) {
						// 不带 closeBrowser 参数，只关闭标签页
						await cdpSession.send('Target.closeTarget', {
							targetId: target.targetId,
						});
						this.logger.info(`标签页已关闭: ${url}`);
					}
				}
			} catch (e) {
				this.logger.debug(`通过 CDP 关闭标签页失败: ${(e as Error).message}`);
				// 尝试直接关闭
				try {
					await this.page.close();
				} catch {
					// 忽略
				}
			}
		} else {
			// 非扩展模式直接关闭页面
			try {
				await this.page.close();
			} catch {
				// 忽略
			}
		}

		// 从 managedPages 移除
		this.managedPages.delete(this.page);
		
		// 切换到其他标签页（如果有）
		if (this.context) {
			const pages = this.context.pages();
			if (pages.length > 0) {
				this.page = pages[pages.length - 1];
				try {
					await this.page.bringToFront();
				} catch {
					// 忽略
				}
			} else {
				this.page = null;
			}
		} else {
			this.page = null;
		}

		this.elementRefs.clear();
		return { success: true, message: `已关闭标签页: ${url}` };
	}

	private async closeBrowser(): Promise<{ success: boolean; message: string }> {
		let closedTabs = 0;
		let closedWindow = false;

		// 扩展模式下：根据情况决定关闭方式
		if (this.mode === 'extension') {
			// 关闭单个标签页的辅助函数
			const closeTabViaExtension = async (page: Page, closeBrowserWindow = false): Promise<boolean> => {
				try {
					const url = page.url();
					this.logger.info(`正在关闭标签页: ${url}`);

					const browser = page.context().browser();
					if (browser) {
						try {
							const cdpSession = await browser.newBrowserCDPSession();
							const { targetInfos } = (await cdpSession.send('Target.getTargets')) as {
								targetInfos: Array<{ targetId: string; url: string; type: string }>;
							};

							const target = targetInfos.find((t) => t.url === url && t.type === 'page');
							if (target) {
								// @ts-ignore
								await cdpSession.send('Target.closeTarget', {
									targetId: target.targetId,
									// closeBrowser: closeBrowserWindow, // 只有需要关闭整个浏览器时才为 true
								});
								this.logger.info(closeBrowserWindow ? `已关闭浏览器窗口` : `已关闭标签页: ${url}`);
								return true;
							}
						} catch (cdpError) {
							this.logger.debug(`关闭失败: ${(cdpError as Error).message}`);
						}
					}
					return false;
				} catch (e) {
					this.logger.debug(`关闭时出错: ${(e as Error).message}`);
					return false;
				}
			};

			// 决定关闭策略：恢复原状
			if (this.browserOpenedByNutBot) {
				// 浏览器是 NutBot 打开的 → 关闭整个浏览器
				this.logger.info('浏览器由 NutBot 启动，将关闭整个浏览器');
				if (this.page && !this.page.isClosed()) {
					if (await closeTabViaExtension(this.page, true)) {
						closedWindow = true;
					}
				}
			} else {
				// 浏览器是用户已经打开的 → 只关闭 NutBot 打开的标签页
				this.logger.info(`浏览器已在运行，只关闭 NutBot 打开的 ${this.managedPages.size} 个标签页`);
				
				// 关闭所有 NutBot 管理的标签页
				for (const page of this.managedPages) {
					if (!page.isClosed()) {
						if (await closeTabViaExtension(page, false)) {
							closedTabs++;
						}
					}
				}
				
				// 如果当前页面不在 managedPages 中但是是 about:blank，也关闭
				if (this.page && !this.page.isClosed() && !this.managedPages.has(this.page)) {
					const url = this.page.url();
					if (url === 'about:blank' || url === '') {
						if (await closeTabViaExtension(this.page, false)) {
							closedTabs++;
						}
					}
				}
			}

			this.managedPages.clear();
		}

		// 保存状态用于最后的消息
		const wasOpenedByNutBot = this.browserOpenedByNutBot;
		
		// 清理状态
		this.page = null;
		this.elementRefs.clear();
		this.initialPageUrl = null;
		this.browserOpenedByNutBot = false;
		this.initialTabCount = 0;

		// 扩展模式下：断开 CDP 连接
		if (this.mode === 'extension') {
			if (this.context) {
				// 只断开 Playwright 连接，不调用 context.close()（那样会关闭所有页面）
				this.context = null;
			}
			if (this.browser) {
				this.logger.debug('正在断开 CDP 连接...');
				try {
					// 添加超时保护
					await Promise.race([
						this.browser.close(),
						new Promise((_, reject) => setTimeout(() => reject(new Error('断开连接超时')), 5000)),
					]);
				} catch (e) {
					this.logger.debug(`断开连接时出错: ${(e as Error).message}`);
				}
				this.browser = null;
			}

			// 只有在浏览器是 NutBot 打开的且 CDP 关闭失败时，才使用系统命令关闭浏览器
			if (wasOpenedByNutBot && closedTabs === 0 && !closedWindow) {
				this.logger.info('CDP 关闭失败，尝试使用系统命令关闭浏览器...');
				const { exec } = await import('child_process');
				const { promisify } = await import('util');
				const execAsync = promisify(exec);

				// 获取要关闭的浏览器进程列表（根据平台和常见浏览器）
				const getBrowserProcesses = (): { win: string[]; mac: string[]; linux: string[] } => {
					return {
						// Windows 进程名（不带 .exe）
						win: ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'],
						// macOS 应用名
						mac: ['Google Chrome', 'Microsoft Edge', 'Firefox', 'Brave Browser', 'Opera', 'Vivaldi', 'Safari'],
						// Linux 进程名
						linux: ['chrome', 'chromium', 'firefox', 'brave', 'opera', 'vivaldi', 'microsoft-edge'],
					};
				};

				try {
					const browsers = getBrowserProcesses();

					if (process.platform === 'win32') {
						// Windows: 尝试关闭所有常见浏览器进程
						await execAsync(
							`powershell -Command "${browsers.win.map((b) => `Stop-Process -Name ${b} -Force -ErrorAction SilentlyContinue`).join('; ')}"`
						);
					} else if (process.platform === 'darwin') {
						// macOS: 使用 osascript 优雅关闭，或 pkill 强制关闭
						for (const browser of browsers.mac) {
							try {
								// 先尝试优雅关闭
								await execAsync(`osascript -e 'quit app "${browser}"' 2>/dev/null || true`);
							} catch {
								// 如果优雅关闭失败，强制关闭
								await execAsync(`pkill -9 "${browser}" 2>/dev/null || true`);
							}
						}
					} else {
						// Linux: 尝试关闭所有常见浏览器
						for (const browser of browsers.linux) {
							await execAsync(`pkill -9 ${browser} 2>/dev/null || true`);
						}
					}
					this.logger.info('已通过系统命令关闭浏览器');
					return { success: true, message: '浏览器已关闭' };
				} catch (e) {
					// 即使命令"失败"（比如没有找到进程），也认为关闭成功
					this.logger.info('浏览器已关闭（可能已经关闭）');
					return { success: true, message: '浏览器已关闭' };
				}
			}

			// 生成结果消息
			if (closedWindow) {
				this.logger.info('已关闭浏览器窗口');
				return { success: true, message: '浏览器已关闭' };
			} else if (closedTabs > 0) {
				this.logger.info(`已关闭 ${closedTabs} 个标签页并断开连接`);
				return { success: true, message: `已关闭 ${closedTabs} 个 NutBot 打开的标签页，浏览器保持运行` };
			} else {
				this.logger.info('已断开连接，浏览器保持运行');
				return { success: true, message: '已断开连接，浏览器保持运行' };
			}
		}

		// 非扩展模式：完全关闭浏览器
		if (this.context) {
			await this.context.close();
			this.context = null;
			this.logger.info('浏览器已关闭');
		}
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
		return { success: true, message: '浏览器已关闭' };
	}

	async cleanup(): Promise<void> {
		await this.closeBrowser();
	}

	/**
	 * 检查浏览器是否已打开
	 */
	isOpen(): boolean {
		return this.context !== null && this.page !== null;
	}
}

export default BrowserTool;
