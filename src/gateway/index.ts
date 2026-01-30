/**
 * Gateway 核心
 * NutBot 的中央控制器，协调所有模块
 */

import { configManager, ConfigManager } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { Server } from '../server/index.js';
import { startCDPRelayServer, type CDPRelayServer } from '../server/cdp-relay.js';
import { ProviderManager } from '../providers/index.js';
import { ToolRegistry } from '../tools/index.js';
import { Agent } from '../agent/index.js';
import { SessionManager } from '../agent/session.js';
import { CronManager } from '../cron/index.js';
import { systemInfo } from '../tools/exec.js';
import type { AgentChunk } from '../types/index.js';

interface GatewayOptions {
	configPath?: string;
	silent?: boolean; // 静默模式，不输出日志
}

interface ChatOptions {
	sessionId?: string;
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
}

/**
 * Gateway 类
 * 核心网关，协调所有子系统
 */
export class Gateway {
	version = '0.1.0';
	config: ConfigManager = configManager;
	logger = logger;

	// 子系统
	server: Server | null = null;
	cdpRelay: CDPRelayServer | null = null;
	providerManager!: ProviderManager;
	toolRegistry!: ToolRegistry;
	agent!: Agent;
	sessionManager!: SessionManager;
	cronManager!: CronManager;

	running = false;
	startTime: Date | null = null;

	/**
	 * 初始化 Gateway
	 */
	async init(options: GatewayOptions = {}): Promise<this> {
		const silent = options.silent ?? false;

		if (!silent) this.logger.info('正在初始化 NutBot Gateway...');

		// 初始化配置
		this.config.init(options.configPath || null);

		// 初始化日志系统
		this.logger.init({
			level: this.config.get('logging.level', 'info'),
			console: silent ? false : this.config.get('logging.console', true),
			file: this.config.get<string | undefined>('logging.file'),
		});

		// 初始化子系统
		await this.initSubsystems();

		// 打印系统信息（非静默模式）
		if (!silent) {
			const osName = systemInfo.isWindows ? 'Windows' : systemInfo.isMac ? 'macOS' : 'Linux';
			this.logger.info(`系统环境: ${osName} ${systemInfo.release} (${systemInfo.arch})`);
			this.logger.info(`用户目录: ${systemInfo.homedir}`);
			this.logger.info(`默认 Shell: ${systemInfo.shell}`);
			this.logger.success('Gateway 初始化完成');
		}

		return this;
	}

	/**
	 * 初始化所有子系统
	 */
	private async initSubsystems(): Promise<void> {
		// 1. Provider 管理器
		this.providerManager = new ProviderManager(this.config);
		await this.providerManager.init();
		this.logger.debug('Provider 管理器初始化完成');

		// 2. Tool 注册表
		this.toolRegistry = new ToolRegistry(this);
		await this.toolRegistry.init();
		this.logger.debug('工具注册表初始化完成');

		// 3. Session 管理器
		this.sessionManager = new SessionManager(this.config);
		await this.sessionManager.init();
		this.logger.debug('会话管理器初始化完成');

		// 4. Agent
		this.agent = new Agent(this);
		await this.agent.init();
		this.logger.debug('Agent 初始化完成');

		// 5. Cron 管理器
		this.cronManager = new CronManager(this);
		await this.cronManager.init();
		this.logger.debug('定时任务管理器初始化完成');

		// 6. HTTP/WS 服务器
		this.server = new Server(this, {
			host: this.config.get('server.host', '127.0.0.1'),
			port: this.config.get('server.port', 18800),
		});
		await this.server.init();
	}

	/**
	 * 启动 Gateway
	 */
	async start(options: { openBrowser?: boolean } = {}): Promise<this> {
		if (this.running) {
			this.logger.warn('Gateway 已经在运行中');
			return this;
		}

		this.logger.info('正在启动 NutBot Gateway...');

		// 启动 HTTP/WS 服务器
		await this.server?.start({ openBrowser: options.openBrowser });

		// 启动 CDP Relay 服务（用于浏览器扩展）
		try {
			const cdpRelayPort = this.config.get('browser.cdpRelayPort', 18801);
			this.cdpRelay = await startCDPRelayServer({
				host: this.config.get('server.host', '127.0.0.1'),
				port: cdpRelayPort,
			});
			this.logger.info(`CDP Relay 已启动: ws://${this.config.get('server.host')}:${cdpRelayPort}`);
		} catch (error) {
			this.logger.warn('CDP Relay 启动失败:', (error as Error).message);
		}

		// 启动 Cron 调度器
		await this.cronManager.start();

		this.running = true;
		this.startTime = new Date();

		this.logger.success('NutBot Gateway 启动成功');
		this.logger.info(`控制面板: http://${this.config.get('server.host')}:${this.config.get('server.port')}`);

		return this;
	}

	/**
	 * 停止 Gateway
	 */
	async stop(): Promise<void> {
		if (!this.running) return;

		this.logger.info('正在停止 NutBot Gateway...');

		// 停止 Cron 调度器
		await this.cronManager?.stop();

		// 停止 CDP Relay
		this.cdpRelay?.close();
		this.cdpRelay = null;

		// 停止 HTTP/WS 服务器
		await this.server?.stop();

		// 清理资源
		await this.toolRegistry?.cleanup();

		this.running = false;
		this.logger.success('NutBot Gateway 已停止');
	}

	/**
	 * 执行聊天
	 */
	async *chat(message: string, options: ChatOptions = {}): AsyncGenerator<AgentChunk> {
		const { sessionId } = options;

		// 获取或创建会话
		let session = null;
		if (sessionId) {
			session = this.sessionManager.getSession(sessionId);
		}
		// 如果找不到会话或没有提供 sessionId，创建新会话
		if (!session) {
			session = this.sessionManager.createSession();
		}

		// 执行 Agent
		for await (const chunk of this.agent.run(message, session, options)) {
			yield chunk;
		}
	}

	/**
	 * 执行工具
	 */
	async executeTool(
		toolName: string,
		params: Record<string, unknown>,
		options: Record<string, unknown> = {}
	): Promise<unknown> {
		const tool = this.toolRegistry.getTool(toolName);

		if (!tool) {
			throw new Error(`Tool not found: ${toolName}`);
		}

		return await tool.execute(params, options);
	}

	/**
	 * 获取状态
	 */
	getStatus(): Record<string, unknown> {
		return {
			version: this.version,
			running: this.running,
			startTime: this.startTime,
			uptime: this.running && this.startTime ? Date.now() - this.startTime.getTime() : 0,
			server: this.server?.getStatus(),
			cdpRelay: this.cdpRelay
				? {
						port: this.cdpRelay.getPort(),
						extensionConnected: this.cdpRelay.isExtensionConnected(),
						connectedTargets: this.cdpRelay.getConnectedTargets().size,
					}
				: null,
			providers: this.providerManager?.getStatus(),
			tools: this.toolRegistry?.listTools().length,
			sessions: this.sessionManager?.listSessions().length,
			cron: this.cronManager?.getStatus(),
		};
	}

	/**
	 * 获取日志
	 */
	getLogs(options: { limit?: number; level?: string; since?: string } = {}): unknown[] {
		// TODO: 实现日志查询
		return [];
	}

	/**
	 * 发布事件
	 */
	emit(event: string, data: unknown): void {
		this.server?.broadcast({ event, data });
	}
}

// 单例导出
export const gateway = new Gateway();
export default gateway;
