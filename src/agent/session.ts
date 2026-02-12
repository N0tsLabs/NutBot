/**
 * Session 管理 - 简化版
 * 
 * 核心改进：
 * 1. 简化消息压缩逻辑
 * 2. 保持最近 N 轮完整上下文
 * 3. 跟踪浏览器上下文
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';
import type { ConfigManager } from '../utils/config.js';
import type { ChatMessage, ContentBlock } from '../types/index.js';

interface SessionOptions {
	id?: string;
	title?: string;
	context?: Record<string, unknown>;
}

interface StoredSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: StoredMessage[];
	context?: Record<string, unknown>;
}

interface MessageInput {
	id?: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | ContentBlock[];
	toolCalls?: unknown[];
	toolCallId?: string;  // 工具调用 ID
	metadata?: Record<string, unknown>;
}

interface StoredMessage extends MessageInput {
	timestamp: string;
}

export class SessionManager {
	private config: ConfigManager;
	private sessions: Map<string, StoredSession> = new Map();
	private sessionsDir: string = '';

	constructor(config: ConfigManager) {
		this.config = config;
	}

	async init(): Promise<void> {
		this.sessionsDir = this.config.get<string>('data.sessions', './data/sessions');
		await fs.mkdir(this.sessionsDir, { recursive: true }).catch(() => {});

		// 如果已经加载过（内存中有），不重复加载
		if (this.sessions.size > 0) {
			this.logger.info(`会话已存在: ${this.sessions.size} 个，跳过加载`);
			return;
		}

		await this.loadSessions();
		this.logger.info(`已加载 ${this.sessions.size} 个会话`);
	}

	private async loadSessions(): Promise<void> {
		try {
			const files = await fs.readdir(this.sessionsDir);
			let loaded = 0;

			for (const file of files) {
				if (!file.endsWith('.json')) continue;

				const filePath = join(this.sessionsDir, file);
				try {
					const content = await fs.readFile(filePath, 'utf-8');
					if (!content.trim()) {
						await fs.unlink(filePath);
						continue;
					}

					const session = JSON.parse(content) as StoredSession;
					if (!session.id || !session.title) {
						await fs.unlink(filePath);
						continue;
					}

					this.sessions.set(session.id, session);
					loaded++;
				} catch {
					/* 忽略损坏的文件 */
				}
			}

			this.logger.info(`[loadSessions] 加载完成: ${loaded} 个会话`);
		} catch (error) {
			this.logger.warn('加载会话失败:', error);
		}
	}

	createSession(options: SessionOptions = {}): StoredSession {
		const session: StoredSession = {
			id: options.id || generateId('session'),
			title: options.title || 'New Chat',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			messages: [],
			context: options.context || {},
		};

		this.sessions.set(session.id, session);
		this.saveSession(session);
		this.logger.debug(`创建会话: ${session.id}`);

		return session;
	}

	getSession(id: string): StoredSession | undefined {
		return this.sessions.get(id);
	}

	getOrCreateSession(id: string): StoredSession {
		let session = this.sessions.get(id);
		if (!session) session = this.createSession({ id });
		return session;
	}

	updateSession(id: string, updates: Partial<StoredSession>): StoredSession {
		const session = this.sessions.get(id);
		if (!session) throw new Error(`Session not found: ${id}`);

		Object.assign(session, updates, { updatedAt: new Date().toISOString() });
		this.saveSession(session);
		return session;
	}

	/**
	 * 设置浏览器上下文
	 */
	setBrowserContext(sessionId: string, context: { url?: string; title?: string }): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		if (!session.context) session.context = {};
		session.context.browser = {
			...context,
			timestamp: new Date().toISOString(),
		};
		this.saveSession(session);
	}

	/**
	 * 获取浏览器上下文
	 */
	getBrowserContext(sessionId: string): { url?: string; title?: string; timestamp?: string } | undefined {
		const session = this.sessions.get(sessionId);
		return session?.context?.browser as { url?: string; title?: string; timestamp?: string } | undefined;
	}

	addMessage(sessionId: string, message: MessageInput): StoredMessage {
		const session = this.getOrCreateSession(sessionId);

		const msg: StoredMessage = {
			id: message.id || generateId('msg'),
			role: message.role,
			content: message.content,
			timestamp: new Date().toISOString(),
			metadata: message.metadata || {},
		};

		if (message.toolCalls !== undefined) msg.toolCalls = message.toolCalls;
		// 保存 tool_call_id 到 metadata
		if (message.toolCallId && message.role === 'tool') {
			msg.metadata.toolCallId = message.toolCallId;
		}

		session.messages.push(msg);
		session.updatedAt = new Date().toISOString();

		// 更新标题（第一条用户消息）
		if (session.messages.length === 1 && message.role === 'user') {
			const content = typeof message.content === 'string' 
				? message.content 
				: message.content.map(c => typeof c === 'string' ? c : c.text || '').join('');
			session.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
		}

		this.saveSession(session);
		return msg;
	}

	/**
	 * 获取用于 AI 的消息格式 - 简化版
	 * 保留最近 N 轮完整上下文
	 */
	getMessagesForAI(sessionId: string, options: { maxMessages?: number; systemPrompt?: string } = {}): ChatMessage[] {
		const { maxMessages = 30, systemPrompt } = options;
		const session = this.sessions.get(sessionId);

		if (!session) {
			this.logger.warn(`[getMessagesForAI] Session not found: ${sessionId}`);
			return [];
		}

		this.logger.info(`[getMessagesForAI] sessionId=${sessionId}, messages=${session.messages.length}`);

		const messages: ChatMessage[] = [];

		// 添加系统提示
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}

		const allMessages = session.messages as StoredMessage[];

		// 简化：直接取最近 N 条消息
		// 核心规则：确保完整的 tool 调用链 (assistant(with tool_calls) -> tool)
		let startIndex = Math.max(0, allMessages.length - maxMessages);

		this.logger.debug(`[getMessagesForAI] allMessages=${allMessages.length}, startIndex=${startIndex}`);

		// 从后往前检查：如果最后几条消息不完整，往前找到完整的链
		// 限制最大检查次数，防止死循环
		const maxCheckCount = maxMessages + 10;
		let checkCount = 0;

		while (startIndex < allMessages.length && checkCount < maxCheckCount) {
			checkCount++;
			const msg = allMessages[startIndex];

			if (!msg) {
				// 空消息，直接跳过
				startIndex--;
				continue;
			}

			const role = msg.role || 'unknown';
			this.logger.debug(`[getMessagesForAI] 检查 msg[${startIndex}], role=${role}`);

			if (role === 'tool') {
				// tool 消息需要前面的 assistant（包含 tool_calls）
				if (startIndex === 0) {
					// 第一个消息就是 tool，无法处理
					break;
				}
				const prevMsg = allMessages[startIndex - 1];
				if (!prevMsg) {
					// 前一条消息不存在，往前找
					startIndex--;
					continue;
				}
				if (prevMsg.role === 'assistant' && prevMsg.toolCalls && prevMsg.toolCalls.length > 0) {
					// 找到完整的链：从 assistant 开始
					break;
				} else {
					// 前一个不是带 tool_calls 的 assistant，往前找
					startIndex--;
				}
			} else if (role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
				// 带 tool_calls 的 assistant 是链的开始，保留
				break;
			} else if (role === 'user') {
				// user 消息是新的开始，保留（同时保留前面的 assistant+tool 链）
				// 继续检查前面是否有完整的链需要保留
				if (startIndex > 0) {
					// 检查 startIndex-1 是否是带 tool_calls 的 assistant
					const prevMsg = allMessages[startIndex - 1];
					if (prevMsg?.role === 'assistant' && prevMsg.toolCalls && prevMsg.toolCalls.length > 0) {
						// 保留完整的链，从这个 assistant 开始
						startIndex--;
					}
				}
				break;
			} else {
				// 普通消息或带空 tool_calls 的 assistant，往前找
				startIndex--;
			}
		}

		const history = allMessages.slice(startIndex);
		this.logger.info(`[getMessagesForAI] history.length=${history.length}, startIndex=${startIndex}`);

		// 构建消息数组（保留完整的消息顺序）
		const formattedMessages: any[] = [];

		for (let i = 0; i < history.length; i++) {
			const msg = history[i];
			if (!msg) {
				this.logger.warn(`[getMessagesForAI] history[${i}] is undefined!`);
				continue;
			}

			const msgRole = msg.role || 'unknown';
			if (msgRole === 'user') {
				formattedMessages.push({ role: 'user', content: msg.content });
			} else if (msgRole === 'assistant') {
				const aiMsg: ChatMessage = { role: 'assistant', content: msg.content as string || '' };
				// 总是添加 tool_calls（即使为空数组也需要保留给 OpenAI 验证）
				if (msg.toolCalls !== undefined) {
					aiMsg.tool_calls = msg.toolCalls;
				}
				formattedMessages.push(aiMsg);
			} else if (msgRole === 'tool') {
				const toolName = msg.metadata?.toolName as string || 'unknown';
				// 使用 ?? 而不是 ||，确保只有真正没有值时才生成默认 ID
				const toolCallId = (msg.metadata?.toolCallId as string) ?? `call_${toolName}_${Date.now()}`;
				const isMultimodal = msg.metadata?.isMultimodal === true;

				// 优先使用 aiContext（给 AI 看完整信息），否则用 content（给用户看）
				const aiContent = msg.metadata?.aiContext;
				const displayContent = typeof msg.content === 'string' ? msg.content : '操作完成';

				if (aiContent !== undefined) {
					// 有 AI 上下文，使用它
					if (isMultimodal && Array.isArray(aiContent)) {
						const textContent = aiContent.find((c: any) => c.type === 'text');
						formattedMessages.push({
							role: 'tool',
							content: textContent?.text || displayContent,
							tool_call_id: toolCallId,
						});
					} else if (typeof aiContent === 'string') {
						formattedMessages.push({
							role: 'tool',
							content: aiContent,
							tool_call_id: toolCallId,
						});
					} else {
						formattedMessages.push({
							role: 'tool',
							content: typeof aiContent === 'string' ? aiContent : JSON.stringify(aiContent),
							tool_call_id: toolCallId,
						});
					}
				} else {
					// 没有 AI 上下文，使用显示内容
					if (isMultimodal && Array.isArray(msg.content)) {
						const textContent = (msg.content as any[]).find((c: any) => c.type === 'text');
						formattedMessages.push({
							role: 'tool',
							content: textContent?.text || displayContent,
							tool_call_id: toolCallId,
						});
					} else {
						formattedMessages.push({
							role: 'tool',
							content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
							tool_call_id: toolCallId,
						});
					}
				}
			}
		}

		// 调试日志：打印发送给 API 的消息格式
		this.logger.info(`[API 消息] 共 ${formattedMessages.length} 条消息`);
		for (let i = 0; i < formattedMessages.length; i++) {
			const m = formattedMessages[i];
			if (m.tool_calls) {
				this.logger.info(`[API 消息][${i}] role: ${m.role}, tool_calls: ${JSON.stringify(m.tool_calls.map((tc: any) => ({ id: tc.id, function: tc.function?.name })))}`);
			} else if (m.tool_call_id) {
				this.logger.info(`[API 消息][${i}] role: ${m.role}, tool_call_id: ${m.tool_call_id}`);
			} else {
				this.logger.info(`[API 消息][${i}] role: ${m.role}, content: ${String(m.content)}`);
			}
		}

		return formattedMessages;
	}

	async deleteSession(id: string): Promise<void> {
		this.sessions.delete(id);
		try {
			const filePath = join(this.sessionsDir, `${id}.json`);
			await fs.unlink(filePath);
		} catch { /* 忽略 */ }
		this.logger.debug(`删除会话: ${id}`);
	}

	/**
	 * 获取会话消息历史
	 * 只返回 user 和 assistant 消息，不返回 tool 消息（tool 信息已包含在 assistant 的 toolCalls 中）
	 */
	getHistory(id: string): Array<{
		id: string;
		role: string;
		content: string;
		timestamp: string;
		toolCalls?: unknown[];
	}> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		// 只返回 user 和 assistant 消息，隐藏 tool 消息
		return session.messages
			.filter(msg => msg.role === 'user' || msg.role === 'assistant')
			.map(msg => ({
				id: msg.id,
				role: msg.role,
				content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
				timestamp: msg.timestamp,
				toolCalls: msg.toolCalls,
			}));
	}

	/**
	 * 清空所有会话
	 */
	async clearAllSessions(): Promise<void> {
		// 清空内存中的会话
		this.sessions.clear();

		// 删除会话目录下的所有文件
		try {
			const files = await fs.readdir(this.sessionsDir);
			for (const file of files) {
				if (file.endsWith('.json')) {
					try {
						await fs.unlink(join(this.sessionsDir, file));
					} catch { /* 忽略单个文件删除失败 */ }
				}
			}
		} catch { /* 忽略目录读取失败 */ }

		this.logger.info('已清空所有会话');
	}

	listSessions(): Array<{ id: string; title: string; createdAt: string; updatedAt: string; messageCount: number }> {
		return Array.from(this.sessions.values())
			.map(s => ({
				id: s.id,
				title: s.title,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				messageCount: s.messages.length,
			}))
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	}

	private async saveSession(session: StoredSession): Promise<void> {
		try {
			const filePath = join(this.sessionsDir, `${session.id}.json`);
			await fs.writeFile(filePath, JSON.stringify(session, null, 2));
			this.logger.debug(`[saveSession] 已保存会话 ${session.id}, 消息数: ${session.messages.length}`);
		} catch (error) {
			this.logger.warn(`保存会话失败: ${session.id}`, error);
		}
	}

	async cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000): Promise<number> {
		const now = Date.now();
		let cleaned = 0;

		for (const [id, session] of this.sessions.entries()) {
			const updatedAt = new Date(session.updatedAt).getTime();
			if (now - updatedAt > maxAge) {
				await this.deleteSession(id);
				cleaned++;
			}
		}

		if (cleaned > 0) this.logger.info(`清理了 ${cleaned} 个过期会话`);
		return cleaned;
	}

	private get logger() {
		return logger.child('SessionManager');
	}
}

export default SessionManager;
