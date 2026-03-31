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
	metadata?: Record<string, unknown>;
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

/**
 * 消息总结接口
 */
interface MessageSummary {
	id: string;
	createdAt: string;
	summary: string;
	messageRange: { start: number; end: number }; // 总结覆盖的消息范围
	toolCallsSummary?: string; // 工具调用总结
}

export class SessionManager {
	private config: ConfigManager;
	private sessions: Map<string, StoredSession> = new Map();
	private sessionsDir: string = '';
	private summaries: Map<string, MessageSummary[]> = new Map(); // sessionId -> summaries

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

	/**
	 * 强制重新加载所有会话（从文件系统）
	 * 用于当内存中找不到会话时，尝试从文件重新加载
	 */
	async forceReloadSessions(): Promise<void> {
		this.logger.info('[forceReloadSessions] 强制重新加载会话...');
		// 清空当前内存中的会话，重新加载
		const previousCount = this.sessions.size;
		this.sessions.clear();
		await this.loadSessions();
		this.logger.info(`[forceReloadSessions] 重新加载完成: ${previousCount} -> ${this.sessions.size} 个会话`);
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
		if (!session) {
			// 如果会话不存在，先尝试从文件系统重新加载
			this.logger.warn(`[getOrCreateSession] 内存中未找到会话 ${id}，尝试重新加载...`);
			// 重新加载所有会话
			this.loadSessions().catch(() => {});
			// 再次检查
			session = this.sessions.get(id);
			if (!session) {
				// 仍然找不到，创建新会话
				this.logger.warn(`[getOrCreateSession] 会话 ${id} 不存在，创建新会话`);
				session = this.createSession({ id });
			}
		}
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
			msg.metadata = msg.metadata || {};
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
	 * 更新最后一条 assistant 消息的内容（用于添加 AI 总结）
	 */
	updateLastAssistantContent(sessionId: string, content: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		// 从后往前找最后一条 assistant 消息
		for (let i = session.messages.length - 1; i >= 0; i--) {
			if (session.messages[i].role === 'assistant') {
				session.messages[i].content = content;
				session.updatedAt = new Date().toISOString();
				this.saveSession(session);
				this.logger.debug(`更新 assistant 消息内容成功`);
				return;
			}
		}
		this.logger.warn(`未找到 assistant 消息`);
	}

	/**
	 * 添加 toolCall 到 assistant 消息
	 */
	addToolCall(
		sessionId: string,
		toolCall: { id: string; name: string; arguments: unknown; status: string }
	): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		// 从后往前找最近的 assistant 消息
		for (let i = session.messages.length - 1; i >= 0; i--) {
			const msg = session.messages[i];
			if (msg.role === 'assistant') {
				if (!msg.toolCalls) msg.toolCalls = [];
				msg.toolCalls.push(toolCall);
				this.saveSession(session);
				this.logger.debug(`添加 toolCall ${toolCall.id} 成功`);
				return;
			}
		}
		this.logger.warn(`未找到 assistant 消息来添加 toolCall`);
	}

	/**
	 * 更新指定消息的内容
	 * 用于在总结阶段更新 assistant 消息，而不是创建新消息
	 */
	async updateMessage(
		sessionId: string,
		messageId: string,
		updates: { content?: string; metadata?: Record<string, unknown> }
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		const message = session.messages.find((m) => m.id === messageId);
		if (message) {
			if (updates.content !== undefined) {
				message.content = updates.content;
			}
			if (updates.metadata !== undefined) {
				message.metadata = { ...message.metadata, ...updates.metadata };
			}
			await this.saveSession(session);
			this.logger.debug(`更新消息 ${messageId} 成功`);
		} else {
			this.logger.warn(`未找到消息: ${messageId}`);
		}
	}

	/**
	 * 向现有 assistant 消息追加 toolCalls
	 * 用于在同一轮次中追加新的工具调用
	 */
	appendToolCalls(
		sessionId: string,
		messageId: string,
		toolCalls: unknown[]
	): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		const message = session.messages.find((m) => m.id === messageId);
		if (message && message.role === 'assistant') {
			if (!message.toolCalls) {
				message.toolCalls = [];
			}
			(message.toolCalls as unknown[]).push(...toolCalls);
			this.saveSession(session);
			this.logger.debug(`向消息 ${messageId} 追加 ${toolCalls.length} 个 toolCalls`);
		} else {
			this.logger.warn(`未找到 assistant 消息: ${messageId}`);
		}
	}

	/**
	 * 更新 assistant 消息中的 toolCall，添加执行结果
	 * 用于在 tool 执行完成后，将结果同步到 assistant 消息中
	 */
	updateToolCallResult(
		sessionId: string,
		toolCallId: string,
		result: { success?: boolean; error?: string; [key: string]: unknown }
	): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		// 从后往前找最近的带 toolCalls 的 assistant 消息
		for (let i = session.messages.length - 1; i >= 0; i--) {
			const msg = session.messages[i];
			if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
				// 找到对应的 toolCall
				for (const tc of msg.toolCalls as any[]) {
					if (tc.id === toolCallId) {
						// 添加 status 和 result
						(tc as any).status = result.success === false ? 'error' : 'success';
						(tc as any).result = result;
						this.saveSession(session);
						this.logger.debug(`更新 toolCall ${toolCallId} 结果成功`);
						return;
					}
				}
			}
		}
		this.logger.warn(`未找到对应的 assistant 消息: ${toolCallId}`);
	}

	/**
	 * 获取用于 AI 的消息格式 - 智能压缩版
	 * 
	 * 核心改进：
	 * 1. 不暴力截断 - 正常对话不会被截断
	 * 2. 智能压缩 - 只有当真正超出上下文时，才让 AI 压缩之前的对话
	 * 3. 保持连续性 - 确保消息列表中始终有完整的对话流程
	 * 4. 迭代总结 - 将之前的总结传递给下一次 AI 调用
	 */
	getMessagesForAI(
		sessionId: string,
		options: {
			maxTokens?: number;
			systemPrompt?: string;
			preserveRecentRounds?: number; // 保留最近 N 轮完整对话
		} = {}
	): ChatMessage[] {
		const { maxTokens = 60000, systemPrompt, preserveRecentRounds = 6 } = options;
		const session = this.sessions.get(sessionId);

		if (!session) {
			this.logger.warn(`[getMessagesForAI] Session not found: ${sessionId}`);
			return [];
		}

		this.logger.debug(`[getMessagesForAI] sessionId=${sessionId}, messages=${session.messages.length}`);

		const messages: ChatMessage[] = [];

		// 添加系统提示
		if (systemPrompt) {
			messages.push({ role: 'system', content: systemPrompt });
		}

		const allMessages = session.messages as StoredMessage[];

		// 如果消息数量较少，直接返回所有消息
		if (allMessages.length <= preserveRecentRounds * 3) {
			// 估算 token 数量
			const estimatedTokens = this.estimateTokens(allMessages);
			if (estimatedTokens <= maxTokens * 0.8) {
				this.logger.debug(`[getMessagesForAI] 消息数量较少(${allMessages.length})且 token 估算(${estimatedTokens})在限制内，返回全部消息`);
				const formatted = this.formatMessages(allMessages);
				return [...messages, ...formatted];
			}
		}

		// 智能压缩策略：
		// 1. 保留最近 N 轮完整对话（user -> assistant -> tool）
		// 2. 对更早的消息进行智能压缩/总结
		const recentMessages = this.extractRecentRounds(allMessages, preserveRecentRounds);
		const recentStartIndex = allMessages.length - recentMessages.length;

		// 获取该会话的总结历史
		const sessionSummaries = this.summaries.get(sessionId) || [];

		// 如果有之前的总结，并且需要压缩的消息范围与总结匹配
		let compressedMessages: ChatMessage[] = [];
		let hasValidSummary = false;

		if (sessionSummaries.length > 0 && recentStartIndex > 0) {
			const latestSummary = sessionSummaries[sessionSummaries.length - 1];
			// 检查总结是否覆盖了我们想要跳过的消息
			if (latestSummary.messageRange.end >= recentStartIndex - 1) {
				// 使用总结作为上下文
				compressedMessages.push({
					role: 'user',
					content: `[历史对话总结]\n${latestSummary.summary}`,
				});
				hasValidSummary = true;
				this.logger.debug(`[getMessagesForAI] 使用历史总结覆盖消息 0-${latestSummary.messageRange.end}`);
			}
		}

		// 如果没有有效总结，或者总结不覆盖需要跳过的消息
		if (!hasValidSummary && recentStartIndex > 0) {
			// 保留最早的一条 user 消息作为对话起点
			const firstUserMsg = allMessages.find(m => m.role === 'user');
			if (firstUserMsg && recentStartIndex > 1) {
				compressedMessages.push({
					role: 'user',
					content: `[对话开始] ${typeof firstUserMsg.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg.content)}`,
				});
				this.logger.debug(`[getMessagesForAI] 保留对话起点消息`);
			}
		}

		// 格式化最近的消息
		const formattedRecent = this.formatMessages(recentMessages);

		// 组合最终消息列表
		const finalMessages = [...messages, ...compressedMessages, ...formattedRecent];

		// 验证消息列表中至少有一个 user 消息
		const hasUserMessage = finalMessages.some(m => m.role === 'user');
		if (!hasUserMessage && allMessages.length > 0) {
			this.logger.error(`[getMessagesForAI] 严重错误：消息列表中没有 user 消息！`);
			// 紧急修复：添加第一条 user 消息
			const firstUser = allMessages.find(m => m.role === 'user');
			if (firstUser) {
				finalMessages.push({
					role: 'user',
					content: typeof firstUser.content === 'string' ? firstUser.content : '用户消息',
				});
			}
		}

		this.logger.debug(`[getMessagesForAI] 最终消息数: ${finalMessages.length} (压缩: ${compressedMessages.length}, 最近: ${formattedRecent.length})`);

		return finalMessages;
	}

	/**
	 * 估算消息的 token 数量（粗略估算）
	 */
	private estimateTokens(messages: StoredMessage[]): number {
		let totalChars = 0;
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				totalChars += msg.content.length;
			} else if (Array.isArray(msg.content)) {
				totalChars += msg.content.map(c => typeof c === 'string' ? c : c.text || '').join('').length;
			}
			// 工具调用也计入
			if (msg.toolCalls) {
				totalChars += JSON.stringify(msg.toolCalls).length;
			}
		}
		// 粗略估算：1 token ≈ 4 字符
		return Math.ceil(totalChars / 4);
	}

	/**
	 * 提取最近 N 轮完整对话
	 * 一轮 = user -> assistant [-> tool -> ...]
	 */
	private extractRecentRounds(allMessages: StoredMessage[], rounds: number): StoredMessage[] {
		if (allMessages.length === 0) return [];

		const result: StoredMessage[] = [];
		let roundCount = 0;
		let i = allMessages.length - 1;

		// 从后往前遍历，找到完整的轮次
		while (i >= 0 && roundCount < rounds) {
			const msg = allMessages[i];

			if (msg.role === 'user') {
				// 找到一轮的开始
				roundCount++;
				// 收集这一轮的完整消息
				const roundMessages: StoredMessage[] = [msg];
				i--;

				// 收集后续的 assistant 和 tool 消息
				while (i >= 0) {
					const nextMsg = allMessages[i];
					if (nextMsg.role === 'user') {
						// 遇到下一个 user，停止收集
						break;
					}
					roundMessages.unshift(nextMsg);
					i--;
				}

				// 验证这一轮是否完整（至少要有 assistant）
				const hasAssistant = roundMessages.some(m => m.role === 'assistant');
				if (hasAssistant) {
					result.unshift(...roundMessages);
				} else {
					// 不完整的轮次，只保留 user 消息
					result.unshift(msg);
				}
			} else {
				// 不是从 user 开始，往前找
				i--;
			}
		}

		// 如果还有剩余消息（不完整的开头），检查是否需要保留
		if (i >= 0) {
			// 检查剩余消息中是否有未配对的 tool 消息
			const remaining = allMessages.slice(0, i + 1);
			const hasOrphanTool = remaining.some(m => m.role === 'tool');
			if (hasOrphanTool) {
				this.logger.warn(`[extractRecentRounds] 发现未配对的 tool 消息，尝试修复`);
				// 尝试找到对应的 assistant 并包含进来
				for (let j = i; j >= 0; j--) {
					if (allMessages[j].role === 'assistant' && allMessages[j].toolCalls) {
						const assistantAndTools = allMessages.slice(j, i + 1);
						result.unshift(...assistantAndTools);
						break;
					}
				}
			}
		}

		return result;
	}

	/**
	 * 格式化消息为 AI 可用的格式
	 */
	private formatMessages(messages: StoredMessage[]): ChatMessage[] {
		const formattedMessages: ChatMessage[] = [];

		for (const msg of messages) {
			if (!msg) continue;

			const msgRole = msg.role || 'unknown';

			if (msgRole === 'user') {
				// 检查是否是图片消息
				if (msg.metadata?.isImageMessage && msg.metadata?.imageUrl) {
					// 多模态图片消息
					const textContent = typeof msg.content === 'string' ? msg.content : '';
					formattedMessages.push({
						role: 'user',
						content: [
							{ type: 'text', text: textContent },
							{ type: 'image_url', image_url: { url: msg.metadata.imageUrl as string } }
						]
					});
				} else {
					formattedMessages.push({ role: 'user', content: msg.content });
				}
			} else if (msgRole === 'assistant') {
				const aiMsg: ChatMessage = { role: 'assistant', content: msg.content as string || '' };
				if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
					aiMsg.tool_calls = (msg.toolCalls as any[]).map(tc => {
						const toolName = tc.name || tc.function?.name || 'unknown';
						const toolArgs = tc.arguments || tc.function?.arguments || '{}';
						return {
							id: tc.id,
							type: 'function',
							function: {
								name: toolName,
								arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs || {}),
							},
						};
					});
				}
				formattedMessages.push(aiMsg);
			} else if (msgRole === 'tool') {
				const toolName = msg.metadata?.toolName as string || 'unknown';
				const toolCallId = (msg.metadata?.toolCallId as string) ?? `call_${toolName}_${Date.now()}`;
				const isMultimodal = msg.metadata?.isMultimodal === true;
				const aiContent = msg.metadata?.aiContext;
				const displayContent = typeof msg.content === 'string' ? msg.content : '操作完成';

				if (aiContent !== undefined && isMultimodal && Array.isArray(aiContent)) {
					// 多模态内容：保留完整的 content blocks（包括图片）
					formattedMessages.push({
						role: 'tool',
						content: aiContent as ContentBlock[],
						tool_call_id: toolCallId,
					});
				} else {
					// 纯文本内容
					let content: string;
					if (aiContent !== undefined) {
						if (typeof aiContent === 'string') {
							content = aiContent;
						} else {
							content = JSON.stringify(aiContent);
						}
					} else {
						content = displayContent;
					}

					formattedMessages.push({
						role: 'tool',
						content,
						tool_call_id: toolCallId,
					});
				}
			}
		}

		return formattedMessages;
	}

	/**
	 * 创建消息总结
	 * 当上下文即将超出限制时调用，让 AI 总结之前的对话
	 */
	async createSummary(
		sessionId: string,
		startIndex: number,
		endIndex: number,
		summaryText: string
	): Promise<MessageSummary> {
		const sessionSummaries = this.summaries.get(sessionId) || [];

		const summary: MessageSummary = {
			id: generateId('summary'),
			createdAt: new Date().toISOString(),
			summary: summaryText,
			messageRange: { start: startIndex, end: endIndex },
		};

		sessionSummaries.push(summary);
		this.summaries.set(sessionId, sessionSummaries);

		this.logger.debug(`[createSummary] 创建总结 ${summary.id} 覆盖消息 ${startIndex}-${endIndex}`);

		return summary;
	}

	/**
	 * 获取会话的所有总结
	 */
	getSummaries(sessionId: string): MessageSummary[] {
		return this.summaries.get(sessionId) || [];
	}

	/**
	 * 清除会话的总结
	 */
	clearSummaries(sessionId: string): void {
		this.summaries.delete(sessionId);
		this.logger.debug(`[clearSummaries] 清除会话 ${sessionId} 的总结`);
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
	 * 返回 user 和 assistant 消息（tool 结果已嵌入到 assistant 的 toolCalls 中）
	 * 直接返回存储的扁平格式，与前端渲染一致
	 */
	getHistory(id: string): Array<{
		id: string;
		role: string;
		content: string;
		timestamp: string;
		toolCalls?: unknown[];
		toolCallId?: string;
		metadata?: Record<string, unknown>;
	}> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		// 返回 user 和 assistant 消息（tool 消息已通过 updateToolCallResult 更新到 assistant 中）
		return session.messages
			.filter(msg => msg.role === 'user' || msg.role === 'assistant')
			.map(msg => ({
				id: msg.id || '',
				role: msg.role,
				content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
				timestamp: msg.timestamp,
				toolCalls: msg.toolCalls, // 直接返回，格式与前端一致
				toolCallId: msg.metadata?.toolCallId as string | undefined,
				metadata: msg.metadata,
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
