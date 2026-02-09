/**
 * Agent 核心
 * 执行 AI 对话和工具调用
 */

import { logger } from '../utils/logger.js';
import { generateId, safeParseJSON, getLocationByIP, type UserLocation } from '../utils/helpers.js';
import { getSystemDescription } from '../tools/exec.js';
import { memoryManager } from '../memory/index.js';
import type { Gateway } from '../gateway/index.js';
import type { AgentChunk, ChatChunk, ToolCall, ToolUse, ContentBlock, DebugData, DebugElement } from '../types/index.js';
import { SessionManager } from './session.js';
import { waitForConfirmation } from '../server/index.js';
import { ocrSomService } from '../services/ocr-som.js';
import { drawClickPosition, saveDebugImages, cleanupOldDebugImages, type DebugInfo } from '../services/debug-visualizer.js';
import { securityGuard } from '../services/security-guard.js';
import { loadSkills, skillsToPromptSection } from '../services/skills-loader.js';
import { parsePromptResponse, generateToolCallFormatPrompt } from './prompt-parser.js';

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

// 缓存最近的截图和 OCR 结果（调试模式用）
interface DebugCache {
	lastScreenshot?: string; // 最近的截图 base64
	lastMarkedImage?: string; // 最近的 OCR-SoM 标注图 base64
	lastElements?: DebugElement[]; // 最近的 OCR-SoM 元素列表
	lastScreenInfo?: {  // 屏幕信息
		imageSize?: string;
		mouseCoordSize?: string;
		scale?: number;
	};
	stepCount: number; // 调试步骤计数器
}

// 需要 Vision 能力的工具
const VISION_REQUIRED_TOOLS = ['screenshot', 'computer'];

interface StoredSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: unknown[];
	metadata?: Record<string, unknown>;
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
		this.defaultSystemPrompt = ''; // 动态生成
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
	 * 改进的任务检查 - 加强版本
	 * @param userMessage 用户原始消息
	 * @param aiResponse AI响应
	 * @param toolResults 工具执行结果
	 * @returns 检查结果
	 */
	private checkTaskCompletion(
		userMessage: string,
		aiResponse: string,
		toolResults: any[]
	): { completed: boolean; needsMoreWork: boolean; nextAction?: string } {
		
		// 强化的完成关键词检测
		const completionPhrases = [
			// 直接无法获取
			'无法直接获取',
			'无法直接访问',
			'无法直接查看',
			'无法直接搜索',
			
			// 建议类
			'建议您',
			'建议你在',
			'建议使用',
			'建议访问',
			'建议查看',
			'建议直接',
			
			// 无法完成类
			'无法获取',
			'无法找到',
			'无法完成',
			'无法提供',
			'无法获取到',
			'无法访问到',
			
			// 其他完成指示
			'建议您查看',
			'建议您使用',
			'建议您访问',
			'建议您直接',
			
			// 搜索相关
			'建议你在',
			'建议你在浏览器中',
			'建议你在搜索引擎中'
		];
		
		// 检查AI是否表示无法完成或给出建议
		const isCompletionResponse = completionPhrases.some(phrase => 
			aiResponse.includes(phrase)
		);
		
		// 强化的完成判断 - 区分真实失败和尝试中的困难
		if (isCompletionResponse && aiResponse.length > 20) {
			// 检查AI是否真的尝试了所有可能的方法
			const hasAttemptedMultipleMethods = aiResponse.includes('尝试') || 
				aiResponse.includes('搜索') || 
				aiResponse.includes('点击') ||
				aiResponse.includes('访问') ||
				aiResponse.includes('查找');
		
			const isRealFailure = (aiResponse.includes('无法') && 
				(aiResponse.includes('访问') || aiResponse.includes('获取') || aiResponse.includes('找到'))) &&
				(aiResponse.includes('页面不存在') || aiResponse.includes('网络') || aiResponse.includes('权限') || aiResponse.includes('服务器') || aiResponse.includes('错误'));
		
			// 如果AI只是说"无法直接获取"但没有真正尝试多种方法，不要认为任务完成
			if (!hasAttemptedMultipleMethods && !isRealFailure) {
				this.logger.info(`🔄 AI可能还有未尝试的方法: ${aiResponse.substring(0, 50)}...`);
				return { completed: false, needsMoreWork: true, nextAction: 'try_alternative_methods' };
			}
		
			this.logger.info(`✅ 任务完成检测: AI表示无法完成或给出建议`);
			return { completed: true, needsMoreWork: false };
		}
		
		// 检查AI要求澄清的情况 - 防止死循环澄清
		const clarificationPhrases = ['澄清', '具体', '详细', '明确', '清楚'];
		const isClarificationRequest = clarificationPhrases.some(phrase => 
			aiResponse.includes(phrase)
		);
		
		if (isClarificationRequest) {
			// 检查用户任务是否已经足够明确
			const userTask = userMessage.toLowerCase();
			const isClearTask = (
				userTask.includes('搜索') && userTask.includes('影视飓风') ||
				userTask.includes('粉丝') ||
				userTask.includes('视频') ||
				userTask.includes('b站') || userTask.includes('bilibili')
			);
			
			// 如果任务已经足够明确，不允许AI要求澄清
			if (isClearTask) {
				this.logger.info(`🔄 任务已明确，AI不应要求澄清: ${userMessage}`);
				return { completed: false, needsMoreWork: true, nextAction: 'continue_execution' };
			}
			
			this.logger.info(`❓ 任务澄清: AI需要更多信息`);
			return { completed: false, needsMoreWork: true, nextAction: 'ask_clarification' };
		}
		
		// 检查工具执行结果
		if (toolResults.length > 0) {
			// 检查是否有错误
			const hasErrors = toolResults.some(result => 
				result.success === false || result.error
			);
			if (hasErrors) {
				this.logger.warn(`⚠️ 工具执行有错误`);
				return { completed: false, needsMoreWork: true, nextAction: 'retry' };
			}
			
			// 检查是否有实际结果（URL、内容等）
			const hasResults = toolResults.some(result => 
				result.success === true && (result.url || result.content || result.data)
			);
			if (hasResults) {
				this.logger.info(`✅ 工具执行成功，获得结果`);
				return { completed: true, needsMoreWork: false };
			}
		}
		
		// 对于纯回答性问题，根据回复长度判断
		if (toolResults.length === 0 && aiResponse.length > 80) {
			this.logger.info(`✅ 回答性问题: AI提供了完整回答`);
			return { completed: true, needsMoreWork: false };
		}
		
		// 如果AI明确表达无法完成的意思
		const cannotCompletePhrases = [
			'我无法',
			'无法',
			'不能',
			'不建议',
			'不建议您'
		];
		
		const expressesInability = cannotCompletePhrases.some(phrase => 
			aiResponse.includes(phrase)
		);
		
		if (expressesInability && aiResponse.length > 30) {
			// 进一步判断这是真的无法完成还是需要尝试不同方法
			const hasTriedAlternatives = aiResponse.includes('尝试') || 
				aiResponse.includes('不同') ||
				aiResponse.includes('其他') ||
				aiResponse.includes('方法');
				
			const isRealLimitation = aiResponse.includes('权限') || 
				aiResponse.includes('网络') ||
				aiResponse.includes('页面不存在') ||
				aiResponse.includes('服务器错误');
				
			// 如果AI没有尝试替代方法且不是真正的技术限制，要求继续尝试
			if (!hasTriedAlternatives && !isRealLimitation) {
				this.logger.info(`🔄 AI需要尝试不同方法: ${aiResponse.substring(0, 50)}...`);
				return { completed: false, needsMoreWork: true, nextAction: 'try_alternative_methods' };
			}
			
			this.logger.info(`✅ AI表达无法完成: ${aiResponse.substring(0, 50)}...`);
			return { completed: true, needsMoreWork: false };
		}
		
		// 默认需要更多信息
		this.logger.info(`🔄 任务未完成，需要更多信息`);
		return { completed: false, needsMoreWork: true };
	}

	/**
	 * 估算token数量（粗略估算）
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
		
		// 粗略估算：每个token大约4个字符
		return Math.ceil(allText.length / 4);
	}

	/**
	 * 压缩消息历史 - 更激进的压缩策略
	 */
	private compressMessages(
		messages: any[], 
		systemPrompt: string, 
		maxTokens: number
	): any[] {
		// 保留系统提示
		const systemMessage = messages.find(msg => msg.role === 'system');
		const userMessages = messages.filter(msg => msg.role === 'user');
		const assistantMessages = messages.filter(msg => msg.role === 'assistant');
		const toolMessages = messages.filter(msg => msg.role === 'tool');
		
		const compressed: any[] = [];
		
		// 保留系统提示
		if (systemMessage) {
			compressed.push(systemMessage);
		}
		
		// 更激进的压缩策略
		// 用户消息：只保留最近的2-3条
		const recentUserCount = Math.min(3, Math.max(1, Math.floor(userMessages.length / 3)));
		const recentUsers = userMessages.slice(-recentUserCount);
		
		// 助手消息：只保留最近的2-3条
		const recentAssistantCount = Math.min(3, Math.max(1, Math.floor(assistantMessages.length / 3)));
		const recentAssistants = assistantMessages.slice(-recentAssistantCount);
		
		// 工具消息：只保留最近1-2条
		const recentToolCount = Math.min(2, Math.max(1, Math.floor(toolMessages.length / 4)));
		const recentTools = toolMessages.slice(-recentToolCount);
		
		// 添加压缩后的消息
		const allRecentMessages = [
			...recentUsers,
			...recentAssistants,
			...recentTools
		].sort((a, b) => {
			// 按时间戳排序
			const aTime = a.timestamp || a.createdAt || 0;
			const bTime = b.timestamp || b.createdAt || 0;
			return aTime - bTime;
		});
		
		compressed.push(...allRecentMessages);
		
		// 添加详细的压缩总结消息
		compressed.push({
			role: 'system',
			content: `🔄 上下文压缩完成: 原始${messages.length}条消息 → 保留${allRecentMessages.length}条最近消息 (用户:${recentUsers.length}, 助手:${recentAssistants.length}, 工具:${recentTools.length})`
		});
		
		// 再次检查压缩后的长度，如果仍然超长，进一步压缩
		const newTokenCount = this.estimateTokenCount(compressed, systemPrompt);
		if (newTokenCount > maxTokens * 0.8) { // 如果仍然超过80%阈值
			this.logger.warn(`⚠️ 压缩后仍然较长: ~${newTokenCount} tokens，再次压缩`);
			return this.compressMessages(compressed, systemPrompt, maxTokens * 0.8);
		}
		
		return compressed;
	}

	/**
	 * 生成系统提示（根据 Vision 能力和用户信息动态调整）
	 * @param hasVision 是否支持图像理解
	 * @param userInfo 用户信息
	 * @param toolFormatPrompt 工具调用格式提示（Prompt 模式下使用）
	 */
	private generateSystemPrompt(
		hasVision: boolean,
		userInfo?: { name?: string; location?: UserLocation; customPrompt?: string; language?: string },
		toolFormatPrompt?: string,
		browserContext?: { url?: string; title?: string }
	): string {
		// 用户信息部分
		const userInfoSection = userInfo
			? `
## 用户信息
${userInfo.name ? `- 用户名称：${userInfo.name}` : ''}
${userInfo.location ? `- 用户位置：${userInfo.location.city}${userInfo.location.region ? `，${userInfo.location.region}` : ''}${userInfo.location.country ? `，${userInfo.location.country}` : ''}` : ''}
${userInfo.location?.timezone ? `- 时区：${userInfo.location.timezone}` : ''}
${userInfo.language ? `- 偏好语言：${userInfo.language}` : ''}

**提示**：当用户询问天气、本地新闻、附近服务等与位置相关的信息时，可以直接使用上述位置，无需再次询问。
`
			: '';

		// 用户记忆部分
		const memorySummary = memoryManager.getSummary();

		// 用户自定义 prompt
		const customPromptSection = userInfo?.customPrompt
			? `
## 用户自定义指令
${userInfo.customPrompt}
`
			: '';

		// 获取沙盒安全说明
		const sandboxPrompt = securityGuard.getSandboxPrompt();

		const basePrompt = `你是 NutBot，一个能自动操作电脑的 AI 助理。

理解用户需求，主动执行任务，提供简洁回复。
"

${userInfoSection}${memorySummary ? `\n${memorySummary}\n` : ''}${customPromptSection}
${sandboxPrompt}
${browserContext?.url ? `
## 当前浏览器状态
- 页面: ${browserContext.url}
${browserContext?.title ? `- 标题: ${browserContext.title}` : ''}

` : ''}
${getSystemDescription()}

## 可用工具

### exec - 系统命令
- Windows: PowerShell | macOS/Linux: bash
- 打开应用：优先 computer 通过开始菜单搜索`;

		// Vision 模式：支持截图分析和桌面控制
		const visionTools = `

### screenshot - 屏幕截图
- 仅桌面应用（记事本、微信、Excel）；网页用 browser snapshot
- 截图自带 OCR-SoM，返回可点击元素坐标；截图后直接用返回的坐标，不要再 list_elements

### computer - 桌面控制
- 仅桌面应用。定位：list_elements + click_element（任务栏/系统控件），或 screenshot 返回坐标 + left_click [x,y]（应用内）。不要混用。
- 操作：left_click/right_click/double_click, type, key, hotkey, scroll, mouse_move；可加 delay`;

		// 非 Vision 模式：智能判断是否需要视觉
		const nonVisionNotice = `

## 当前模型不支持图像理解

可做：exec（命令/文件/系统设置）、browser（网页有 snapshot）、http request、写脚本处理数据。不可做：操作微信/QQ/桌面图标等需要"看屏幕"的任务。若用户请求必须看屏幕才能完成，回复："当前模型不支持图像，请换支持视觉的模型（如 GPT-4o）或告诉我命令行方式。"`;

		const browserTool = `

### 网页操作
- 只打开让用户看：exec Start-Process/open/xdg-open + URL
- 自动搜索/点击/填表：browser（goto → snapshot → click/type/press）
- 获取网页内容：browser snapshot
- 任何浏览器相关操作：全部使用browser工具

**快速搜索**：
- 直接使用：{"action":"search","searchQuery":"关键词","engine":"google"}

**手动搜索步骤**：
1. snapshot 获取页面元素
2. 找到搜索框并点击
3. type 输入关键词
4. press Enter
5. 查看结果并根据需要继续操作`;

		const footer = `

当前时间：${new Date().toLocaleTimeString('zh-CN', {hour12: false})}
${hasVision ? 'Vision 已启用' : 'Vision 未启用'}`;

		return (
			basePrompt +
			(hasVision ? visionTools : nonVisionNotice) +
			browserTool +
			footer +
			(toolFormatPrompt ? `\n\n${toolFormatPrompt}` : '')
		);
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		this.logger.debug('Agent 初始化完成');
	}

	/**
	 * 运行 Agent
	 */
	async *run(message: string, session: StoredSession, options: AgentRunOptions = {}): AsyncGenerator<AgentChunk> {
		const runId = generateId('run');
		const startTime = Date.now();

		this.logger.info(`开始 Agent 运行: ${runId}`);
		this.logger.info(`用户消息: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

		// 设置当前运行ID
		this.currentRunId = runId;
		this.interruptRequested = false;

		try {
			// 检查是否请求了中断
			if (this.interruptRequested) {
				this.logger.info(`任务 ${runId} 在开始前被中断`);
				return;
			}
			// 添加用户消息
			this.gateway.sessionManager.addMessage(session.id, {
				role: 'user',
				content: message,
			});

			// 获取模型和 Provider
			const modelRef = options.model || this.gateway.config.get<string>('agent.defaultModel');
			this.logger.info(`使用模型: ${modelRef || '默认'}`);

			// 检查 Vision 支持
			const hasVision = this.gateway.providerManager.checkVisionSupport(modelRef);
			this.logger.info(`Vision 支持: ${hasVision ? '✅ 是' : '❌ 否'}`);

			// 获取用户信息（配置 + IP 定位）
			const userName = this.gateway.config.get<string>('user.name');
			const customPrompt = this.gateway.config.get<string>('user.customPrompt');
			const language = this.gateway.config.get<string>('user.language');
			let userLocation = this.gateway.config.get<UserLocation>('user.location');

			// 如果配置中没有位置，尝试 IP 定位
			if (!userLocation) {
				try {
					const ipLocation = await getLocationByIP();
					if (ipLocation) {
						userLocation = ipLocation;
						this.logger.info(`IP 定位成功: ${userLocation.city}, ${userLocation.region || ''}`);
					}
				} catch (e) {
					this.logger.debug('IP 定位失败，继续执行');
				}
			}

			const userInfo = {
				name: userName || undefined,
				location: userLocation || undefined,
				customPrompt: customPrompt || undefined,
				language: language || undefined,
			};

			// 获取工具调用模式
			const toolCallMode = this.gateway.config.get<string>('agent.toolCallMode', 'prompt') as 'function' | 'prompt';
			this.logger.info(`工具调用模式: ${toolCallMode === 'prompt' ? 'Prompt JSON' : 'Function Calling'}`);

			// 获取工具（如果不支持 Vision，过滤掉需要 Vision 的工具）
			let tools = this.gateway.toolRegistry.getToolSchemas();
			if (!hasVision) {
				tools = tools.filter((t) => !VISION_REQUIRED_TOOLS.includes(t.name));
			}

			// 根据 Agent Profile 的工具配置过滤
			if (options.tools) {
				const { enabled, disabled } = options.tools;
				if (enabled && enabled.length > 0) {
					// 只启用指定的工具
					tools = tools.filter((t) => enabled.includes(t.name));
				}
				if (disabled && disabled.length > 0) {
					// 禁用指定的工具
					tools = tools.filter((t) => !disabled.includes(t.name));
				}
			}

			this.logger.info(`可用工具: ${tools.map((t) => t.name).join(', ') || '无'}`);

			// 生成工具格式提示（Prompt 模式下使用）
			const toolFormatPrompt = toolCallMode === 'prompt' && tools.length > 0
				? generateToolCallFormatPrompt(tools)
				: undefined;

			// 获取浏览器上下文（每次迭代更新）
			const browserContext = this.gateway.sessionManager.getBrowserContext(session.id);
			if (browserContext?.url) {
				this.logger.debug(`📍 当前浏览器上下文: ${browserContext.url}`);
			}

			// 获取系统提示（根据 Vision 能力和用户信息动态生成）
			const systemPrompt =
				options.systemPrompt ||
				this.gateway.config.get<string>('agent.systemPrompt') ||
				this.generateSystemPrompt(hasVision, userInfo, toolFormatPrompt, browserContext);

			// 最大迭代次数（用于工具调用循环）
			const maxIterations = options.maxIterations || this.gateway.config.get<number>('agent.maxIterations', 30);

			// 调试模式设置（移到循环外，保持状态跨迭代）
			const debugMode = options.debugMode ?? this.gateway.config.get<boolean>('agent.debugMode', false);
			const debugCache: DebugCache = { stepCount: 0 };
			if (debugMode) {
				this.logger.info('🔍 调试模式已启用');
				// 清理旧的调试图片，保留最近 50 个
				cleanupOldDebugImages(50);
			}

			let iteration = 0;
			const toolResults: any[] = []; // 收集所有工具执行结果

			while (iteration < maxIterations) {
				iteration++;
				this.logger.info(`─────────── 迭代 ${iteration}/${maxIterations} ───────────`);

				// 获取消息历史 - 降低默认数量避免超限
				let messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt,
					maxMessages: 10, // 降低默认数量避免快速增长
				});

				// 检查上下文长度，如果超长则压缩
				const estimatedTokens = this.estimateTokenCount(messages, systemPrompt);
				const maxTokens = 100000; // 降低阈值，更早触发压缩
				
				if (estimatedTokens > maxTokens) {
					this.logger.warn(`⚠️ 上下文过长: ~${estimatedTokens} tokens，开始压缩`);
					
					// 压缩消息历史：保留系统提示和最近的消息
					messages = this.compressMessages(messages, systemPrompt, maxTokens);
					
					const compressedTokens = this.estimateTokenCount(messages, systemPrompt);
					this.logger.info(`✅ 压缩后: ~${compressedTokens} tokens, 消息数量: ${messages.length}`);
				} else {
					this.logger.info(`📊 消息数量: ${messages.length}, ~${estimatedTokens} tokens`);
				}
				this.logger.debug('===== 发送给 OpenAI 的消息 =====');
				for (let i = 0; i < messages.length; i++) {
					const msg = messages[i];
					if (msg.role === 'tool') {
						const hasId = (msg as any).tool_call_id;
						this.logger.debug(`  [${i}] tool role, tool_call_id: ${hasId || 'MISSING!'}`);
						if (!hasId) {
							this.logger.warn(`⚠️ 严重: tool 消息缺少 tool_call_id!`);
						}
					} else if ('tool_calls' in msg) {
						this.logger.debug(`  [${i}] assistant with ${(msg as any).tool_calls?.length || 0} tool_calls`);
					} else {
						const content = typeof msg.content === 'string' ? msg.content.substring(0, 30) : '...';
						this.logger.debug(`  [${i}] ${msg.role}: ${content}...`);
					}
				}
				this.logger.debug('===================================');

				// 调用 AI
				let fullContent = '';
				let toolCalls: Array<ToolCall | ToolUse> = [];
				let finishReason: string | null = null;
				let thinking = ''; // AI 的思考内容

				yield { type: 'thinking', iteration };

				// 添加超时检测，定期发送状态
				let lastChunkTime = Date.now();
				let responseStarted = false;
				const timeoutCheckInterval = setInterval(() => {
					const waitTime = Math.round((Date.now() - lastChunkTime) / 1000);
					if (!responseStarted && waitTime > 10) {
						this.logger.info(`等待 AI 响应中... (${waitTime}s)`);
					}
				}, 10000); // 每 10 秒检查一次

				try {
					// Prompt 模式：不传递 tools 参数，从文本中解析
					// Function 模式：传递 tools 参数，由 API 返回结构化工具调用
					const chatOptions = toolCallMode === 'function' && tools.length > 0
						? { tools }
						: {};

					for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, chatOptions)) {
						// 检查中断请求
						if (this.interruptRequested) {
							this.logger.info(`任务 ${runId} 在处理AI响应时被中断`);
							return;
						}
						
						lastChunkTime = Date.now();
						responseStarted = true;

						if (chunk.type === 'content') {
							fullContent = chunk.fullContent || fullContent + (chunk.content || '');
							// Prompt 模式下不实时输出内容（因为是 JSON 格式，需要解析后才输出）
							if (toolCallMode === 'function') {
								yield { type: 'content', content: chunk.content };
							}
						} else if (chunk.type === 'finish') {
							finishReason = chunk.reason || null;
							// Function 模式下直接获取工具调用
							if (toolCallMode === 'function') {
								toolCalls = (chunk.toolCalls || []) as ToolCall[];
							}
						} else if (chunk.type === 'tool_use' && chunk.toolUse) {
							toolCalls.push(chunk.toolUse);
						}
					}
				} finally {
					clearInterval(timeoutCheckInterval);
				}

				// Prompt 模式：解析 JSON 响应
				if (toolCallMode === 'prompt' && fullContent) {
					const parsed = parsePromptResponse(fullContent);
					thinking = parsed.thinking;
					
					// 只在必要时输出AI思考内容（避免输出给用户）
					if (thinking && iteration <= 2) {
						this.logger.debug(`AI 思考: ${thinking.substring(0, 100)}${thinking.length > 100 ? '...' : ''}`);
					}

					// 如果有工具调用
					if (parsed.toolCalls.length > 0) {
						// 转换为标准格式
						toolCalls = parsed.toolCalls.map((tc, idx) => ({
							id: `prompt_${Date.now()}_${idx}`,
							type: 'function' as const,
							function: {
								name: tc.name,
								arguments: JSON.stringify(tc.arguments),
							},
						}));
						// 输出思考内容
						if (thinking) {
							yield { type: 'content', content: thinking };
						}
					} else if (parsed.response) {
						// 有直接回复，输出
						yield { type: 'content', content: parsed.response };
						fullContent = parsed.response;
					} else {
						// 没有解析到有效内容，原样输出
						yield { type: 'content', content: fullContent };
					}
				} else if (toolCallMode === 'function') {
					// Function 模式下的思考内容
					thinking = fullContent || '';
					// 只在必要时输出AI思考内容（避免输出给用户）
					if (thinking && iteration <= 2) {
						this.logger.debug(`AI 思考: ${thinking.substring(0, 100)}${thinking.length > 100 ? '...' : ''}`);
					}
				}

				// 保存 AI 响应
				if (fullContent || toolCalls.length > 0) {
					this.gateway.sessionManager.addMessage(session.id, {
						role: 'assistant',
						content: toolCallMode === 'prompt' ? (thinking || fullContent) : fullContent,
						toolCalls: toolCalls.length > 0 ? this.normalizeToolCalls(toolCalls) : undefined,
					});
				}

				// 检查是否需要执行工具
				if (toolCalls.length === 0 || finishReason === 'stop') {
					// 检查任务完成度（只对第一次完成时进行评估）
					const responseContent = toolCallMode === 'prompt'
						? parsePromptResponse(fullContent).response || fullContent
						: fullContent;

					if (responseContent && iteration > 1) {
						// 检查任务是否完成
						const checkResult = this.checkTaskCompletion(message, responseContent, toolResults);
						
						// 只在必要时输出检查信息
						if (checkResult.completed || checkResult.nextAction === 'ask_clarification') {
							this.logger.info(`任务检查: 完成=${checkResult.completed}, 需要更多工作=${checkResult.needsMoreWork}`);
							if (checkResult.nextAction) {
								this.logger.info(`下一步操作: ${checkResult.nextAction}`);
							}
						}
						
						// 如果任务未完成，继续执行
						if (checkResult.needsMoreWork) {
							// 通过prompt告知AI继续，完全自主判断
							this.gateway.sessionManager.addMessage(session.id, {
								role: 'user',
								content: '任务未完成，请继续处理并提供完整结果。'
							});
							
							// 只在必要时输出继续信息
							if (checkResult.nextAction !== 'ask_clarification') {
								this.logger.info(`🔄 任务未完成，继续执行...`);
							}
							continue; // 继续下一次迭代
						}
					}
					
					// 任务完成或无法继续
					this.logger.info(`AI 响应完成，无工具调用`);
					if (responseContent) {
						this.logger.debug(
							`AI 回复: ${responseContent.substring(0, 200)}${responseContent.length > 200 ? '...' : ''}`
						);
					}
					yield { type: 'done', content: responseContent };
					break;
				}

				// 执行工具调用
				this.logger.info(`AI 请求执行 ${toolCalls.length} 个工具`);
				yield { type: 'tools', count: toolCalls.length, thinking };

				for (const toolCall of toolCalls) {
					const toolName = this.getToolName(toolCall);
					const toolArgs = this.parseToolArgs(toolCall);
					const toolId = this.getToolId(toolCall);

					this.logger.info(`┌─ 执行工具: ${toolName}`);
					this.logger.info(`│  toolId: "${toolId}"`);
					if (!toolId) {
						this.logger.warn(`│  ⚠️ toolCall 没有 ID!`);
					}
					this.logger.info(`│  参数: ${JSON.stringify(toolArgs).substring(0, 200)}`);

					// ========== 搜索关键字验证 ==========
					const searchKeyword = this.validateSearchKeyword(toolName, toolArgs);
					if (searchKeyword) {
						this.logger.info(`│  🔍 搜索关键字: "${searchKeyword}"`);
					}

					// 附带 AI 的思考内容
					yield { type: 'tool_start', tool: toolName, args: toolArgs, thinking };

					// 调试模式：如果是点击操作，先生成预览图并等待确认
					if (debugMode && toolName === 'computer') {
						const action = toolArgs.action as string;
						const coordinate = toolArgs.coordinate as [number, number] | undefined;
						const elementName = toolArgs.element_name as string | undefined;
						
						// 需要调试的操作类型
						const isClickAction = ['left_click', 'right_click', 'double_click'].includes(action);
						const isClickElement = action === 'click_element' && elementName;
						const isTypeAction = action === 'type' && toolArgs.text;
						const isKeyAction = action === 'key' || action === 'hotkey';
						
						// 任何可能影响状态的操作都需要确认
						const needsConfirmation = isClickAction || isClickElement || isTypeAction || isKeyAction;

						if (needsConfirmation) {
							this.logger.info(`│  [调试模式] ${action} 操作，等待确认...`);

							// 生成调试数据
							const debugData: DebugData = {
								thinking,
							};
							
							// 构建操作描述
							if (isClickAction && coordinate) {
								debugData.action = `${action} at (${coordinate[0]}, ${coordinate[1]})`;
								debugData.coordinate = coordinate;
							} else if (isClickElement) {
								debugData.action = `click_element: "${elementName}"`;
							} else if (isTypeAction) {
								debugData.action = `type: "${(toolArgs.text as string).substring(0, 50)}"`;
							} else if (action === 'key') {
								debugData.action = `key: ${toolArgs.key}`;
							} else if (action === 'hotkey') {
								debugData.action = `hotkey: ${(toolArgs.keys as string[])?.join('+')}`;
							}

							// 如果有缓存的截图，使用它
							if (debugCache.lastScreenshot) {
								debugData.originalImage = debugCache.lastScreenshot;
								debugData.markedImage = debugCache.lastMarkedImage;
								debugData.elements = debugCache.lastElements;

								// 如果有坐标，生成点击位置预览图
								if (coordinate) {
									try {
										debugData.clickImage = await drawClickPosition(
											debugCache.lastScreenshot,
											coordinate,
											`点击 (${coordinate[0]}, ${coordinate[1]})`
										);
									} catch (e) {
										this.logger.warn('生成点击预览图失败:', (e as Error).message);
									}
								}
								
								// 保存调试图片和详细信息到文件夹
								debugCache.stepCount++;
								try {
									// 构建详细调试信息
									// 注意：debugCache.lastElements 是 screenshot 工具返回的格式，包含 center 和 mouseCenter
									const fullDebugInfo: DebugInfo = {
										action: debugData.action,
										thinking,
										toolName,
										toolArgs: toolArgs as Record<string, unknown>,
										coordinate,
										elements: debugCache.lastElements?.map(el => {
											// el 可能是 screenshot 返回的格式 (有 center/mouseCenter) 
											// 或者是 DebugElement 格式 (有 box)
											const anyEl = el as { 
												id: number; 
												text?: string; 
												type?: string;
												box?: [number, number, number, number];
												center?: [number, number];
												mouseCenter?: [number, number];
											};
											return {
												id: anyEl.id,
												type: anyEl.type,
												text: anyEl.text,
												box: anyEl.box,
												center: anyEl.center || (anyEl.box ? [
													Math.round((anyEl.box[0] + anyEl.box[2]) / 2),
													Math.round((anyEl.box[1] + anyEl.box[3]) / 2),
												] as [number, number] : undefined),
												mouseCenter: anyEl.mouseCenter,
											};
										}),
										screenInfo: debugCache.lastScreenInfo,
									};
									
									await saveDebugImages(
										debugCache.stepCount,
										{
											original: debugCache.lastScreenshot,
											marked: debugCache.lastMarkedImage,
											click: debugData.clickImage,
										},
										fullDebugInfo
									);
								} catch (e) {
									this.logger.warn('保存调试图片失败:', (e as Error).message);
								}
							}

							// 发送调试确认请求
							const confirmId = generateId('debug');
							yield {
								type: 'debug_confirm',
								tool: toolName,
								args: toolArgs,
								debug: debugData,
								confirmId,
								thinking,
							};

							// 等待用户确认
							this.logger.info(`│  [调试模式] 等待用户确认...`);
							try {
								const approved = await waitForConfirmation(confirmId);
								if (!approved) {
									this.logger.info(`│  [调试模式] 用户取消操作，终止任务`);
									// 保存取消消息到会话
									this.gateway.sessionManager.addMessage(session.id, {
										role: 'assistant',
										content: '🛑 调试模式：用户取消了操作，任务已终止。',
									});
									yield { type: 'terminated', reason: '调试模式：用户取消了操作' };
									return; // 直接终止整个任务
								}
								// 延迟 3 秒执行，给用户时间切换回目标窗口
								this.logger.info(`│  [调试模式] 用户确认，3秒后执行...`);
								yield { type: 'status', status: '⏳ 3秒后执行，请切换到目标窗口...' };
								await new Promise(resolve => setTimeout(resolve, 3000));
								this.logger.info(`│  [调试模式] 开始执行`);
							} catch (e) {
								this.logger.warn(`│  [调试模式] 确认超时或失败:`, (e as Error).message);
								// 超时也终止任务
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'assistant',
									content: '⏱️ 调试模式：确认超时，任务已终止。',
								});
								yield { type: 'terminated', reason: '调试模式：确认超时' };
								return;
							}
						}
					}

					// 沙盒安全检查
					const operationInfo = securityGuard.extractOperationInfo(toolName, toolArgs as Record<string, unknown>);
					const securityCheck = await securityGuard.check(operationInfo);
					
					if (!securityCheck.allowed) {
						if (securityCheck.action === 'block') {
							// 操作被禁止
							this.logger.warn(`🚫 操作被安全系统阻止: ${securityCheck.reason}`);
							yield { 
								type: 'tool_result', 
								tool: toolName, 
								result: { 
									success: false, 
									blocked: true,
									error: securityCheck.message || securityCheck.reason,
								}
							};
							
							// 添加消息到会话
							this.gateway.sessionManager.addMessage(session.id, {
								role: 'tool',
								content: JSON.stringify({ 
									success: false, 
									blocked: true, 
									error: securityCheck.message 
								}),
								metadata: { toolCallId: toolId, toolName },
							});

							// 收集工具被阻止的结果
							toolResults.push({
								toolName,
								toolArgs,
								result: { 
									success: false, 
									blocked: true, 
									error: securityCheck.message 
								},
								success: false,
								action: toolArgs.action || 'unknown'
							});
							
							// 继续处理下一个工具调用
							continue;
						} else if (securityCheck.action === 'confirm') {
							// 需要用户确认
							this.logger.info(`🔐 操作需要用户确认: ${securityCheck.reason}`);
							
							const confirmId = generateId('security');
							yield {
								type: 'security_confirm',
								tool: toolName,
								args: toolArgs,
								confirmId,
								message: securityCheck.confirmMessage || securityCheck.reason,
								category: securityCheck.category,
							};
							
							// 等待用户确认
							try {
								const approved = await waitForConfirmation(confirmId);
								if (!approved) {
									this.logger.info(`❌ 用户拒绝了操作`);
									yield { 
										type: 'tool_result', 
										tool: toolName, 
										result: { 
											success: false, 
											cancelled: true,
											error: '用户取消了操作',
										}
									};
									
									this.gateway.sessionManager.addMessage(session.id, {
										role: 'tool',
										content: JSON.stringify({ success: false, cancelled: true }),
										metadata: { toolCallId: toolId, toolName },
									});

									// 收集用户取消操作的结果
									toolResults.push({
										toolName,
										toolArgs,
										result: { success: false, cancelled: true },
										success: false,
										action: toolArgs.action || 'unknown'
									});
									
									continue;
								}
								this.logger.info(`✅ 用户确认了操作`);
							} catch (e) {
								this.logger.warn(`⏱️ 确认超时: ${(e as Error).message}`);
								yield { 
									type: 'tool_result', 
									tool: toolName, 
									result: { 
										success: false, 
										timeout: true,
										error: '确认超时',
									}
								};
								
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'tool',
									content: JSON.stringify({ success: false, timeout: true }),
									metadata: { toolCallId: toolId, toolName },
								});
								
								continue;
							}
						}
					}

					const toolStartTime = Date.now();
					try {
						const result = await this.gateway.executeTool(toolName, toolArgs);
						const toolDuration = Date.now() - toolStartTime;

						// 格式化结果用于日志
						const resultStr =
							typeof result === 'string'
								? result.substring(0, 300)
								: JSON.stringify(result).substring(0, 300);
						this.logger.info(`│  结果: ${resultStr}${resultStr.length >= 300 ? '...' : ''}`);
						this.logger.info(`└─ 完成 (${toolDuration}ms)`);

						// ========== 浏览器上下文跟踪 ==========
						if (toolName === 'browser') {
							const browserResult = result as {
								success?: boolean;
								url?: string;
								title?: string;
								action?: string;
							};
							// 跟踪成功操作后的页面上下文（goto、snapshot 等）
							if (browserResult.success && (browserResult.url || browserResult.title)) {
								this.gateway.sessionManager.setBrowserContext(session.id, {
									url: browserResult.url,
									title: browserResult.title,
								});
								this.logger.debug(`📍 浏览器上下文已更新: ${browserResult.url}`);
							}
						}

						// 调试模式：如果是截图工具，缓存截图（OCR-SoM 结果已由 screenshot 工具返回）
						if (debugMode && toolName === 'screenshot') {
							const screenshotResult = result as { 
								success?: boolean; 
								base64?: string;
								markedImage?: string;
								elements?: DebugElement[];
								imageSize?: string;
								mouseCoordSize?: string;
								scale?: number;
							};
							if (screenshotResult.success && screenshotResult.base64) {
								debugCache.lastScreenshot = screenshotResult.base64;
								// 使用 screenshot 工具返回的 OCR-SoM 结果
								if (screenshotResult.markedImage) {
									debugCache.lastMarkedImage = screenshotResult.markedImage;
								}
								if (screenshotResult.elements) {
									debugCache.lastElements = screenshotResult.elements;
								}
								// 保存屏幕信息
								debugCache.lastScreenInfo = {
									imageSize: screenshotResult.imageSize,
									mouseCoordSize: screenshotResult.mouseCoordSize,
									scale: screenshotResult.scale,
								};
								this.logger.info(`│  [调试模式] 截图已缓存${screenshotResult.elements ? `，包含 ${screenshotResult.elements.length} 个元素` : ''}`);
							}
						}

						yield { type: 'tool_result', tool: toolName, result };

						// 检查是否是浏览器扩展未连接的致命错误
						if (toolName === 'browser') {
							const browserResult = result as { success?: boolean; message?: string };
							if (
								browserResult.success === false &&
								browserResult.message?.includes('浏览器扩展未连接')
							) {
								this.logger.warn('浏览器扩展未连接，终止 Agent 运行');

								// 添加工具结果消息
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'tool',
									content: JSON.stringify(result),
									metadata: { toolCallId: toolId, toolName },
								});

								// 返回终止事件给前端
								yield {
									type: 'terminated',
									reason: 'extension_not_connected',
									content: browserResult.message,
								};
								return; // 终止 Agent 运行
							}
						}

						// 处理工具结果 - 特殊处理截图等大数据
						const processed = this.processToolResult(toolName, result, hasVision);

						// 添加工具结果消息
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: processed.content,
							metadata: {
								toolCallId: toolId,
								toolName,
								isMultimodal: processed.isMultimodal,
							},
						});

						// 收集工具执行结果用于任务完成度评估
						toolResults.push({
							toolName,
							toolArgs,
							result,
							success: true,
							action: toolArgs.action || 'unknown'
						});
					} catch (error) {
						const toolDuration = Date.now() - toolStartTime;
						this.logger.error(`│  错误: ${(error as Error).message}`);
						this.logger.error(`└─ 失败 (${toolDuration}ms)`);
						yield { type: 'tool_error', tool: toolName, error: (error as Error).message };

						// 添加错误消息
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: JSON.stringify({ error: (error as Error).message }),
							metadata: { toolCallId: toolId, toolName, error: true },
						});

						// 收集工具执行失败结果
						toolResults.push({
							toolName,
							toolArgs,
							result: { error: (error as Error).message },
							success: false,
							action: toolArgs.action || 'unknown'
						});
					}
				}

				// 继续循环，让 AI 处理工具结果
			}

			// 超过最大迭代 - 强制让 AI 返回总结
			if (iteration >= maxIterations) {
				this.logger.warn(`达到最大迭代次数 ${maxIterations}，强制生成总结...`);

				// 添加一条系统消息，要求 AI 总结
				this.gateway.sessionManager.addMessage(session.id, {
					role: 'user',
					content:
						'[系统提示] 已达到最大操作次数限制。请立即停止所有工具调用，根据目前已收集到的信息，给用户一个总结回复。如果任务未完成，请说明已完成的部分和未完成的原因。',
				});

				// 让 AI 生成最终响应（不允许工具调用）
				const messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt,
					maxMessages: 30,
				});

				// 详细调试：打印消息历史
				this.logger.debug('===== 发送给 OpenAI 的消息（强制总结）=====');
				for (let i = 0; i < messages.length; i++) {
					const msg = messages[i];
					if (msg.role === 'tool') {
						const hasId = (msg as any).tool_call_id;
						if (!hasId) {
							this.logger.warn(`⚠️ tool 消息缺少 tool_call_id!`);
						}
					}
				}
				this.logger.debug('===================================');

				for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, {
					tools: undefined, // 不提供工具，强制文字回复
				})) {
					// 检查中断请求
					if (this.interruptRequested) {
						this.logger.info(`任务 ${runId} 在生成最终回复时被中断`);
						return;
					}
					if (chunk.type === 'content') {
						yield { type: 'content', content: chunk.content };
					}
				}

				yield { type: 'max_iterations', iterations: iteration };
			}

			const duration = Date.now() - startTime;
			this.logger.info(`Agent 运行完成: ${runId} (${duration}ms)`);
		} catch (error) {
			this.logger.error(`Agent 运行失败: ${runId}`, (error as Error).message);
			yield { type: 'error', error: (error as Error).message };
		} finally {
			// 清理状态
			this.currentRunId = null;
			this.interruptRequested = false;
		}
		// 注意：不自动关闭浏览器！让用户决定是否关闭
		// 浏览器只有在用户明确要求"关闭浏览器"时才会关闭
	}

	/**
	 * 获取工具名称
	 */
	private getToolName(toolCall: ToolCall | ToolUse): string {
		if ('function' in toolCall && toolCall.function) {
			return toolCall.function.name;
		}
		if ('name' in toolCall) {
			return toolCall.name;
		}
		return '';
	}

	/**
	 * 获取工具 ID
	 */
	private getToolId(toolCall: ToolCall | ToolUse): string {
		return toolCall.id || '';
	}

	/**
	 * 解析工具参数
	 */
	private parseToolArgs(toolCall: ToolCall | ToolUse): Record<string, unknown> {
		// OpenAI 格式
		if ('function' in toolCall && toolCall.function?.arguments) {
			return safeParseJSON(toolCall.function.arguments, {});
		}
		// Anthropic 格式
		if ('input' in toolCall && toolCall.input) {
			return typeof toolCall.input === 'string' ? safeParseJSON(toolCall.input, {}) : toolCall.input;
		}
		return {};
	}

	/**
	 * 标准化工具调用格式
	 */
	private normalizeToolCalls(toolCalls: Array<ToolCall | ToolUse>): ToolCall[] {
		return toolCalls.map((tc) => {
			if ('function' in tc) {
				return tc as ToolCall;
			}
			// 转换 ToolUse 为 ToolCall
			const toolUse = tc as ToolUse;
			return {
				id: toolUse.id,
				type: 'function' as const,
				function: {
					name: toolUse.name,
					arguments: JSON.stringify(toolUse.input),
				},
			};
		});
	}

	/**
	 * 处理工具结果 - 特殊处理截图等大数据
	 * @param hasVision - 当前模型是否支持 Vision
	 */
	private processToolResult(
		toolName: string,
		result: unknown,
		hasVision: boolean
	): { content: string | ContentBlock[]; isMultimodal: boolean } {
		// 截图工具特殊处理
		if (toolName === 'screenshot') {
			const screenshotResult = result as {
				success: boolean;
				base64?: string;
				path?: string;
				screens?: unknown[];
				// OCR-SoM 相关
				ocrEnabled?: boolean;
				markedImage?: string;
				elements?: Array<{
					id: number;
					type: string;
					text: string;
					center: [number, number];
					box: [number, number, number, number];
				}>;
				scale?: number;
				coordinateHelp?: string;
				ocrError?: string;
				ocrFatal?: boolean;
			};

			// 检查 OCR 致命错误
			if (screenshotResult.ocrFatal && screenshotResult.ocrError) {
				const errorMsg = `❌ OCR-SoM 服务出现致命错误，视觉能力不可用！

**错误信息**: ${screenshotResult.ocrError}

**可能的解决方案**:
1. 检查 OCR-SoM 服务是否正常运行
2. 如果使用 GPU 版本，可能缺少 CUDA/cuDNN 库
3. 尝试在 Set-of-Mark 目录运行: \`python install.py --cpu\` 安装 CPU 版本
4. 或者禁用 OCR: 在配置中设置 \`ocr.enabled: false\`

当前无法继续执行需要视觉能力的任务。`;
				
				return {
					content: errorMsg,
					isMultimodal: false,
				};
			}

			if (screenshotResult.base64) {
				const sizeKB = Math.round((screenshotResult.base64.length * 0.75) / 1024);

				if (hasVision) {
					// Vision 模式：返回多模态内容
					const content: ContentBlock[] = [];
					
					// 如果有 OCR-SoM 结果，包含标注图和元素列表
					if (screenshotResult.ocrEnabled && screenshotResult.elements && screenshotResult.markedImage) {
						// 元素列表以 JSON 格式发送
						const elementsJson = JSON.stringify(screenshotResult.elements, null, 2);
						
						content.push({
							type: 'text',
							text: `## 元素列表（OCR-SoM 识别结果）
共 ${screenshotResult.elements.length} 个元素：
${elementsJson}

⚠️ **坐标使用规则**：

### 情况1：目标元素在列表中（优先）
直接使用该元素的 center 坐标，不要估算！

### 情况2：目标元素不在列表中（如空输入框、空白区域）
**结合视觉分析 + 周围元素推断**：
1. 仔细观察截图，用你的视觉理解能力定位目标区域
2. 找到目标附近已识别的元素作为参照点
3. 根据参照点的坐标，推算目标的大致位置
4. 结合界面布局常识和视觉观察来确定坐标

## 原始截图（未标注）`,
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/jpeg;base64,${screenshotResult.base64}` },
						});
						content.push({
							type: 'text', 
							text: `\n## 标注截图（带编号）`,
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/png;base64,${screenshotResult.markedImage}` },
						});
					} else {
						// 没有 OCR-SoM，只返回原始截图
						content.push({ 
							type: 'text', 
							text: `截图成功 (${sizeKB}KB)。${screenshotResult.coordinateHelp || ''}
请分析图片内容：` 
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/jpeg;base64,${screenshotResult.base64}` },
						});
					}
					
					return { content, isMultimodal: true };
				} else {
					// 非 Vision 模式：不应该走到这里（工具已被过滤），但以防万一
					return {
						content: JSON.stringify({
							success: screenshotResult.success,
							error: '当前模型不支持图像理解，无法分析截图',
						}),
						isMultimodal: false,
					};
				}
			}

			// 保存到文件或列出屏幕
			return {
				content: JSON.stringify(result),
				isMultimodal: false,
			};
		}

		// browser 工具的特殊处理
		if (toolName === 'browser') {
			const browserResult = result as { 
				success: boolean; 
				base64?: string;
				action?: string;
				compressedText?: string;
				searchAnalysis?: any;
				elements?: any[];
				url?: string;
				title?: string;
				text?: string;
			};

			// 处理browser的截图操作
			if (browserResult.base64) {
				const sizeKB = Math.round((browserResult.base64.length * 0.75) / 1024);

				if (hasVision) {
					return {
						content: [
							{ type: 'text', text: `浏览器截图成功 (${sizeKB}KB)：` },
							{ type: 'image_url', image_url: { url: `data:image/png;base64,${browserResult.base64}` } },
						],
						isMultimodal: true,
					};
				} else {
					return {
						content: JSON.stringify({
							success: browserResult.success,
							message: `截图成功 (${sizeKB}KB)。建议使用 snapshot 获取页面元素列表。`,
						}),
						isMultimodal: false,
					};
				}
			}

			// 处理browser的snapshot操作 - 关键修复！
			if (browserResult.action === 'snapshot' || browserResult.compressedText) {
				const content: ContentBlock[] = [];

				// 如果有压缩文本，先返回压缩文本（这是关键！）
				if (browserResult.compressedText) {
					content.push({
						type: 'text',
						text: `## 🗜️ 页面结构分析（增强版）

${browserResult.compressedText}

⚠️ **重要提示**：请重点关注上述分析结果，特别是搜索功能检测和任务执行建议。`,
					});
				}

				// 添加原始元素列表（向后兼容）
				if (browserResult.elements && browserResult.elements.length > 0) {
					const elementsJson = JSON.stringify(browserResult.elements, null, 2);
					content.push({
						type: 'text',
						text: `## 📋 原始元素列表（共 ${browserResult.elements.length} 个元素）

\`\`\`json
${elementsJson}
\`\`\`

**使用说明**：优先使用上面的结构化分析结果，如果需要具体元素信息，可参考此列表。`,
					});
				}

				// 如果有页面基本信息，也添加
				if (browserResult.url || browserResult.title) {
					content.push({
						type: 'text',
						text: `**当前页面**：${browserResult.url || '未知URL'} - ${browserResult.title || '未知标题'}`,
					});
				}

				return {
					content,
					isMultimodal: false,
				};
			}
		}

		// 其他工具直接返回
		return {
			content: typeof result === 'string' ? result : JSON.stringify(result),
			isMultimodal: false,
		};
	}

	/**
	 * 验证搜索关键字
	 * 检测常见问题：关键字过短、缺少字符等
	 * @returns 验证通过返回关键字，否则返回 null
	 */
	private validateSearchKeyword(toolName: string, args: Record<string, unknown>): string | null {
		// 只对 browser/web 工具进行搜索验证
		if (toolName !== 'browser' && toolName !== 'web') {
			return null;
		}

		// 提取搜索关键字
		let keyword: string | undefined;

		if (toolName === 'browser') {
			// browser 工具的搜索参数
			const action = args.action as string;
			if (action === 'goto' || action === 'search') {
				keyword = args.url as string | undefined;
				// 如果是 search action，text 字段是搜索内容
				if (action === 'search') {
					keyword = args.text as string | undefined;
				}
			}
		} else if (toolName === 'web') {
			// web 工具的参数
			keyword = args.query as string | undefined;
			if (!keyword && Array.isArray(args.query)) {
				keyword = (args.query as string[]).join(' ');
			}
		}

		if (!keyword) return null;

		// 清理关键字
		keyword = keyword.trim();
		if (!keyword) return null;

		// 过滤掉 URL（只验证搜索词）
		if (keyword.startsWith('http://') || keyword.startsWith('https://')) {
			return null;
		}

		// ========== 验证逻辑 ==========

		// 1. 检查关键字是否过短（中文至少 2 个字符，英文至少 3 个字符）
		// 统计中文字符数量
		const chineseChars = keyword.match(/[\u4e00-\u9fa5]/g);
		const chineseCount = chineseChars ? chineseChars.length : 0;
		const totalChars = keyword.length;

		if (chineseCount >= 2) {
			// 中文搜索：检查是否可能丢失字符
			// 常见问题：4 字词变成 3 字（如"影视飓风"变成"影视风"）
			if (chineseCount === 3 && totalChars === 3) {
				// 3 个中文字符，可能是丢字
				this.logger.warn(`│  ⚠️ 搜索关键字 "${keyword}" 只有 3 个中文字符，可能缺少字符`);
			}
		} else if (chineseCount === 1 && totalChars <= 4) {
			// 只有 1 个中文字符，加上一些其他字符
			this.logger.warn(`│  ⚠️ 搜索关键字 "${keyword}" 只有一个中文字符 "${chineseChars?.[0]}"，可能缺少字符`);
		}

		// 2. 检查英文/数字为主的关键字
		const englishChars = keyword.match(/[a-zA-Z]/g);
		const digitChars = keyword.match(/[0-9]/g);
		if (!englishChars && !digitChars && chineseCount >= 2 && totalChars < 4) {
			// 只有中文字符且少于 4 个
			this.logger.warn(`│  ⚠️ 搜索关键字 "${keyword}" 较短，请确认完整性`);
		}

		// 3. 特殊模式检测：明显的字符丢失模式
		// 如 "xx风" 可能来自 "影视飓风"（丢掉了"飓"）
		const missingCharPatterns = [
			{ pattern: /^(影视).*风$/, expected: '影视飓风', missing: '飓' },
			{ pattern: /^(.*)风$/, expected: null, missing: '前导字符' },
		];

		for (const { pattern, expected, missing } of missingCharPatterns) {
			if (pattern.test(keyword)) {
				if (expected) {
					this.logger.warn(`│  ⚠️ 搜索关键字 "${keyword}" 可能不完整，参考: "${expected}"（缺少 "${missing}"）`);
				}
			}
		}

		return keyword;
	}

	/**
	 * 分析截图
	 */
	async analyzeScreenshot(
		screenshotBase64: string,
		task: string,
		options: { model?: string } = {}
	): Promise<Record<string, unknown>> {
		const { provider, model } = this.gateway.providerManager.resolveModel(options.model);

		const prompt = `分析这个屏幕截图，并根据以下任务生成操作指令：

任务：${task}

请返回 JSON 格式的分析结果：
{
  "status": "continue|complete|error",
  "description": "当前屏幕状态描述",
  "actions": [
    {
      "type": "click|type|scroll|key",
      "params": { ... }
    }
  ],
  "reasoning": "推理过程"
}`;

		const messages = [
			{
				role: 'user' as const,
				content: [
					{ type: 'text' as const, text: prompt },
					{ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
				],
			},
		];

		let fullContent = '';
		for await (const chunk of provider.chat(messages, { model, maxTokens: 2000 })) {
			if (chunk.type === 'content' && chunk.content) {
				fullContent += chunk.content;
			}
		}

		return safeParseJSON(fullContent, { status: 'error', description: 'Failed to parse response' });
	}
}

export { SessionManager };
export default Agent;
