/**
 * NutBot CDP Relay 服务
 * 参考 Playwriter/Moltbot 设计
 *
 * 功能：
 * 1. 接收浏览器扩展的 WebSocket 连接
 * 2. 接收 Playwright 客户端的 CDP 连接
 * 3. 在两者之间转发 CDP 命令和事件
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { logger as baseLogger } from '../utils/logger.js';

const logger = baseLogger.child('CDPRelay');

// ============================================================================
// 类型定义
// ============================================================================

interface TargetInfo {
	targetId: string;
	type: string;
	title: string;
	url: string;
	attached?: boolean;
}

interface ConnectedTarget {
	sessionId: string;
	targetId: string;
	targetInfo: TargetInfo;
}

interface CDPCommand {
	id: number;
	method: string;
	params?: unknown;
	sessionId?: string;
}

interface CDPResponse {
	id: number;
	result?: unknown;
	error?: { message: string };
	sessionId?: string;
}

interface CDPEvent {
	method: string;
	params?: unknown;
	sessionId?: string;
}

interface ExtensionMessage {
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: string;
}

interface PlaywrightClient {
	id: string;
	ws: WebSocket;
}

// ============================================================================
// CDP Relay 服务器
// ============================================================================

export interface CDPRelayOptions {
	port?: number;
	host?: string;
}

export interface CDPRelayServer {
	close(): void;
	getPort(): number;
	isExtensionConnected(): boolean;
	getConnectedTargets(): Map<string, ConnectedTarget>;
}

export async function startCDPRelayServer(options: CDPRelayOptions = {}): Promise<CDPRelayServer> {
	const { port = 18801, host = '127.0.0.1' } = options;

	// 状态
	const connectedTargets = new Map<string, ConnectedTarget>();
	const playwrightClients = new Map<string, PlaywrightClient>();
	let extensionWs: WebSocket | null = null;
	let extensionMessageId = 0;
	let pingInterval: ReturnType<typeof setInterval> | null = null;

	const pendingRequests = new Map<
		number,
		{
			resolve: (result: unknown) => void;
			reject: (error: Error) => void;
		}
	>();

	// ========== 辅助函数 ==========

	function sendToPlaywright(message: CDPResponse | CDPEvent, clientId?: string): void {
		const messageStr = JSON.stringify(message);

		if (clientId) {
			const client = playwrightClients.get(clientId);
			if (client && client.ws.readyState === WebSocket.OPEN) {
				client.ws.send(messageStr);
			}
		} else {
			// 广播给所有客户端
			for (const client of playwrightClients.values()) {
				if (client.ws.readyState === WebSocket.OPEN) {
					client.ws.send(messageStr);
				}
			}
		}
	}

	async function sendToExtension<T = unknown>(method: string, params?: unknown, timeout = 30000): Promise<T> {
		if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
			throw new Error('扩展未连接');
		}

		const id = ++extensionMessageId;
		const message = { id, method, params };

		extensionWs.send(JSON.stringify(message));

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pendingRequests.delete(id);
				reject(new Error(`扩展请求超时: ${method}`));
			}, timeout);

			pendingRequests.set(id, {
				resolve: (result) => {
					clearTimeout(timeoutId);
					resolve(result as T);
				},
				reject: (error) => {
					clearTimeout(timeoutId);
					reject(error);
				},
			});
		});
	}

	function startExtensionPing(): void {
		stopExtensionPing();
		pingInterval = setInterval(() => {
			if (extensionWs?.readyState === WebSocket.OPEN) {
				extensionWs.send(JSON.stringify({ method: 'ping' }));
			}
		}, 5000);
	}

	function stopExtensionPing(): void {
		if (pingInterval) {
			clearInterval(pingInterval);
			pingInterval = null;
		}
	}

	// ========== 路由 CDP 命令 ==========

	async function routeCDPCommand(command: CDPCommand): Promise<unknown> {
		const { method, params, sessionId } = command;

		switch (method) {
			case 'Browser.getVersion':
				return {
					protocolVersion: '1.3',
					product: 'NutBot/1.0.0',
					revision: '1.0.0',
					userAgent: 'NutBot-CDP-Relay/1.0.0',
					jsVersion: 'V8',
				};

			case 'Target.setAutoAttach':
				if (!sessionId) {
					// 无已附加标签页时，自动创建初始标签页（无需用户手动点击扩展）
					if (connectedTargets.size === 0 && extensionWs) {
						try {
							const createResult = (await sendToExtension('createInitialTab', undefined, 10000)) as {
								success?: boolean;
								sessionId?: string;
								targetInfo?: TargetInfo;
							};
							if (createResult?.success && createResult.sessionId && createResult.targetInfo) {
								connectedTargets.set(createResult.sessionId, {
									sessionId: createResult.sessionId,
									targetId: createResult.targetInfo.targetId,
									targetInfo: createResult.targetInfo,
								});
								logger.info('已自动创建初始标签页');
							}
						} catch (e) {
							logger.debug('自动创建初始标签页失败（可能扩展未就绪）:', (e as Error).message);
						}
					}
					// 转发给扩展
					await sendToExtension('forwardCDPCommand', { method, params });
					return {};
				}
				break;

			case 'Target.setDiscoverTargets':
				return {};

			case 'Target.attachToTarget': {
				const targetId = (params as { targetId?: string })?.targetId;
				if (!targetId) {
					throw new Error('需要 targetId');
				}
				for (const target of connectedTargets.values()) {
					if (target.targetId === targetId) {
						return { sessionId: target.sessionId };
					}
				}
				throw new Error(`找不到 target: ${targetId}`);
			}

			case 'Target.getTargetInfo': {
				const targetId = (params as { targetId?: string })?.targetId;
				if (targetId) {
					for (const target of connectedTargets.values()) {
						if (target.targetId === targetId) {
							return { targetInfo: target.targetInfo };
						}
					}
				}
				if (sessionId) {
					const target = connectedTargets.get(sessionId);
					if (target) {
						return { targetInfo: target.targetInfo };
					}
				}
				const firstTarget = Array.from(connectedTargets.values())[0];
				return { targetInfo: firstTarget?.targetInfo };
			}

			case 'Target.getTargets':
				return {
					targetInfos: Array.from(connectedTargets.values())
						.filter((t) => t.targetInfo.type === 'page')
						.map((t) => ({ ...t.targetInfo, attached: true })),
				};

			case 'Target.createTarget':
			case 'Target.closeTarget':
				return await sendToExtension('forwardCDPCommand', { method, params });
		}

		// 浏览器级命令（无 sessionId）扩展无法路由，直接返回成功避免「找不到会话 undefined」
		if (!sessionId && typeof method === 'string' && method.startsWith('Browser.')) {
			return {};
		}

		// 转发其他命令给扩展
		return await sendToExtension('forwardCDPCommand', { sessionId, method, params });
	}

	// ========== HTTP 服务器 ==========

	const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url || '/', `http://${host}:${port}`);
		const pathname = url.pathname;

		// CORS
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		// 健康检查
		if (pathname === '/' || pathname === '/health') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('OK');
			return;
		}

		// 扩展状态
		if (pathname === '/extension/status') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					connected: extensionWs !== null,
					activeTargets: connectedTargets.size,
				})
			);
			return;
		}

		// 发送通知（通过扩展）
		if (pathname === '/notify' && req.method === 'POST') {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk.toString();
			});
			req.on('end', async () => {
				try {
					const { title, message } = JSON.parse(body) as { title?: string; message?: string };
					if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
						res.writeHead(503, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: false, error: '扩展未连接' }));
						return;
					}
					
					const result = await sendToExtension('showNotification', { title, message });
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: true, result }));
				} catch (error) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: false, error: (error as Error).message }));
				}
			});
			return;
		}

		// CDP 发现端点
		if (pathname === '/json/version' || pathname === '/json/version/') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					Browser: 'NutBot/1.0.0',
					'Protocol-Version': '1.3',
					webSocketDebuggerUrl: `ws://${host}:${port}/cdp`,
				})
			);
			return;
		}

		if (pathname === '/json' || pathname === '/json/' || pathname === '/json/list' || pathname === '/json/list/') {
			const targets = Array.from(connectedTargets.values()).map((t) => ({
				id: t.targetId,
				type: t.targetInfo.type,
				title: t.targetInfo.title,
				url: t.targetInfo.url,
				webSocketDebuggerUrl: `ws://${host}:${port}/cdp`,
			}));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(targets));
			return;
		}

		res.writeHead(404);
		res.end('Not Found');
	});

	// ========== WebSocket 服务器 ==========

	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (request, socket, head) => {
		const url = new URL(request.url || '/', `http://${host}:${port}`);
		const pathname = url.pathname;

		wss.handleUpgrade(request, socket, head, (ws) => {
			if (pathname === '/extension') {
				handleExtensionConnection(ws);
			} else if (pathname.startsWith('/cdp')) {
				const clientId = pathname.replace('/cdp/', '').replace('/cdp', '') || 'default';
				handlePlaywrightConnection(ws, clientId);
			} else {
				ws.close(1000, 'Unknown path');
			}
		});
	});

	// ========== 扩展连接处理 ==========

	function handleExtensionConnection(ws: WebSocket): void {
		if (extensionWs) {
			if (connectedTargets.size > 0) {
				logger.warn('拒绝新扩展连接 - 已有活动标签页');
				ws.close(4002, 'Extension Already In Use');
				return;
			}
			logger.info('替换空闲扩展连接');
			extensionWs.close(4001, 'Extension Replaced');
			pendingRequests.clear();
		}

		extensionWs = ws;
		startExtensionPing();
		logger.info('扩展已连接');

		ws.on('message', (data) => {
			let message: ExtensionMessage;
			try {
				message = JSON.parse(data.toString());
			} catch {
				return;
			}

			// 处理响应
			if (message.id !== undefined) {
				const pending = pendingRequests.get(message.id);
				if (pending) {
					pendingRequests.delete(message.id);
					if (message.error) {
						pending.reject(new Error(message.error));
					} else {
						pending.resolve(message.result);
					}
				}
				return;
			}

			// 处理 pong
			if (message.method === 'pong') {
				return;
			}

			// 处理日志（保持 this 绑定）
			if (message.method === 'log') {
				const { level, args } = message.params as { level: string; args: string[] };
				const logFn = (logger as Record<string, (...args: unknown[]) => void>)[level] || logger.info;
				if (typeof logFn === 'function') {
					logFn.call(logger, '[扩展]', ...args);
				}
				return;
			}

			// 处理 CDP 事件转发
			if (message.method === 'forwardCDPEvent') {
				const eventParams = message.params as { method: string; sessionId?: string; params?: unknown };
				handleCDPEvent(eventParams);
			}
		});

		ws.on('close', () => {
			logger.info('扩展已断开');
			stopExtensionPing();
			extensionWs = null;
			connectedTargets.clear();
			pendingRequests.clear();

			// 关闭所有 Playwright 客户端
			for (const client of playwrightClients.values()) {
				client.ws.close(1000, 'Extension disconnected');
			}
			playwrightClients.clear();
		});

		ws.on('error', (error) => {
			logger.error('扩展 WebSocket 错误:', error);
		});
	}

	// ========== CDP 事件处理 ==========

	function handleCDPEvent(event: { method: string; sessionId?: string; params?: unknown }): void {
		const { method, sessionId, params } = event;

		// 跟踪 Target.attachedToTarget
		if (method === 'Target.attachedToTarget') {
			const p = params as { sessionId: string; targetInfo: TargetInfo };
			if (p.sessionId && p.targetInfo) {
				// 过滤非页面 target
				if (p.targetInfo.type !== 'page' && p.targetInfo.type !== 'iframe') {
					return;
				}
				connectedTargets.set(p.sessionId, {
					sessionId: p.sessionId,
					targetId: p.targetInfo.targetId,
					targetInfo: p.targetInfo,
				});
				const urlOrId =
					p.targetInfo.url && p.targetInfo.url !== 'about:blank'
						? p.targetInfo.url
						: `${p.targetInfo.type || 'page'}/${p.targetInfo.targetId || p.sessionId}`;
				logger.info(`Target 已附加: ${urlOrId}`);
			}
		}

		// 跟踪 Target.detachedFromTarget
		if (method === 'Target.detachedFromTarget') {
			const p = params as { sessionId: string };
			if (p.sessionId) {
				const target = connectedTargets.get(p.sessionId);
				if (target) {
					const desc =
						target.targetInfo.url && target.targetInfo.url !== 'about:blank'
							? target.targetInfo.url
							: target.targetId || p.sessionId;
					logger.info(`Target 已分离: ${desc}`);
				}
				connectedTargets.delete(p.sessionId);
			}
		}

		// 跟踪 Target.targetInfoChanged
		if (method === 'Target.targetInfoChanged') {
			const p = params as { targetInfo: TargetInfo };
			for (const target of connectedTargets.values()) {
				if (target.targetId === p.targetInfo.targetId) {
					target.targetInfo = p.targetInfo;
					break;
				}
			}
		}

		// 转发给 Playwright 客户端
		sendToPlaywright({ method, sessionId, params });
	}

	// ========== Playwright 连接处理 ==========

	function handlePlaywrightConnection(ws: WebSocket, clientId: string): void {
		if (playwrightClients.has(clientId)) {
			logger.warn(`拒绝重复客户端 ID: ${clientId}`);
			ws.close(1000, 'Client ID already connected');
			return;
		}

		playwrightClients.set(clientId, { id: clientId, ws });
		logger.info(`Playwright 客户端已连接: ${clientId} (共 ${playwrightClients.size} 个)`);

		// 顺序处理消息，避免 createInitialTab 未完成时处理 Browser.setDownloadBehavior 等导致「找不到会话 undefined」
		let lastProcess = Promise.resolve<void>(undefined);

		ws.on('message', (data) => {
			lastProcess = lastProcess
				.then(async () => {
					let command: CDPCommand;
					try {
						command = JSON.parse(data.toString());
					} catch {
						return;
					}

					const { id, method, sessionId } = command;

					if (!extensionWs) {
						sendToPlaywright({ id, error: { message: '扩展未连接' }, sessionId }, clientId);
						return;
					}

					try {
						const result = await routeCDPCommand(command);

						// 对 Target.setAutoAttach 响应后，发送已连接的 targets
						if (method === 'Target.setAutoAttach' && !sessionId) {
							for (const target of connectedTargets.values()) {
								sendToPlaywright(
									{
										method: 'Target.attachedToTarget',
										params: {
											sessionId: target.sessionId,
											targetInfo: { ...target.targetInfo, attached: true },
											waitingForDebugger: false,
										},
									},
									clientId
								);
							}
						}

						sendToPlaywright({ id, result, sessionId }, clientId);
					} catch (error) {
						sendToPlaywright(
							{
								id,
								error: { message: error instanceof Error ? error.message : String(error) },
								sessionId,
							},
							clientId
						);
					}
				})
				.catch((err) => {
					logger.error(`Playwright 消息处理异常 [${clientId}]:`, err);
				});
		});

		ws.on('close', () => {
			playwrightClients.delete(clientId);
			logger.info(`Playwright 客户端已断开: ${clientId} (剩余 ${playwrightClients.size} 个)`);
		});

		ws.on('error', (error) => {
			logger.error(`Playwright 客户端 ${clientId} 错误:`, error);
		});
	}

	// ========== 启动服务器 ==========

	await new Promise<void>((resolve) => {
		httpServer.listen(port, host, () => {
			logger.info(`CDP Relay 服务器已启动: http://${host}:${port}`);
			logger.info(`扩展端点: ws://${host}:${port}/extension`);
			logger.info(`CDP 端点: ws://${host}:${port}/cdp`);
			resolve();
		});
	});

	return {
		close() {
			stopExtensionPing();
			extensionWs?.close(1000, 'Server stopped');
			for (const client of playwrightClients.values()) {
				client.ws.close(1000, 'Server stopped');
			}
			wss.close();
			httpServer.close();
		},
		getPort() {
			return port;
		},
		isExtensionConnected() {
			return extensionWs !== null;
		},
		getConnectedTargets() {
			return connectedTargets;
		},
	};
}
