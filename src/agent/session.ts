/**
 * Session 管理
 * 管理对话会话和历史记录
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';
import type { ConfigManager } from '../utils/config.js';
import type { ChatMessage, Session, ContentBlock } from '../types/index.js';

interface SessionOptions {
	id?: string;
	title?: string;
	context?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

interface StoredSession extends Session {
	context?: Record<string, unknown>;
}

interface MessageInput {
	id?: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | ContentBlock[]; // 支持多模态内容
	toolCalls?: Array<{
		id: string;
		type: string;
		function: { name: string; arguments: string };
	}>;
	toolResults?: unknown[];
	metadata?: Record<string, unknown>;
}

interface StoredMessage extends MessageInput {
	timestamp: string;
}

/**
 * Session 管理器
 */
export class SessionManager {
	private config: ConfigManager;
	private sessions: Map<string, StoredSession> = new Map();
	private sessionsDir: string = '';
	private logger = logger.child('SessionManager');

	constructor(config: ConfigManager) {
		this.config = config;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		this.sessionsDir = this.config.get<string>('data.sessions', './data/sessions');

		// 确保目录存在
		await fs.mkdir(this.sessionsDir, { recursive: true }).catch(() => {});

		// 加载已有会话
		await this.loadSessions();

		this.logger.info(`已加载 ${this.sessions.size} 个会话`);
	}

	/**
	 * 加载已保存的会话
	 */
	private async loadSessions(): Promise<void> {
		try {
			const files = await fs.readdir(this.sessionsDir);

			for (const file of files) {
				if (!file.endsWith('.json')) continue;

				try {
					const filePath = join(this.sessionsDir, file);
					const content = await fs.readFile(filePath, 'utf-8');
					const session = JSON.parse(content) as StoredSession;
					this.sessions.set(session.id, session);
				} catch (error) {
					this.logger.warn(`加载会话失败: ${file}`, (error as Error).message);
				}
			}
		} catch (error) {
			this.logger.warn('加载会话列表失败:', (error as Error).message);
		}
	}

	/**
	 * 创建新会话
	 */
	createSession(options: SessionOptions = {}): StoredSession {
		const session: StoredSession = {
			id: options.id || generateId('session'),
			title: options.title || 'New Chat',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			messages: [],
			context: options.context || {},
			metadata: options.metadata || {},
		};

		this.sessions.set(session.id, session);
		this.saveSession(session);

		this.logger.debug(`创建会话: ${session.id}`);

		return session;
	}

	/**
	 * 获取会话
	 */
	getSession(id: string): StoredSession | undefined {
		return this.sessions.get(id);
	}

	/**
	 * 获取或创建会话
	 */
	getOrCreateSession(id: string): StoredSession {
		let session = this.sessions.get(id);
		if (!session) {
			session = this.createSession({ id });
		}
		return session;
	}

	/**
	 * 更新会话
	 */
	updateSession(id: string, updates: Partial<StoredSession>): StoredSession {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		Object.assign(session, updates, {
			updatedAt: new Date().toISOString(),
		});

		this.saveSession(session);
		return session;
	}

	/**
	 * 添加消息到会话
	 */
	addMessage(sessionId: string, message: MessageInput): StoredMessage {
		const session = this.getOrCreateSession(sessionId);

		const msg: StoredMessage = {
			id: message.id || generateId('msg'),
			role: message.role,
			content: message.content,
			timestamp: new Date().toISOString(),
			metadata: message.metadata || {},
		};

		// 添加工具调用信息
		if (message.toolCalls) {
			msg.toolCalls = message.toolCalls;
		}
		if (message.toolResults) {
			msg.toolResults = message.toolResults;
		}

		(session.messages as StoredMessage[]).push(msg);
		session.updatedAt = new Date().toISOString();

		// 更新标题（如果是第一条用户消息）
		if (session.messages.length === 1 && message.role === 'user') {
			session.title = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
		}

		this.saveSession(session);
		return msg;
	}

	/**
	 * 获取会话历史
	 */
	getHistory(sessionId: string, options: { limit?: number; includeTools?: boolean } = {}): StoredMessage[] {
		const session = this.sessions.get(sessionId);
		if (!session) return [];

		const { limit, includeTools = false } = options;
		let messages = session.messages as StoredMessage[];

		// 过滤工具消息
		if (!includeTools) {
			messages = messages.filter((m) => m.role !== 'tool');
		}

		// 限制数量
		if (limit) {
			messages = messages.slice(-limit);
		}

		return messages;
	}

	/**
	 * 获取用于 AI 的消息格式
	 * 确保 tool 消息总是紧跟在对应的 assistant (tool_calls) 消息之后
	 */
	getMessagesForAI(sessionId: string, options: { maxMessages?: number; systemPrompt?: string } = {}): ChatMessage[] {
		const { maxMessages = 30, systemPrompt } = options;
		const session = this.sessions.get(sessionId);

		if (!session) return [];

		const messages: ChatMessage[] = [];

		// 添加系统提示
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}

		// 获取所有消息
		const allMessages = session.messages as StoredMessage[];

		// 智能截断：从后往前找到一个安全的截断点
		// 安全截断点：user 消息之前（不能截断 assistant+tool 的组合）
		let startIndex = Math.max(0, allMessages.length - maxMessages);

		// 确保不会从 tool 消息或带 toolCalls 的 assistant 消息开始
		while (startIndex < allMessages.length) {
			const msg = allMessages[startIndex];
			// 如果是 tool 消息，继续往前找
			if (msg.role === 'tool') {
				startIndex--;
				if (startIndex < 0) startIndex = 0;
				continue;
			}
			// 如果找到 user 消息，这是安全的起点
			if (msg.role === 'user') {
				break;
			}
			// 如果是 assistant 消息且有 toolCalls，往前找到 user
			if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
				startIndex--;
				if (startIndex < 0) startIndex = 0;
				continue;
			}
			break;
		}

		// 构建消息数组
		const history = allMessages.slice(startIndex);

		for (const msg of history) {
			if (msg.role === 'user') {
				messages.push({
					role: 'user',
					content: msg.content,
				});
			} else if (msg.role === 'assistant') {
				const aiMsg: ChatMessage = {
					role: 'assistant',
					content: (typeof msg.content === 'string' ? msg.content : '') || '',
				};

				// 添加工具调用（OpenAI 格式）
				if (msg.toolCalls && msg.toolCalls.length > 0) {
					aiMsg.tool_calls = msg.toolCalls;
				}

				messages.push(aiMsg);
			} else if (msg.role === 'tool') {
				// OpenAI API 要求 tool 消息必须有 tool_call_id
				const toolCallId = (msg.metadata?.toolCallId as string) || '';
				const isMultimodal = msg.metadata?.isMultimodal === true;

				if (toolCallId) {
					// 多模态内容：需要创建一个特殊的用户消息来包含图片
					// 因为 OpenAI 的 tool 消息不支持多模态，我们需要变通处理
					if (isMultimodal && Array.isArray(msg.content)) {
						// 先添加工具返回（只包含文本部分）
						const textContent = msg.content.find((c) => c.type === 'text');
						messages.push({
							role: 'tool',
							content: textContent?.text || '截图完成',
							tool_call_id: toolCallId,
						});

						// 再添加一个用户消息来展示图片
						const imageContent = msg.content.find((c) => c.type === 'image_url');
						if (imageContent) {
							messages.push({
								role: 'user',
								content: [{ type: 'text', text: '[截图内容如下，请分析]' }, imageContent],
							});
						}
					} else {
						// 普通文本内容
						messages.push({
							role: 'tool',
							content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
							tool_call_id: toolCallId,
						});
					}
				}
			}
		}

		return messages;
	}

	/**
	 * 删除会话
	 */
	async deleteSession(id: string): Promise<void> {
		this.sessions.delete(id);

		try {
			const filePath = join(this.sessionsDir, `${id}.json`);
			await fs.unlink(filePath);
		} catch {
			// 文件可能不存在
		}

		this.logger.debug(`删除会话: ${id}`);
	}

	/**
	 * 列出所有会话
	 */
	listSessions(): Array<{
		id: string;
		title: string;
		createdAt: string;
		updatedAt: string;
		messageCount: number;
	}> {
		return Array.from(this.sessions.values())
			.map((s) => ({
				id: s.id,
				title: s.title,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				messageCount: s.messages.length,
			}))
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	}

	/**
	 * 保存会话到文件
	 */
	private async saveSession(session: StoredSession): Promise<void> {
		try {
			const filePath = join(this.sessionsDir, `${session.id}.json`);
			await fs.writeFile(filePath, JSON.stringify(session, null, 2));
		} catch (error) {
			this.logger.warn(`保存会话失败: ${session.id}`, (error as Error).message);
		}
	}

	/**
	 * 清理旧会话
	 */
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

		if (cleaned > 0) {
			this.logger.info(`清理了 ${cleaned} 个过期会话`);
		}

		return cleaned;
	}
}

export default SessionManager;
