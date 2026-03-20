/**
 * Fastify Server
 * HTTP API 和 WebSocket 服务
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply, type FastifyError } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { logger, Logger, LogEntry } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';
import { registerRoutes, registerScreenshotRoutes } from './routes/index.js';
import type { Gateway } from '../gateway/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ServerOptions {
	host?: string;
	port?: number;
	cors?: {
		origin: string | string[] | boolean;
	};
}

interface WebSocketClient {
	id: string;
	ws: WebSocket;
	connectedAt: Date;
}

// 调试确认等待机制
interface PendingConfirmation {
	resolve: (approved: boolean) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * 等待用户确认（调试模式用）
 */
export function waitForConfirmation(confirmId: string, timeoutMs: number = 300000): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingConfirmations.delete(confirmId);
			reject(new Error('确认超时'));
		}, timeoutMs);

		pendingConfirmations.set(confirmId, { resolve, reject, timeout });
	});
}

/**
 * 响应用户确认
 */
export function respondToConfirmation(confirmId: string, approved: boolean): boolean {
	const pending = pendingConfirmations.get(confirmId);
	if (pending) {
		clearTimeout(pending.timeout);
		pending.resolve(approved);
		pendingConfirmations.delete(confirmId);
		return true;
	}
	return false;
}

export class Server {
	private app: FastifyInstance;
	private gateway: Gateway;
	private host: string;
	private port: number;
	private wsClients: Map<string, WebSocketClient> = new Map();
	private logger = logger.child('Server');

	constructor(gateway: Gateway, options: ServerOptions = {}) {
		this.gateway = gateway;
		this.host = options.host || '127.0.0.1';
		this.port = options.port || 18800;

		// 创建 Fastify 实例
		this.app = Fastify({
			logger: false, // 使用自定义 logger
			disableRequestLogging: true,
		});

		// 处理 JSON 空 body（允许无 body 的请求，如 DELETE、GET 等）
		// 使用 contentTypeParser 在 Fastify 解析 body 之前处理
		this.app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
			try {
				const bodyStr = body as string;
				// 如果 body 为空，返回空对象
				if (!bodyStr || bodyStr.trim() === '') {
					return done(null, {});
				}
				// 正常解析 JSON
				const parsed = JSON.parse(bodyStr);
				return done(null, parsed);
			} catch (error) {
				return done(error as Error);
			}
		});
	}

	/**
	 * 初始化服务器
	 */
	async init(): Promise<void> {
		// 注册 CORS（允许所有方法）
		await this.app.register(fastifyCors, {
			origin: true,
			methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization'],
			credentials: true,
		});

		// 注册 WebSocket
		await this.app.register(fastifyWebsocket, {
			options: {
				maxPayload: 1024 * 1024 * 10, // 10MB
			},
		});

		// WebSocket 路由
		this.app.register(async (fastify) => {
			fastify.get('/ws', { websocket: true }, (socket, request) => {
				this.handleWebSocket(socket as unknown as WebSocket, request);
			});
		});

		// 注册 API 路由（带 /api 前缀）
		await this.app.register(registerRoutes(this.gateway), { prefix: '/api' });

		// 注册截图服务路由（不带前缀，直接访问）
		await this.app.register(registerScreenshotRoutes(), { prefix: '/screenshots' });

		// 静态文件服务（Web UI）
		const webDistPath = join(__dirname, '../../web/dist');
		if (existsSync(webDistPath)) {
			await this.app.register(fastifyStatic, {
				root: webDistPath,
				prefix: '/',
			});

			// SPA fallback
			this.app.setNotFoundHandler((request, reply) => {
				if (request.url.startsWith('/api') || request.url.startsWith('/ws') || request.url.startsWith('/mcp') || request.url.startsWith('/screenshots')) {
					return reply.code(404).send({ error: true, message: 'Not found' });
				}
				return reply.sendFile('index.html');
			});
		} else {
			// 没有构建 Web UI 时显示提示
			this.app.get('/', async (request, reply) => {
				return reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NutBot</title>
</head>
<body style="background: #1a1a1a; color: #e5e5e5; font-family: system-ui; padding: 40px; text-align: center;">
  <h1>🥜 NutBot 已启动</h1>
  <p>API 服务运行中: <a href="/api/health" style="color: #f59e0b;">/api/health</a></p>
  <p style="color: #a1a1aa;">Web UI 未构建，请运行: <code style="background: #333; padding: 2px 8px; border-radius: 4px;">cd web && yarn install && yarn build</code></p>
</body>
</html>`);
			});
		}

		// 错误处理
		this.app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
			this.logger.error('请求错误:', error.message);
			return reply.code(error.statusCode || 500).send({
				error: true,
				message: error.message,
			});
		});
	}

	/**
	 * 处理 WebSocket 连接
	 */
	private handleWebSocket(ws: WebSocket, request: FastifyRequest): void {
		const clientId = generateId('client');

		this.wsClients.set(clientId, {
			id: clientId,
			ws,
			connectedAt: new Date(),
		});

		this.logger.info(`WebSocket 客户端已连接: ${clientId}`);

		// 发送连接确认
		this.sendToClient(clientId, {
			type: 'connected',
			clientId,
		});

		// 发送历史日志
		const logBuffer = Logger.getLogBuffer();
		if (logBuffer.length > 0) {
			this.sendToClient(clientId, {
				type: 'log_history',
				logs: logBuffer,
			});
		}

		// 处理消息
		ws.on('message', async (data) => {
			try {
				const message = JSON.parse(data.toString());
				await this.handleWebSocketMessage(clientId, message);
			} catch (error) {
				this.sendToClient(clientId, {
					type: 'error',
					error: { message: (error as Error).message },
				});
			}
		});

		// 处理关闭
		ws.on('close', () => {
			this.wsClients.delete(clientId);
			this.logger.info(`WebSocket 客户端已断开: ${clientId}`);
		});

		// 处理错误
		ws.on('error', (error) => {
			this.logger.error(`WebSocket 错误 [${clientId}]:`, error.message);
		});
	}

	/**
	 * 处理 WebSocket 消息
	 */
	private async handleWebSocketMessage(
		clientId: string,
		message: { type: string; id?: string; payload?: Record<string, unknown> }
	): Promise<void> {
		const { type, id, payload } = message;

		switch (type) {
			case 'ping':
				this.sendToClient(clientId, { type: 'pong', id });
				break;

			case 'chat':
				await this.handleChatMessage(clientId, id, payload);
				break;

			case 'chat_interrupt':
				await this.handleChatInterrupt(clientId, id, payload);
				break;

			case 'debug_response':
				// 处理调试确认响应
				const confirmId = payload?.confirmId as string;
				const approved = payload?.approved as boolean;
				if (confirmId) {
					const handled = respondToConfirmation(confirmId, approved ?? false);
					this.sendToClient(clientId, {
						type: 'debug_response_ack',
						id,
						confirmId,
						handled,
					});
				}
				break;

			default:
				this.sendToClient(clientId, {
					type: 'error',
					id,
					error: { message: `Unknown message type: ${type}` },
				});
		}
	}

	/**
	 * 处理聊天消息
	 */
	private async handleChatMessage(
		clientId: string,
		messageId: string | undefined,
		payload: Record<string, unknown> | undefined
	): Promise<void> {
		const { message, sessionId, options } = payload || {};

		if (!message || typeof message !== 'string') {
			this.sendToClient(clientId, {
				type: 'chat:error',
				id: messageId,
				error: { message: 'Missing message' },
			});
			return;
		}

		try {
			for await (const chunk of this.gateway.chat(message, {
				sessionId: sessionId as string | undefined,
				...(options as Record<string, unknown>),
			})) {
				this.sendToClient(clientId, {
					type: 'chat:chunk',
					id: messageId,
					chunk,
				});
			}

			this.sendToClient(clientId, {
				type: 'chat:done',
				id: messageId,
			});
		} catch (error) {
			this.sendToClient(clientId, {
				type: 'chat:error',
				id: messageId,
				error: { message: (error as Error).message },
			});
		}
	}

	/**
	 * 处理聊天中断消息
	 */
	private async handleChatInterrupt(
		clientId: string,
		messageId: string | undefined,
		payload: Record<string, unknown> | undefined
	): Promise<void> {
		const { reason } = payload || {};
		
		console.log(`[WebSocket] 收到中断请求，clientId=${clientId}, reason=${reason || 'user_requested'}`);

		try {
			// 通知网关中断当前聊天
			await this.gateway.interrupt(reason as string);
			
			console.log(`[WebSocket] 中断命令已发送给 Gateway`);

			this.sendToClient(clientId, {
				type: 'chat:interrupted',
				id: messageId,
				reason: reason || 'user_requested',
			});
		} catch (error) {
			console.error(`[WebSocket] 中断失败:`, error);
			this.sendToClient(clientId, {
				type: 'chat:interrupt_error',
				id: messageId,
				error: { message: (error as Error).message },
			});
		}
	}

	/**
	 * 发送消息给客户端
	 */
	sendToClient(clientId: string, message: Record<string, unknown>): void {
		const client = this.wsClients.get(clientId);
		if (client && client.ws.readyState === WebSocket.OPEN) {
			client.ws.send(JSON.stringify(message));
		}
	}

	/**
	 * 广播消息给所有客户端
	 */
	broadcast(message: Record<string, unknown>, exclude?: string): void {
		const data = JSON.stringify(message);
		for (const [id, client] of this.wsClients) {
			if (id !== exclude && client.ws.readyState === WebSocket.OPEN) {
				client.ws.send(data);
			}
		}
	}

	/**
	 * 启动服务器
	 */
	async start(options: { openBrowser?: boolean } = {}): Promise<void> {
		// 设置日志广播回调
		Logger.setBroadcastCallback((entry: LogEntry) => {
			this.broadcast({ type: 'log', entry });
		});

		await this.app.listen({ host: this.host, port: this.port });
		this.logger.success(`服务器已启动: http://${this.host}:${this.port}`);
		this.logger.info(`WebSocket 地址: ws://${this.host}:${this.port}/ws`);

		// 只有明确指定 openBrowser: true 时才自动打开浏览器
		if (options.openBrowser === true) {
			this.openBrowser();
		}
	}

	/**
	 * 打开浏览器
	 */
	private openBrowser(): void {
		const url = `http://${this.host}:${this.port}`;
		const platform = process.platform;

		let cmd: string;
		if (platform === 'win32') {
			cmd = `start "" "${url}"`;
		} else if (platform === 'darwin') {
			cmd = `open "${url}"`;
		} else {
			cmd = `xdg-open "${url}"`;
		}

		exec(cmd, (error) => {
			if (error) {
				this.logger.warn(`无法自动打开浏览器，请手动访问: ${url}`);
			}
		});
	}

	/**
	 * 停止服务器
	 */
	async stop(): Promise<void> {
		this.logger.info('正在停止服务器...');

		// 关闭所有 WebSocket 连接
		for (const [id, client] of this.wsClients) {
			client.ws.close();
		}
		this.wsClients.clear();

		// 关闭 Fastify
		await this.app.close();
		this.logger.success('服务器已停止');
	}

	/**
	 * 获取状态
	 */
	getStatus(): Record<string, unknown> {
		return {
			host: this.host,
			port: this.port,
			wsClients: this.wsClients.size,
		};
	}
}

export default Server;
