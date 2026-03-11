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
 * Agent 类
 */
export class Agent {
	private gateway: Gateway;
	private logger = logger.child('Agent');
	private defaultSystemPrompt: string;
	private currentRunId: string | null = null;
	private interruptRequested = false;

	constructor(gateway: Gateway) {
		this.gateway = gateway;
		this.defaultSystemPrompt = '';
	}

	/**
	 * 中断当前正在运行的任务
	 */
	interrupt(reason: string = 'user_requested'): void {
		if (this.currentRunId) {
			this.logger.info(`中断任务 ${this.currentRunId}: ${reason}`);
			this.interruptRequested = true;
		}
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
	 */
	private buildSystemPrompt(
		hasVision: boolean,
		userInfo?: { name?: string; location?: UserLocation },
		toolFormatPrompt?: string,
		browserContext?: { url?: string; title?: string }
	): string {
		const parts: string[] = [];

		// 浏览器操作说明
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

		// 网页获取
		parts.push(`## 网页获取
{"action":"fetch","url":"URL"} → 获取网页内容`);

		// 系统命令
		parts.push(`## 系统命令
- Windows：Start-Process 打开应用/文件`);

		// 添加工具格式提示
		if (toolFormatPrompt) {
			parts.push(`---\n${toolFormatPrompt}`);
		}

		// 浏览器上下文
		if (browserContext?.url) {
			parts.push(`\n当前页面: ${browserContext.url}`);
			if (browserContext.title) {
				parts.push(`标题: ${browserContext.title}`);
			}
		}

		// 任务完成规则
		parts.push(`\n【任务完成规则】
- 搜索完成 = 任务完成，可以直接总结告诉用户
- 打开网页后，任务已完成，告诉用户这个网站是什么、做什么的
- 不要说"如需进一步操作请告诉我"，直接告诉用户看到了什么

【回复示例】
用户: "打开wkea"
你: "维嘉工业品商城 (wkea.cn)，1997年创立于上海的工业品MRO采购批发平台，定位是'工业品的Costco'。主要提供正品低价、现货清单、智能询价等服务。"

用户: "搜索 wkea"
你: "搜索到以下结果：
1. 维嘉工业品商城 (wkea.cn) - 正品低价的工业品MRO采购批发平台
2. WKEA 维嘉 App - 提供工业品采购服务的移动应用
3. WKEA-FM - 美国阿拉巴马州的广播电台 (98.3 FM)
..."`);

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
		this.interruptRequested = false;

		try {
			// ========== 检查中断 ==========
			if (this.interruptRequested) {
				this.logger.info(`任务 ${runId} 在开始前被中断`);
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

			const systemPrompt = this.buildSystemPrompt(
				capabilities.hasVision,
				{ location: userLocation },
				toolFormatPrompt,
				browserContext
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
					if (fullContent) {
						this.logger.aiResponse(fullContent);
						yield { type: 'content', content: fullContent };
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
					const toolCallsData = toolCalls.map((tc) => ({
						id: tc.id || `call_${msgId}_${Date.now()}`,
						name: tc.name,
						arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
						status: 'running', // 初始状态为 running
						result: undefined,
					}));
					this.gateway.sessionManager.addMessage(session.id, {
						id: msgId,
						role: 'assistant',
						content: fullContent || '',
						toolCalls: toolCallsData,
					});
					this.logger.debug(`[保存 assistant] msgId=${msgId}, toolCalls=${JSON.stringify(toolCalls.map(tc => tc.name))}`);
				}

				for (const toolCall of toolCalls) {
					const toolName = toolCall.name;
					const toolArgs = toolCall.arguments;
					const currentToolCallId = toolCall.id; // 使用当前工具调用的 id

					// 记录 AI 决策
					const intent = toolArgs && typeof toolArgs === 'object'
						? Object.entries(toolArgs).map(([k, v]) => `${k}=${JSON.stringify(v).substring(0, 50)}`).join(', ')
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
						const result = await this.gateway.executeTool(toolName, toolArgs);
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
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool', content: processed.displayContent,
							toolCallId: currentToolCallId || undefined,
							metadata: {
								toolName,
								isMultimodal: processed.isMultimodal,
								aiContext: processed.aiContext,
							},
						});
	
						// 更新 assistant 消息中的 toolCall，添加执行结果
						if (currentToolCallId) {
							this.gateway.sessionManager.updateToolCallResult(session.id, currentToolCallId, result);
						}
					} catch (error) {
						this.logger.error(`工具执行失败 [${toolName}]`, error);
						yield { type: 'tool_error', tool: toolName, error: (error as Error).message };
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool', content: JSON.stringify({ error: (error as Error).message }),
							toolCallId: currentToolCallId || undefined,
							metadata: { toolName, error: true },
						});

						// 更新 assistant 消息中的 toolCall，添加错误结果
						if (currentToolCallId) {
							this.gateway.sessionManager.updateToolCallResult(session.id, currentToolCallId, { success: false, error: (error as Error).message });
						}
					}
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

				summaryContent = '';
				let prevSummaryContentLength = 0; // 用于流式输出：只返回新内容
				hasMoreToolCalls = false;
				summaryDone = false;

				for await (const chunk of this.gateway.providerManager.chat(modelRef, summaryMessages, summaryOptions)) {
					if (this.interruptRequested) {
						this.logger.info(`任务 ${runId} 被中断`);
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
		}
	}

	/**
	 * 处理工具结果
	 */
	private processToolResult(toolName: string, result: unknown, hasVision: boolean): { displayContent: string; aiContext?: unknown; isMultimodal: boolean } {
		if (toolName === 'screenshot') {
			const sr = result as { success: boolean; base64?: string };
			if (sr.success && sr.base64) {
				const sizeKB = Math.round((sr.base64.length * 0.75) / 1024);
				if (hasVision) {
					return {
						displayContent: `截图成功 (${sizeKB}KB)`,
						aiContext: [{ type: 'text', text: `截图成功 (${sizeKB}KB)` }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${sr.base64}` } }],
						isMultimodal: true,
					};
				}
				return {
					displayContent: '截图成功',
					aiContext: { success: true, message: `截图成功 (${sizeKB}KB)` },
					isMultimodal: false,
				};
			}
		}

		if (toolName === 'browser') {
			const br = result as {
				success: boolean;
				action?: string;
				aiSummary?: string;
				elements?: Array<{
					element_id: string;
					tag: string;
					text?: string;
					href?: string;
					role?: string;
					placeholder?: string;
				}>;
				url?: string;
				title?: string;
				message?: string;
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
			if (br.aiSummary) {
				aiContext += `\n\n${br.aiSummary}`;
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
