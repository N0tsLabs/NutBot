/**
 * NutBot Agent 核心
 *
 * 设计目标：
 * 1. 支持有/无 function call 的模型
 * 2. 支持有/无 vision 的模型
 * 3. 稳定的元素引用
 * 4. 简洁的循环控制
 */

import { logger } from '../utils/logger.js';
import { generateId, safeParseJSON, getLocationByIP, type UserLocation } from '../utils/helpers.js';
import type { Gateway } from '../gateway/index.js';
import type { AgentChunk, ToolCall, ToolUse, ContentBlock } from '../types/index.js';
import { SessionManager } from './session.js';
import { securityGuard } from '../services/security-guard.js';
import { parsePromptResponse, type ParsedToolCall, generateToolCallFormatPrompt } from './prompt-parser.js';
import { loadSystemPrompt, isFirstConversation, loadCustomIdentity } from './prompt-loader.js';

interface AgentRunOptions {
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
	debugMode?: boolean;
	timeout?: number;
	temperature?: number;
	maxTokens?: number;
	tools?: {
		enabled?: string[];
		disabled?: string[];
	};
}

// 需要 Vision 能力的工具
const VISION_REQUIRED_TOOLS = ['screenshot', 'computer'];

/**
 * 检测模型能力
 */
interface ModelCapabilities {
	hasVision: boolean;
	hasFunctionCall: boolean;
	supportsThinking: boolean;
}

/**
 * 工具调用历史记录
 */
interface ToolCallRecord {
	toolName: string;
	args: Record<string, unknown>;
	timestamp: number;
}

/**
 * 重复操作检测结果
 */
interface DuplicateCheckResult {
	isDuplicate: boolean;
	count: number;
	message: string;
}

/**
 * Agent 类
 */
export class Agent {
	private gateway: Gateway;
	private logger = logger.child('Agent');
	private defaultSystemPrompt: string;
	private currentRunId: string | null = null;
	private interruptRequested = false;
	private abortController: AbortController | null = null;
	private toolCallHistory: ToolCallRecord[] = [];
	private readonly DUPLICATE_THRESHOLD = 5; // 重复操作阈值
	private readonly DUPLICATE_WINDOW = 10; // 检查最近10次操作

	constructor(gateway: Gateway) {
		this.gateway = gateway;
		this.defaultSystemPrompt = '';
	}

	/**
	 * 中断当前正在运行的任务
	 */
	interrupt(reason: string = 'user_requested'): void {
		if (this.currentRunId) {
			this.logger.info(`[Agent] 中断任务 ${this.currentRunId}: ${reason}`);
			this.interruptRequested = true;
			this.logger.info(`[Agent] interruptRequested 已设置为 true`);
			// 触发 abortController 来中断底层的 HTTP 请求
			if (this.abortController) {
				this.logger.info(`[Agent] 触发 abortController.abort()`);
				this.abortController.abort();
				this.abortController = null;
			} else {
				this.logger.warn(`[Agent] abortController 不存在，无法中止 HTTP 请求`);
			}
		} else {
			this.logger.warn(`[Agent] 没有正在运行的任务，无法中断`);
		}
	}

	/**
	 * 检查是否已请求中断
	 */
	isInterrupted(): boolean {
		return this.interruptRequested;
	}

	/**
	 * 获取当前 AbortSignal
	 */
	getAbortSignal(): AbortSignal | undefined {
		return this.abortController?.signal;
	}

	/**
	 * 记录工具调用
	 */
	private recordToolCall(toolName: string, args: Record<string, unknown>): void {
		this.toolCallHistory.push({
			toolName,
			args,
			timestamp: Date.now(),
		});

		// 只保留最近的操作记录
		if (this.toolCallHistory.length > this.DUPLICATE_WINDOW * 2) {
			this.toolCallHistory = this.toolCallHistory.slice(-this.DUPLICATE_WINDOW);
		}
	}

	/**
	 * 检查是否重复操作
	 * 如果同一个工具+参数组合在最近的 DUPLICATE_WINDOW 次操作中出现 DUPLICATE_THRESHOLD 次以上，
	 * 则判定为重复操作
	 */
	private checkDuplicateOperation(toolName: string, args: Record<string, unknown>): DuplicateCheckResult {
		// 获取最近的操作记录
		const recentCalls = this.toolCallHistory.slice(-this.DUPLICATE_WINDOW);

		// 统计相同工具+参数的出现次数
		let duplicateCount = 0;
		for (const record of recentCalls) {
			if (record.toolName === toolName && this.argsMatch(record.args, args)) {
				duplicateCount++;
			}
		}

		if (duplicateCount >= this.DUPLICATE_THRESHOLD) {
			return {
				isDuplicate: true,
				count: duplicateCount,
				message: `检测到重复操作：工具 "${toolName}" 在最近的 ${this.DUPLICATE_WINDOW} 次操作中被调用了 ${duplicateCount} 次，参数相同。这可能表示任务陷入循环或需要用户干预（如登录）。`,
			};
		}

		return {
			isDuplicate: false,
			count: duplicateCount,
			message: '',
		};
	}

	/**
	 * 比较两个参数对象是否匹配（忽略时间戳等动态字段）
	 */
	private argsMatch(args1: Record<string, unknown>, args2: Record<string, unknown>): boolean {
		// 提取关键字段进行比较
		const keyFields = ['url', 'action', 'index', 'path', 'command'];

		for (const field of keyFields) {
			const val1 = args1[field];
			const val2 = args2[field];

			// 如果字段存在且不相等，返回 false
			if (val1 !== undefined || val2 !== undefined) {
				if (val1 !== val2) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * 清除工具调用历史
	 */
	private clearToolCallHistory(): void {
		this.toolCallHistory = [];
	}

	/**
	 * 检测模型能力
	 */
	private detectModelCapabilities(modelRef: string | undefined): ModelCapabilities {
		// 默认认为现代模型支持 function call 和 vision
		const defaultCapabilities: ModelCapabilities = {
			hasVision: true,
			hasFunctionCall: true,
			supportsThinking: true,
		};

		if (!modelRef) {
			return defaultCapabilities;
		}

		// OpenAI 系列通常支持所有功能
		if (modelRef.includes('gpt-4') || modelRef.includes('gpt-3.5')) {
			return defaultCapabilities;
		}

		// Claude 通常支持所有功能
		if (modelRef.includes('claude')) {
			return defaultCapabilities;
		}

		// 检查 provider 是否支持
		const provider = this.gateway.providerManager.getProvider(modelRef);
		if (provider) {
			return {
				hasVision: provider.supportsVision?.() ?? defaultCapabilities.hasVision,
				hasFunctionCall: provider.supportsFunctionCall?.() ?? defaultCapabilities.hasFunctionCall,
				supportsThinking: provider.supportsThinking?.() ?? defaultCapabilities.supportsThinking,
			};
		}

		return defaultCapabilities;
	}

	/**
	 * 估算 token 数量（粗略估算）
	 */
	private estimateTokenCount(messages: any[], systemPrompt: string): number {
		const allText = [
			systemPrompt,
			...messages.map(msg => {
				if (typeof msg.content === 'string') {
					return msg.content;
				} else if (Array.isArray(msg.content)) {
					return msg.content.map((block: any) => 
						typeof block === 'string' ? block : block.text || ''
					).join('');
				}
				return '';
			})
		].join(' ');
		
		return Math.ceil(allText.length / 4);
	}

	/**
	 * 构建系统提示
	 * 基于 SYSTEM.md + 动态工具描述 + 运行时上下文
	 */
	private buildSystemPrompt(
		hasVision: boolean,
		toolSchemas?: { name: string; description: string }[],
		toolFormatPrompt?: string,
		browserContext?: { url?: string; title?: string },
		isFirstConversationFlag?: boolean
	): string {
		const parts: string[] = [];

		// 1. 加载 SYSTEM.md 作为基础
		parts.push(loadSystemPrompt());

		// 2. 检查是否有自定义身份
		const customIdentity = loadCustomIdentity();
		const hasIdentity = customIdentity && customIdentity.enabled;

		// 3. 如果没有身份，添加提示让 AI 主动询问
		if (!hasIdentity) {
			parts.push('---');
			parts.push(`## 身份设定

你还没有设定身份，请主动询问用户希望你怎么称呼、是什么性格、什么风格。

你可以这样说：
"你好！我是 NutBot。在开始前，你想让我以什么样的身份为你服务？

比如：
- 叫我'小助手'，性格活泼可爱，风格亲切友好
- 叫我'代码专家'，性格专业严谨，风格简洁直接
- 或者其他你喜欢的设定"

如果用户提供了设定，请使用 identity.set 工具保存。`);
		} else {
			// 有身份时，添加身份描述
			parts.push('---');
			parts.push(`## 你的身份

你是 ${customIdentity.name}，${customIdentity.personality}。
风格特点：${customIdentity.style}`);
		}

		// 4. 动态工具描述
		if (toolSchemas && toolSchemas.length > 0) {
			parts.push('---');
			parts.push('## 可用工具');
			for (const tool of toolSchemas) {
				parts.push(`- **${tool.name}**: ${tool.description}`);
			}
		}

		// 4. 浏览器操作说明
		parts.push('---');
		parts.push(`## 浏览器操作

【搜索】
- "X站搜索Y" → 先 goto 到 X站，用站内搜索
- 不要用外部搜索引擎搜网站内容

【操作步骤】
- goto [URL] → 打开网页
- snapshot → 获取页面内容（返回元素列表）
- click [element_id] → 点击元素
- type [element_id] "文字" → 输入文字
- press Enter → 提交`);

		// 视觉操作
		if (hasVision) {
			parts.push(`## 视觉操作
- screenshot → 截图分析（用于桌面应用）`);
		}

		// 无 vision 时的降级说明
		if (!hasVision) {
			parts.push(`⚠️ 当前模型不支持图像理解，无法使用 screenshot 和 computer 工具。`);
			parts.push(`如需分析页面，请使用 browser.snapshot 获取文本内容。`);
		}

		// 5. 工具格式提示（用于非 function call 模式）
		if (toolFormatPrompt) {
			parts.push('---');
			parts.push(toolFormatPrompt);
		}

		// 6. 浏览器上下文
		if (browserContext?.url) {
			parts.push('---');
			parts.push(`## 当前页面`);
			parts.push(`URL: ${browserContext.url}`);
			if (browserContext.title) {
				parts.push(`标题: ${browserContext.title}`);
			}
		}

		return parts.join('\n\n');
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		this.logger.debug('Agent 初始化完成');
	}

	/**
	 * 运行 Agent - 统一入口
	 */
	async *run(message: string, session: any, options: AgentRunOptions = {}): AsyncGenerator<AgentChunk> {
		const runId = generateId('run');
		const startTime = Date.now();

		this.logger.info(`开始 Agent 运行: ${runId}`);
		this.logger.userInput(message);

		// 设置当前运行ID
		this.currentRunId = runId;
		// 清除工具调用历史（新任务开始时重置）
		this.clearToolCallHistory();
		// 注意：不要在这里重置 interruptRequested，以允许在任务开始前中断
		// 只有在没有中断请求的情况下才创建新的 abortController
		if (!this.interruptRequested) {
			this.abortController = new AbortController();
		} else {
			this.logger.info(`任务 ${runId} 在开始前已被标记为中断`);
			yield { type: 'error', error: '任务已被用户中断' };
			return;
		}

		try {
			// ========== 检查中断 ==========
			if (this.interruptRequested) {
				this.logger.info(`任务 ${runId} 在开始前被中断`);
				// 保存中断消息到 session
				this.gateway.sessionManager.addMessage(session.id, {
					role: 'assistant',
					content: '操作已被终止',
					metadata: { interrupted: true },
				});
				yield { type: 'content', content: '操作已被终止' };
				return;
			}

			// 添加用户消息
			this.gateway.sessionManager.addMessage(session.id, { role: 'user', content: message });

			// ========== 1. 获取模型和配置 ==========
			// 优先从 modelLibrary 获取默认模型，不再使用旧的 agent.defaultModel
			const modelLibrary = this.gateway.config.getModelLibrary();
			const modelRef = options.model || modelLibrary.defaultModelId;
			this.logger.debug(`使用模型: ${modelRef || '默认'}`);

			// 检测模型能力
			const capabilities = this.detectModelCapabilities(modelRef);
			this.logger.debug(`Vision: ${capabilities.hasVision ? '✅' : '❌'}`);
			this.logger.debug(`Function Call: ${capabilities.hasFunctionCall ? '✅' : '❌'}`);

			// ========== 2. 获取用户信息 ==========
			const customPrompt = this.gateway.config.get<string>('user.customPrompt');
			const language = this.gateway.config.get<string>('user.language');
			let userLocation = this.gateway.config.get<UserLocation>('user.location');

			if (!userLocation) {
				try {
					const ipLocation = await getLocationByIP();
					if (ipLocation) {
						userLocation = ipLocation;
						this.logger.debug(`IP 定位成功: ${userLocation.city}`);
					}
				} catch {
					this.logger.debug('IP 定位失败');
				}
			}

			// ========== 3. 获取工具 ==========
			let tools = this.gateway.toolRegistry.getToolSchemas();

			// 过滤掉不支持 vision 的工具
			if (!capabilities.hasVision) {
				tools = tools.filter((t) => !VISION_REQUIRED_TOOLS.includes(t.name));
				this.logger.debug(`已过滤需要 vision 的工具`);
			}

			// 应用工具白名单/黑名单
			if (options.tools) {
				const { enabled, disabled } = options.tools;
				if (enabled?.length) tools = tools.filter((t) => enabled.includes(t.name));
				if (disabled?.length) tools = tools.filter((t) => !disabled.includes(t.name));
			}

			this.logger.debug(`可用工具: ${tools.map((t) => t.name).join(', ')}`);

			// ========== 4. 选择调用模式 ==========
			// 如果模型支持 function call，使用 function 模式
			// 否则使用 prompt 模式（JSON 解析）
			const useFunctionMode = capabilities.hasFunctionCall && tools.length > 0;
			const toolCallMode = useFunctionMode ? 'function' : 'prompt';

			this.logger.debug(`工具调用模式: ${toolCallMode}`);

			// ========== 5. 生成系统提示 ==========
			const browserContext = this.gateway.sessionManager.getBrowserContext(session.id);
			const toolFormatPrompt = toolCallMode === 'prompt' && tools.length > 0
				? generateToolCallFormatPrompt(tools)
				: undefined;

			// 检查是否是首次对话
			const isFirst = isFirstConversation();
			if (isFirst) {
				this.logger.info('首次对话，将询问身份设定');
			}

			const systemPrompt = this.buildSystemPrompt(
				capabilities.hasVision,
				tools,
				toolFormatPrompt,
				browserContext,
				isFirst
			);

			// 添加用户自定义提示
			const finalSystemPrompt = customPrompt
				? `${customPrompt}\n\n${systemPrompt}`
				: systemPrompt;

			// ========== 6. 执行循环 ==========
			const maxIterations = options.maxIterations || this.gateway.config.get<number>('agent.maxIterations', 30);
			const debugMode = options.debugMode ?? this.gateway.config.get<boolean>('agent.debugMode', false);

			let iteration = 0;
			let shouldStop = false;  // 控制是否停止循环

			while (iteration < maxIterations && !shouldStop) {
				iteration++;
				this.logger.info(`── 迭代 ${iteration}/${maxIterations} ──`);

				// 检查中断
				if (this.interruptRequested) {
					this.logger.info(`任务 ${runId} 被中断`);
					// 保存中断消息到 session
					this.gateway.sessionManager.addMessage(session.id, {
						role: 'assistant',
						content: '操作已被终止',
						metadata: { interrupted: true },
					});
					yield { type: 'content', content: '操作已被终止' };
					return;
				}

				// 获取消息历史 - 使用智能压缩机制
				// 保留最近 6 轮完整对话，超出部分使用总结替代
				let messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt: finalSystemPrompt,
					maxTokens: 60000,
					preserveRecentRounds: 6,
				});

				this.logger.debug(`[消息历史] 共 ${messages.length} 条消息`);

				// 估算 token 数量
				const estimatedTokens = this.estimateTokenCount(messages, finalSystemPrompt);
				this.logger.debug(`[Token 估算] 约 ${estimatedTokens} tokens`);

				// 如果仍然超出限制，进一步压缩
				if (estimatedTokens > 55000) {
					this.logger.warn(`上下文仍然过长(${estimatedTokens} tokens)，使用更激进的压缩`);
					messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
						systemPrompt: finalSystemPrompt,
						maxTokens: 50000,
						preserveRecentRounds: 3, // 只保留最近 3 轮
					});
				}

				this.logger.debug(`📊 tokens: ~${estimatedTokens}`);

				// 调用 AI
				yield { type: 'thinking', iteration };

				let fullContent = '';
				let toolCalls: ParsedToolCall[] = [];
				let finishReason: string | null = null;

				// 根据调用模式选择参数
				const chatOptions = useFunctionMode
					? { tools: tools as any }  // Function mode
					: {};  // Prompt mode

				let summaryContent = '';
				let hasMoreToolCalls = false;
				let summaryDone = false;

				for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, chatOptions)) {
					if (this.interruptRequested) {
						this.logger.info(`任务 ${runId} 被中断`);
						// 保存中断消息到 session
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'assistant',
							content: '操作已被终止',
							metadata: { interrupted: true },
						});
						yield { type: 'content', content: '操作已被终止' };
						return;
					}

					if (chunk.type === 'error') {
						// 处理 API 错误
						const errorMsg = chunk.error || chunk.content || '未知错误';
						this.logger.error(`API 错误: ${errorMsg}`);
						yield { type: 'error', error: errorMsg };
						return;
					}

					if (chunk.type === 'content') {
						fullContent = chunk.fullContent || fullContent + (chunk.content || '');
						// 实时转发内容块，实现流式输出效果
						if (chunk.content) {
							yield { type: 'content', content: chunk.content, fullContent };
						}
					} else if (chunk.type === 'tool_use') {
						// 处理工具调用（Function Calling 模式）
						const toolUse = chunk.toolUse as any;
						if (toolUse?.function?.name) {
							// 保存原始 id 和工具信息
							toolCalls.push({
								id: toolUse.id || null,  // 保存原始 OpenAI id
								name: toolUse.function.name,
								arguments: safeParseJSON(toolUse.function.arguments, {}),
							});

							// 保存 tool_calls 到临时消息中（供后续使用）
							if (messages[messages.length - 1]?.role === 'assistant') {
								if (!messages[messages.length - 1].tool_calls) {
									messages[messages.length - 1].tool_calls = [];
								}
								messages[messages.length - 1].tool_calls!.push({
									id: toolUse.id || `call_${Date.now()}`,
									type: 'function',
									function: {
										name: toolUse.function.name,
										arguments: toolUse.function.arguments || '{}',
									},
								});
							}
						}
					} else if (chunk.type === 'finish') {
						finishReason = chunk.reason || null;
					}
				}

				// ========== 7. 检查是否完成 ==========
				// 核心逻辑：如果没有工具调用，说明 AI 认为任务完成
				if (toolCalls.length === 0 || finishReason === 'stop') {
					// 注意：内容已经在上面实时流式输出了，这里不需要再次 yield
					// 只需要记录日志和标记完成
					if (fullContent) {
						this.logger.aiResponse(fullContent);
					}

					// 保存 assistant 消息到 session（无工具调用的情况）
					// 修复：确保没有工具调用的 AI 回复也能被持久化保存
					if (fullContent) {
						const msgId = `msg_${Date.now()}`;
						this.gateway.sessionManager.addMessage(session.id, {
							id: msgId,
							role: 'assistant',
							content: fullContent,
						});
						this.logger.debug(`[保存 assistant] msgId=${msgId}, 无工具调用`);
					}

					this.logger.info(`任务完成（无工具调用）`);
					shouldStop = true;
					continue;
				}

				// ========== 8. 执行工具调用 ==========
				this.logger.info(`AI 请求执行 ${toolCalls.length} 个工具`);
				yield { type: 'tools', count: toolCalls.length };

				// 保存 assistant 消息到 session（必须在执行工具前保存）
				// 这样总结时才能读取到完整的消息链
				if (toolCalls.length > 0) {
					const msgId = `msg_${Date.now()}`;
					// 使用前端期望的扁平格式存储 toolCalls
					const toolCallsData = toolCalls.map((tc) => {
						// 从 arguments 中提取 action 字段
						let action = '';
						try {
							const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
							action = args?.action || args?.method || '';
						} catch {
							action = '';
						}
						return {
							id: tc.id || `call_${msgId}_${Date.now()}`,
							name: tc.name,
							action: action, // 保存 action 字段
							arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
							status: 'running', // 初始状态为 running
							result: undefined,
						};
					});
					this.gateway.sessionManager.addMessage(session.id, {
						id: msgId,
						role: 'assistant',
						content: fullContent || '',
						toolCalls: toolCallsData,
					});
					this.logger.debug(`[保存 assistant] msgId=${msgId}, toolCalls=${JSON.stringify(toolCalls.map(tc => tc.name))}`);
				}

				for (const toolCall of toolCalls) {
					// 检查中断请求
					if (this.interruptRequested) {
						this.logger.info(`任务 ${runId} 在工具执行前被中断`);
						// 保存中断消息到 session
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'assistant',
							content: '操作已被终止',
							metadata: { interrupted: true },
						});
						yield { type: 'content', content: '操作已被终止' };
						return;
					}

					const toolName = toolCall.name;
					const toolArgs = toolCall.arguments;
					const currentToolCallId = toolCall.id; // 使用当前工具调用的 id

					// 解析参数用于重复检测
					const parsedArgs = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;

					// 检查重复操作
					const duplicateCheck = this.checkDuplicateOperation(toolName, parsedArgs as Record<string, unknown>);
					if (duplicateCheck.isDuplicate) {
						this.logger.error(`🔄 ${duplicateCheck.message}`);
						yield {
							type: 'tool_result',
							tool: toolName,
							result: {
								success: false,
								error: duplicateCheck.message,
								duplicateDetected: true,
							},
						};
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: JSON.stringify({
								success: false,
								error: duplicateCheck.message,
								duplicateDetected: true,
							}),
							toolCallId: currentToolCallId || undefined,
							metadata: { toolName },
						});
						// 继续执行，让 AI 收到这个错误后决定如何处理
						continue;
					}

					// 记录工具调用（用于重复检测）
					this.recordToolCall(toolName, parsedArgs as Record<string, unknown>);

					// 记录 AI 决策
					const intent = toolArgs && typeof toolArgs === 'object'
						? Object.entries(parsedArgs).map(([k, v]) => `${k}=${JSON.stringify(v).substring(0, 50)}`).join(', ')
						: '';
					this.logger.aiDecision(toolName, intent.substring(0, 100));

					yield { type: 'tool_start', tool: toolName, args: toolArgs };

					// 安全检查
					const operationInfo = securityGuard.extractOperationInfo(toolName, toolArgs as Record<string, unknown>);
					const securityCheck = await securityGuard.check(operationInfo);

					if (!securityCheck.allowed && securityCheck.action === 'block') {
						this.logger.warn(`🚫 操作被阻止: ${securityCheck.reason}`);
						yield { type: 'tool_result', tool: toolName, result: { success: false, blocked: true, error: securityCheck.message } };
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool', content: JSON.stringify({ success: false, blocked: true, error: securityCheck.message }),
							toolCallId: currentToolCallId || undefined,
							metadata: { toolName },
						});
						continue;
					}

					try {
						// 检查中断请求（安全检查后）
						if (this.interruptRequested) {
							this.logger.info(`任务 ${runId} 在工具执行前被中断`);
							// 保存中断消息到 session
							this.gateway.sessionManager.addMessage(session.id, {
								role: 'assistant',
								content: '操作已被终止',
								metadata: { interrupted: true },
							});
							yield { type: 'content', content: '操作已被终止' };
							return;
						}

						const result = await this.gateway.executeTool(toolName, toolArgs, { signal: this.abortController?.signal });
						// 精简工具结果日志
						let resultSummary = '';
						if (typeof result === 'object' && result !== null) {
							const r = result as any;
							if (r.url) resultSummary = `URL: ${r.url}`;
							else if (r.success !== undefined) resultSummary = r.success ? '成功' : '失败';
							else if (r.error) resultSummary = `错误: ${r.error}`;
						}
						this.logger.toolResult(toolName, true, resultSummary);

						// 跟踪浏览器上下文
						if (toolName === 'browser') {
							const browserResult = result as { success?: boolean; url?: string; title?: string };
							if (browserResult.success && (browserResult.url || browserResult.title)) {
								this.gateway.sessionManager.setBrowserContext(session.id, {
									url: browserResult.url,
									title: browserResult.title
								});
							}
						}

						yield { type: 'tool_result', tool: toolName, result };
	
						const processed = this.processToolResult(toolName, result, capabilities.hasVision);
						
						// 添加 tool 结果消息（纯文本）
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: processed.displayContent,
							toolCallId: currentToolCallId || undefined,
							metadata: {
								toolName,
								isMultimodal: processed.isMultimodal,
								aiContext: processed.aiContext,
							},
						});
						
						// 如果是多模态内容（如截图），额外添加一个 user 消息包含图片
						// 因为 OpenAI API 不支持 tool 消息中的图片
						if (processed.isMultimodal && Array.isArray(processed.aiContext)) {
							const imageBlock = processed.aiContext.find((c: any) => c.type === 'image_url');
							const textBlocks = processed.aiContext.filter((c: any) => c.type === 'text');
							
							if (imageBlock) {
								// 构建包含图片和文本的 user 消息
								// 使用字符串格式，前端可以显示为文本
								const textContent = textBlocks.map((t: any) => t.text).join('\n');
								const imageUrl = imageBlock.image_url?.url || '';
								
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'user',
									content: `[截图结果]\n${textContent}\n\n[图片]`,
									metadata: {
										isImageMessage: true,
										imageUrl: imageUrl,
									},
								});
							}
						}
	
						// 更新 assistant 消息中的 toolCall，添加执行结果
						if (currentToolCallId) {
							this.gateway.sessionManager.updateToolCallResult(session.id, currentToolCallId, result);
						}
					} catch (error) {
						const errorMessage = (error as Error).message;
						this.logger.error(`工具执行失败 [${toolName}]`, error);
						yield { type: 'tool_error', tool: toolName, error: errorMessage };
						
						// 添加错误消息到会话
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: JSON.stringify({ error: errorMessage }),
							toolCallId: currentToolCallId || undefined,
							metadata: { toolName, error: true },
						});
						
						// 更新 assistant 消息中的 toolCall
						if (currentToolCallId) {
							this.gateway.sessionManager.updateToolCallResult(session.id, currentToolCallId, {
								success: false,
								error: errorMessage
							});
						}
						
						// 工具执行失败，终止任务，让 AI 总结错误原因
						this.logger.warn(`工具执行失败，终止任务: ${errorMessage}`);
						break;
					}
				}

				// 工具执行完成后，检查是否请求了中断
				if (this.interruptRequested) {
					this.logger.info(`任务 ${runId} 在工具执行完成后被中断`);
					// 保存中断消息到 session
					this.gateway.sessionManager.addMessage(session.id, {
						role: 'assistant',
						content: '操作已被终止',
						metadata: { interrupted: true },
					});
					yield { type: 'content', content: '操作已被终止' };
					return;
				}

				// ========== 9. 工具执行完成，调用 AI 总结 ==========
				this.logger.debug(`工具执行完成，准备调用 AI 总结`);
				yield { type: 'thinking', iteration: iteration + 0.5 };  // 使用半迭代号表示总结阶段

				// 获取最新消息（包含工具结果）- 使用智能压缩
				const summaryMessages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt: finalSystemPrompt,
					maxTokens: 60000,
					preserveRecentRounds: 6,
				});

			// 总结阶段恢复工具调用能力，允许 AI 继续执行下一步
			const summaryOptions = { tools: tools as any[], tool_choice: 'auto' };

			// 在每次总结开始前添加换行分隔（如果不是第一次总结）
			if (iteration > 1) {
				yield { type: 'content', content: '\n\n' };
			}

			summaryContent = '';
			let prevSummaryContentLength = 0; // 用于流式输出：只返回新内容
				hasMoreToolCalls = false;
				summaryDone = false;

				for await (const chunk of this.gateway.providerManager.chat(modelRef, summaryMessages, summaryOptions)) {
					if (this.interruptRequested) {
						this.logger.info(`任务 ${runId} 被中断`);
						// 保存中断消息到 session
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'assistant',
							content: '操作已被终止',
							metadata: { interrupted: true },
						});
						yield { type: 'content', content: '操作已被终止' };
						return;
					}

					if (chunk.type === 'error') {
						// 处理 API 错误
						const errorMsg = chunk.error || chunk.content || '未知错误';
						this.logger.error(`总结阶段 API 错误: ${errorMsg}`);
						yield { type: 'error', error: errorMsg };
						return;
					}

					if (chunk.type === 'content') {
						const chunkContent = chunk.fullContent || chunk.content || '';
						this.logger.debug(`[总结阶段] 收到 content chunk`);
						// 只返回新产生的内容，实现真正的流式输出
						const newContent = chunkContent.slice(prevSummaryContentLength);
						if (newContent) {
							yield { type: 'content', content: newContent };
						}
						summaryContent = chunkContent;
						prevSummaryContentLength = summaryContent.length;
					} else if (chunk.type === 'tool_use') {
						// 如果有新的工具调用，继续执行
						hasMoreToolCalls = true;
						const toolUse = chunk.toolUse as any;
						if (toolUse?.function?.name) {
							toolCalls.push({
								id: toolUse.id || null,
								name: toolUse.function.name,
								arguments: safeParseJSON(toolUse.function.arguments, {}),
							});
						}
					} else if (chunk.type === 'finish') {
						// 如果 finish_reason 是 stop 且没有新工具调用，说明总结完成
						if (chunk.reason === 'stop' && !hasMoreToolCalls) {
							summaryDone = true;
						}
					}

					// 如果总结完成，退出循环
					if (summaryDone) {
						break;
					}
				}

				// 如果没有新的工具调用，任务完成
				if (!hasMoreToolCalls) {
					this.logger.info(`任务完成（AI 总结完成）`);
					// 保存总结消息到 session
					if (summaryContent) {
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'assistant',
							content: summaryContent,
						});
						this.logger.debug(`[保存总结] 内容长度: ${summaryContent.length}`);
					}
					yield { type: 'done', content: summaryContent };
					shouldStop = true;
				}
			}

			// 超时强制总结
			if (iteration >= maxIterations) {
				this.logger.warn(`达到最大迭代次数(${maxIterations})，强制总结`);
				this.gateway.sessionManager.addMessage(session.id, {
					role: 'user',
					content: '已达到操作次数限制。请根据目前的信息给用户简洁总结。',
				});
				const messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt: finalSystemPrompt,
					maxTokens: 60000,
					preserveRecentRounds: 6,
				});
				for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, {})) {
					if (chunk.type === 'content') {
						yield { type: 'content', content: chunk.content };
					} else if (chunk.type === 'error') {
						yield { type: 'error', error: chunk.content };
					}
				}
			}

			const duration = Date.now() - startTime;
			this.logger.success(`Agent 运行完成: ${runId} (${duration}ms)`);
		} catch (error) {
			this.logger.error(`Agent 运行失败: ${runId}`, error);
			yield { type: 'error', error: (error as Error).message };
		} finally {
			this.currentRunId = null;
			this.interruptRequested = false;
			this.abortController = null;
		}
	}

	/**
	 * 处理工具结果
	 */
	private processToolResult(toolName: string, result: unknown, hasVision: boolean): { displayContent: string; aiContext?: unknown; isMultimodal: boolean } {
		if (toolName === 'screenshot') {
			const sr = result as {
				success: boolean;
				base64?: string;
				markedImage?: string;
				elements?: Array<{ id: number; text: string; center: [number, number] }>;
				ocrEnabled?: boolean;
			};
			if (sr.success && sr.base64) {
				const sizeKB = Math.round((sr.base64.length * 0.75) / 1024);
				
				// 构建 AI 上下文
				const aiContext: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
					{ type: 'text', text: `截图成功 (${sizeKB}KB)` }
				];
				
				// 添加元素列表信息（如果有）
				if (sr.ocrEnabled && sr.elements && sr.elements.length > 0) {
					const elementsText = sr.elements.map(e => `[${e.id}] ${e.text} (坐标: ${e.center[0]}, ${e.center[1]})`).join('\n');
					aiContext.push({ type: 'text', text: `识别到的元素列表：\n${elementsText}` });
				}
				
				if (hasVision) {
					// 优先使用标注图（markedImage），如果没有则使用原图（base64）
					const imageToShow = sr.markedImage || sr.base64;
					aiContext.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageToShow}` } });
					
					return {
						displayContent: `截图成功 (${sizeKB}KB)${sr.ocrEnabled ? `, 识别到 ${sr.elements?.length || 0} 个元素` : ''}`,
						aiContext: aiContext,
						isMultimodal: true,
					};
				}
				return {
					displayContent: '截图成功',
					aiContext: {
						success: true,
						message: `截图成功 (${sizeKB}KB)`,
						elements: sr.elements
					},
					isMultimodal: false,
				};
			}
		}

		if (toolName === 'browser') {
			const br = result as {
				success: boolean;
				action?: string;
				aiSummary?: string;
				elements?: string[]; // 已经是格式化后的字符串数组
				url?: string;
				title?: string;
				message?: string;
				tabs?: Array<{ index: number; url: string; title: string; active: boolean }>;
				currentTabIndex?: number;
			};

			if (!br.success) {
				return {
					displayContent: `操作失败`,
					aiContext: JSON.stringify(result),
					isMultimodal: false,
				};
			}

			// 生成简洁的状态（给用户看）
			const statusMap: Record<string, string> = {
				'goto': '【页面已打开】',
				'goto_with_snapshot': '【页面已打开】',
				'snapshot': '【页面快照已获取】',
				'search': '【已搜索】',
				'click': '【已点击】',
				'click_with_snapshot': '【已点击】',
				'screenshot': '【截图已保存】',
				'open': '【浏览器已打开】',
				'close': '【浏览器已关闭】',
				'tabs': '【标签页列表】',
				'close_tab': '【标签页已关闭】',
			};
			const displayContent = statusMap[br.action || ''] || '【操作完成】';

			// 生成完整的上下文（给 AI 看）
			let aiContext = '';
			if (br.url) {
				aiContext += `\n📍 ${br.url}`;
			}
			if (br.title) {
				aiContext += `\n标题: ${br.title}`;
			}
			// 包含标签页信息
			if (br.tabs && br.tabs.length > 0) {
				aiContext += `\n\n📑 标签页 (${br.tabs.length}个):`;
				br.tabs.forEach(tab => {
					const activeMark = tab.active ? ' [当前]' : '';
					aiContext += `\n  [${tab.index}] ${tab.title}${activeMark}`;
				});
			}
			if (br.aiSummary) {
				aiContext += `\n\n${br.aiSummary}`;
			}
			// 关键：包含元素列表，让 AI 知道页面有哪些可交互元素
			if (br.elements && br.elements.length > 0) {
				aiContext += `\n\n页面元素:\n${br.elements.join('\n')}`;
			}
	
			return {
				displayContent,
				aiContext,
				isMultimodal: false,
			};
		}

		// 其他工具
		return {
			displayContent: typeof result === 'string' ? result : '操作完成',
			aiContext: typeof result === 'string' ? result : JSON.stringify(result),
			isMultimodal: false,
		};
	}
}

export default Agent;
