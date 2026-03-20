import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../utils/api';

export const useAppStore = defineStore('app', () => {
	// 状态
	const connected = ref(false);
	const ws = ref(null);
	const sessions = ref([]);
	const currentSessionId = ref(null);
	const messages = ref([]);
	const providers = ref([]);
	const tools = ref([]);
	const toolsGrouped = ref({ builtin: [], mcp: [] });
	const config = ref({});

	// Agent Profiles
	const agents = ref([]);
	const currentAgentId = ref('default');

	// 实时状态
	const currentStatus = ref(null); // 当前执行状态
	const toolExecutions = ref([]); // 工具执行历史

	// 步骤流数据 - 用于新的时间线UI
	const processingSteps = ref([]); // 当前处理的步骤列表
	const currentStep = ref(null); // 当前正在进行的步骤

	// 调试模式
	const debugConfirm = ref(null); // 当前等待确认的调试数据

	// 沙盒安全
	const securityConfirm = ref(null); // 当前等待确认的安全操作

	// 实时日志
	const logs = ref([]); // 日志列表
	const maxLogs = 1000; // 最大日志条数

	// ========== 连接状态管理 ==========
	const connectionStatus = ref({
		lastUpdate: null,
	});
	const heartbeatTimer = ref(null);
	const HEARTBEAT_INTERVAL = 3000; // 3秒心跳（更快响应）

	// 启动心跳检测
	const startHeartbeat = () => {
		stopHeartbeat();
		// 立即检查一次
		checkConnectionStatus();
		heartbeatTimer.value = setInterval(checkConnectionStatus, HEARTBEAT_INTERVAL);
	};

	// 停止心跳检测
	const stopHeartbeat = () => {
		if (heartbeatTimer.value) {
			clearInterval(heartbeatTimer.value);
			heartbeatTimer.value = null;
		}
	};

	// 检查连接状态
	const checkConnectionStatus = async () => {
		try {
			connectionStatus.value = {
				lastUpdate: new Date().toISOString(),
			};
		} catch (error) {
			console.error('Failed to check connection status:', error);
		}
	};

	// 计算属性
	const currentSession = computed(() => {
		return sessions.value.find((s) => s.id === currentSessionId.value);
	});

	// 方法
	const setConnected = (value) => {
		connected.value = value;
	};

	const setWebSocket = (websocket) => {
		ws.value = websocket;
	};

	// 提取工具结果的简洁描述
	const extractToolResultContent = (toolName, result) => {
		if (!result) return null;

		try {
			// browser 工具
			if (toolName === 'browser') {
				const br = typeof result === 'string' ? JSON.parse(result) : result;
				if (!br.success) return `操作失败`;

				// 如果有 aiSummary（snapshot 操作）
				if (br.aiSummary) {
					return br.aiSummary;
				}

				// 根据 action 生成描述
				const action = br.action;
				if (action === 'goto') return `已访问 ${br.url || ''}`;
				if (action === 'open') return '浏览器已打开';
				if (action === 'close') return '浏览器已关闭';
				if (action === 'screenshot') return '截图已保存';
				if (action === 'click') return '已点击元素';
				if (action === 'type') return '已输入文本';
				if (action === 'scroll') return '已滚动页面';
				if (action === 'search') return `已搜索: ${br.url || ''}`;

				return br.message || '操作完成';
			}

			// screenshot 工具
			if (toolName === 'screenshot') {
				const sr = typeof result === 'string' ? JSON.parse(result) : result;
				if (sr.success) {
					return `截图成功: ${sr.filename || '已保存'}`;
				}
				return `截图失败: ${sr.error || '未知错误'}`;
			}

			// computer 工具
			if (toolName === 'computer') {
				const cr = typeof result === 'string' ? JSON.parse(result) : result;
				if (cr.success) {
					return cr.message || '操作完成';
				}
				return `操作失败: ${cr.error || '未知错误'}`;
			}

			// exec 工具
			if (toolName === 'exec') {
				const er = typeof result === 'string' ? JSON.parse(result) : result;
				if (er.success) {
					const output = er.stdout || er.output || '';
					if (output.length > 200) {
						return output.substring(0, 200) + '...\n(命令执行成功)';
					}
					return output || '命令执行成功';
				}
				return `命令执行失败: ${er.error || '未知错误'}`;
			}

			// 其他工具
			return JSON.stringify(result).substring(0, 200);
		} catch {
			return String(result).substring(0, 200);
		}
	};

	const handleMessage = (message) => {
		switch (message.type) {
			case 'connected':
				console.log('Connected to server:', message.clientId);
				break;
			case 'chat:chunk':
				handleChatChunk(message);
				break;
			case 'chat:done':
				handleChatDone(message);
				break;
			case 'chat:error':
				handleChatError(message);
				break;
			case 'chat:interrupted':
				handleChatInterrupted(message);
				break;
			case 'chat:interrupt_error':
				handleChatInterruptError(message);
				break;
			case 'event':
				handleEvent(message);
				break;
			case 'log':
				// 单条日志
				handleLog(message.entry);
				break;
			case 'log_history':
				// 历史日志
				logs.value = message.logs || [];
				break;
		}
	};

	const handleLog = (entry) => {
		if (!entry) return;
		logs.value.push(entry);
		// 限制日志条数
		if (logs.value.length > maxLogs) {
			logs.value = logs.value.slice(-maxLogs);
		}
	};

	const clearLogs = () => {
		logs.value = [];
	};

	// 添加或更新步骤
	const addOrUpdateStep = (stepData) => {
		const existingIndex = processingSteps.value.findIndex(s => s.step === stepData.step);
		if (existingIndex !== -1) {
			// 更新现有步骤
			processingSteps.value[existingIndex] = { ...processingSteps.value[existingIndex], ...stepData };
		} else {
			// 添加新步骤
			processingSteps.value.push(stepData);
		}
		currentStep.value = stepData;
	};

	const handleChatChunk = (message) => {
		const chunk = message.chunk;
		const lastMessage = messages.value[messages.value.length - 1];

		switch (chunk.type) {
			case 'thinking':
				currentStatus.value = { type: 'thinking', iteration: chunk.iteration, step: chunk.step };
				// 初始化步骤
				if (chunk.step) {
					addOrUpdateStep({
						step: chunk.step,
						type: 'thinking',
						status: 'running',
						thinking: '',
						tools: [],
						summary: '',
					});
				}
				break;

			case 'step_thinking':
				// 步骤中的实时思考内容
				if (chunk.step) {
					addOrUpdateStep({
						step: chunk.step,
						type: 'thinking',
						status: 'running',
						thinking: (processingSteps.value.find(s => s.step === chunk.step)?.thinking || '') + (chunk.content || ''),
					});
				}
				// 同时更新消息
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
					lastMessage.thinkingContent = (lastMessage.thinkingContent || '') + (chunk.content || '');
				}
				currentStatus.value = { type: 'generating', step: chunk.step };
				break;

			case 'step_summary':
				// 步骤总结内容
				if (chunk.step) {
					addOrUpdateStep({
						step: chunk.step,
						type: 'summary',
						status: 'running',
						summary: (processingSteps.value.find(s => s.step === chunk.step)?.summary || '') + (chunk.content || ''),
					});
				}
				// 同时更新消息
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
					lastMessage.content = (lastMessage.content || '') + (chunk.content || '');
				}
				currentStatus.value = { type: 'summarizing', step: chunk.step };
				break;

			case 'content':
				// 兼容旧版本，直接追加到消息内容
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
					lastMessage.content = (lastMessage.content || '') + (chunk.content || '');
				}
				currentStatus.value = { type: 'generating' };
				break;

			case 'tools':
				currentStatus.value = { type: 'tools', count: chunk.count, step: chunk.step };
				break;

			case 'tool_start':
				// 提取 action 从 args 中
				let action = '';
				try {
					const args = typeof chunk.args === 'string' ? JSON.parse(chunk.args) : chunk.args;
					action = args?.action || args?.method || '';
				} catch {
					action = '';
				}
				currentStatus.value = {
					type: 'tool_running',
					tool: chunk.tool,
					action: action,
					args: chunk.args,
					description: chunk.description,
					step: chunk.step,
				};
				// 添加到步骤流
				if (chunk.step) {
					const step = processingSteps.value.find(s => s.step === chunk.step);
					if (step) {
						if (!step.tools) step.tools = [];
						step.tools.push({
							id: `${chunk.tool}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
							name: chunk.tool,
							action: action,
							params: chunk.args,
							status: 'running',
							description: chunk.description,
							startTime: Date.now(),
						});
					}
				}
				toolExecutions.value.push({
					id: Date.now(),
					tool: chunk.tool,
					action: action,
					args: chunk.args,
					status: 'running',
					startTime: Date.now(),
					step: chunk.step,
				});
				// 在当前消息中添加工具调用记录
				if (lastMessage && lastMessage.role === 'assistant') {
					if (!lastMessage.toolCalls) lastMessage.toolCalls = [];
					lastMessage.toolCalls.push({
						id: `${chunk.tool}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						name: chunk.tool,
						action: action,
						params: chunk.args,
						status: 'running',
						description: chunk.description,
						startTime: Date.now(),
					});
				}
				break;

			case 'tool_result':
				currentStatus.value = {
					type: 'tool_done',
					tool: chunk.tool,
					step: chunk.step,
				};
				// 更新步骤流中的工具状态
				if (chunk.step) {
					const step = processingSteps.value.find(s => s.step === chunk.step);
					if (step && step.tools) {
						const tool = step.tools.findLast(t => t.name === chunk.tool && t.status === 'running');
						if (tool) {
							tool.status = 'success';
							tool.result = chunk.result;
							tool.duration = Date.now() - tool.startTime;
						}
					}
				}
				// 更新工具执行状态 - 找到最后一个正在运行的同名工具
				const runningToolIndex = toolExecutions.value.findLastIndex((t) => t.tool === chunk.tool && t.status === 'running');
				if (runningToolIndex !== -1) {
					toolExecutions.value[runningToolIndex].status = 'success';
					toolExecutions.value[runningToolIndex].result = chunk.result;
					toolExecutions.value[runningToolIndex].duration = Date.now() - toolExecutions.value[runningToolIndex].startTime;
				}

				// 更新最后一条助手消息的工具调用状态（合并到同一条消息）
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.toolCalls) {
					const toolCallIndex = lastMessage.toolCalls.findLastIndex((t) => t.name === chunk.tool && t.status === 'running');
					if (toolCallIndex !== -1) {
						lastMessage.toolCalls[toolCallIndex].status = 'success';
						lastMessage.toolCalls[toolCallIndex].result = chunk.result;
						lastMessage.toolCalls[toolCallIndex].duration = Date.now() - lastMessage.toolCalls[toolCallIndex].startTime;
					}
				}
				break;

			case 'tool_error':
				currentStatus.value = {
					type: 'tool_error',
					tool: chunk.tool,
					error: chunk.error,
					step: chunk.step,
				};
				// 更新步骤流中的工具状态
				if (chunk.step) {
					const step = processingSteps.value.find(s => s.step === chunk.step);
					if (step && step.tools) {
						const tool = step.tools.findLast(t => t.name === chunk.tool && t.status === 'running');
						if (tool) {
							tool.status = 'error';
							tool.error = chunk.error;
							tool.duration = Date.now() - tool.startTime;
						}
					}
				}
				// 更新工具执行状态 - 找到最后一个正在运行的同名工具
				const errorToolIndex = toolExecutions.value.findLastIndex((t) => t.tool === chunk.tool && t.status === 'running');
				if (errorToolIndex !== -1) {
					toolExecutions.value[errorToolIndex].status = 'error';
					toolExecutions.value[errorToolIndex].error = chunk.error;
					toolExecutions.value[errorToolIndex].duration = Date.now() - toolExecutions.value[errorToolIndex].startTime;
				}

				// 更新最后一条助手消息的工具调用状态（合并到同一条消息）
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.toolCalls) {
					const toolCallIndex = lastMessage.toolCalls.findLastIndex((t) => t.name === chunk.tool && t.status === 'running');
					if (toolCallIndex !== -1) {
						lastMessage.toolCalls[toolCallIndex].status = 'error';
						lastMessage.toolCalls[toolCallIndex].result = { error: chunk.error };
						lastMessage.toolCalls[toolCallIndex].duration = Date.now() - lastMessage.toolCalls[toolCallIndex].startTime;
					}
				}
				break;

			case 'done':
				// done 在 handleChatDone 中统一处理
				currentStatus.value = null;
				break;

			case 'error':
				currentStatus.value = { type: 'error', error: chunk.error };
				// 确保错误能正确显示在消息中
				if (lastMessage && lastMessage.streaming) {
					lastMessage.streaming = false;
					lastMessage.error = chunk.error;
				} else if (lastMessage && lastMessage.role === 'assistant') {
					// 如果消息存在但不是 streaming 状态，仍然设置错误
					lastMessage.error = chunk.error;
				}
				break;

			case 'max_iterations':
				currentStatus.value = { type: 'max_iterations', iterations: chunk.iterations };
				break;

			case 'terminated':
				// Agent 因致命错误终止（如扩展未连接）
				currentStatus.value = {
					type: 'terminated',
					reason: chunk.reason,
					content: chunk.content,
				};
				// 更新最后一条消息，显示终止原因
				if (lastMessage && lastMessage.role === 'assistant') {
					lastMessage.streaming = false;
					// 设置错误信息或内容
					if (chunk.content) {
						lastMessage.content = chunk.content;
					}
					lastMessage.error = '任务已终止';
				}
				// 清理工具执行状态
				toolExecutions.value = [];
				break;

			case 'status':
				// 状态提示（如倒计时）
				currentStatus.value = {
					type: 'status',
					status: chunk.status,
				};
				break;

			case 'debug_confirm':
				// 调试模式：等待用户确认
				currentStatus.value = {
					type: 'debug_confirm',
					tool: chunk.tool,
					args: chunk.args,
					thinking: chunk.thinking,
				};
				debugConfirm.value = {
					confirmId: chunk.confirmId,
					tool: chunk.tool,
					args: chunk.args,
					debug: chunk.debug,
					thinking: chunk.thinking,
				};
				break;
				
			case 'security_confirm':
				// 沙盒安全：等待用户确认
				currentStatus.value = {
					type: 'security_confirm',
					tool: chunk.tool,
					args: chunk.args,
					message: chunk.message,
				};
				securityConfirm.value = {
					confirmId: chunk.confirmId,
					tool: chunk.tool,
					args: chunk.args,
					message: chunk.message,
					category: chunk.category,
				};
				break;
		}
	};

	const handleChatDone = (message) => {
		// 将所有 assistant 消息的 streaming 状态设为 false
		// 因为可能有多个 assistant 消息（思考阶段和总结阶段）
		messages.value.forEach((msg) => {
			if (msg.role === 'assistant') {
				msg.streaming = false;
			}
		});
		// 标记所有步骤为完成
		processingSteps.value.forEach(step => {
			if (step.status === 'running') {
				step.status = 'completed';
			}
		});
		// 清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
		// 延迟清理步骤流（让用户可以看到完整流程）
		setTimeout(() => {
			processingSteps.value = [];
			currentStep.value = null;
		}, 5000);
	};

	const handleChatError = (message) => {
		const lastMessage = messages.value[messages.value.length - 1];
		const errorMessage = message.error?.message || message.error || '未知错误';
		
		// 检查是否是中断错误
		const isInterruptError = errorMessage.includes('中断') || errorMessage.includes('interrupted');
		
		if (lastMessage && lastMessage.role === 'assistant') {
			lastMessage.streaming = false;
			lastMessage.error = errorMessage;
			
			if (isInterruptError) {
				// 中断错误特殊处理 - 简化为一句话
				const interruptMessage = '操作已被终止';
				if (!lastMessage.content || lastMessage.content.trim() === '') {
					lastMessage.content = interruptMessage;
				} else if (!lastMessage.content?.includes('操作已被终止')) {
					lastMessage.content = lastMessage.content + '\n\n' + interruptMessage;
				}
				lastMessage.interrupted = true;
			} else {
				// 普通错误
				if (!lastMessage.content) {
					lastMessage.content = '❌ 发生错误';
				}
			}
		} else {
			// 如果没有 assistant 消息，创建一个新的错误消息
			messages.value.push({
				id: Date.now().toString(),
				role: 'assistant',
				content: isInterruptError ? '操作已被终止' : '❌ 发生错误',
				error: errorMessage,
				streaming: false,
				interrupted: isInterruptError,
				timestamp: new Date().toISOString(),
			});
		}
		
		// 清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
	};

	const handleChatInterrupted = (message) => {
		const lastMessage = messages.value[messages.value.length - 1];
		if (lastMessage && lastMessage.streaming) {
			lastMessage.streaming = false;
			// 简化中断提示为一句话
			const interruptMessage = '操作已被终止';
			// 如果消息内容为空，直接设置为中断提示
			if (!lastMessage.content || lastMessage.content.trim() === '') {
				lastMessage.content = interruptMessage;
			} else if (!lastMessage.content?.includes('操作已被终止')) {
				// 如果已有内容，追加中断提示
				lastMessage.content = lastMessage.content + '\n\n' + interruptMessage;
			}
			lastMessage.interrupted = true;
		} else if (!lastMessage || lastMessage.role !== 'assistant') {
			// 如果没有正在流式传输的助手消息，创建一个新的中断消息
			messages.value.push({
				id: Date.now().toString(),
				role: 'assistant',
				content: '操作已被终止',
				streaming: false,
				interrupted: true,
				timestamp: new Date().toISOString(),
			});
		}
		// 清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
		console.log('[handleChatInterrupted] 任务已中断:', message.reason);
	};

	const handleChatInterruptError = (message) => {
		console.error('中断失败:', message.error?.message);
		// 即使中断失败，也要清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
	};

	const handleEvent = (message) => {
		console.log('Event:', message.event, message.data);
	};

	// 发送消息
	const sendMessage = async (content, options = {}) => {
		// 确保有当前会话
		if (!currentSessionId.value) {
			console.log('[sendMessage] 没有当前会话，先创建会话');
			await createSession();
		}
		
		// 再次检查会话是否存在（可能在创建后仍然失败）
		if (!currentSessionId.value) {
			console.error('[sendMessage] 无法创建会话，无法发送消息');
			throw new Error('无法创建会话');
		}
		
		// 清理之前的状态
		currentStatus.value = { type: 'sending' };
		toolExecutions.value = [];
		processingSteps.value = []; // 清空步骤流
		currentStep.value = null;

		// 使用的 Agent ID（优先使用传入的，否则使用当前选中的）
		const agentId = options.agentId || currentAgentId.value;

		// 添加用户消息
		messages.value.push({
			id: Date.now().toString(),
			role: 'user',
			content,
			timestamp: new Date().toISOString(),
		});

		// 添加占位的助手消息
		messages.value.push({
			id: (Date.now() + 1).toString(),
			role: 'assistant',
			content: '',
			streaming: true,
			timestamp: new Date().toISOString(),
			agentId, // 记录使用的 Agent
		});

		console.log(`[sendMessage] 发送消息到会话: ${currentSessionId.value}`);

		// 通过 WebSocket 发送
		if (ws.value && ws.value.readyState === 1) {
			// 1 = OPEN
			ws.value.send(
				JSON.stringify({
					type: 'chat',
					id: Date.now().toString(),
					payload: {
						message: content,
						sessionId: currentSessionId.value,
						agentId,
					},
				})
			);
		} else {
			// 回退到 HTTP API
			console.log('WebSocket not connected, falling back to HTTP');
			try {
				const baseUrl = api.getBaseUrl();
				const response = await fetch(`${baseUrl}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						message: content,
						sessionId: currentSessionId.value,
						agentId,
					}),
				});

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const text = decoder.decode(value);
					const lines = text.split('\n');

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = JSON.parse(line.slice(6));
							handleChatChunk({ chunk: data });
						}
					}
				}

				handleChatDone({});
			} catch (error) {
				handleChatError({ error: { message: error.message } });
			}
		}
	};

	// 中断当前聊天
	const interruptChat = async (reason = 'user_requested') => {
		console.log(`[interruptChat] 发送中断请求，reason=${reason}`);
		
		// 通过 WebSocket 发送中断请求
		if (ws.value && ws.value.readyState === 1) {
			// 1 = OPEN
			ws.value.send(
				JSON.stringify({
					type: 'chat_interrupt',
					id: Date.now().toString(),
					payload: {
						reason,
						sessionId: currentSessionId.value,
					},
				})
			);
			console.log('[interruptChat] 中断请求已通过 WebSocket 发送');
		} else {
			console.warn('[interruptChat] WebSocket 未连接，无法发送中断请求');
			// 回退到 HTTP API
			try {
				const baseUrl = api.getBaseUrl();
				await fetch(`${baseUrl}/api/sessions/${currentSessionId.value}/interrupt`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ reason }),
				});
				console.log('[interruptChat] 中断请求已通过 HTTP 发送');
			} catch (error) {
				console.error('[interruptChat] 发送中断请求失败:', error);
			}
		}
	};

	// 处理历史消息中的 toolCalls，确保字段兼容性
	const processHistoryToolCalls = (history) => {
		if (!Array.isArray(history)) return history;
		
		const processedMessages = [];
		let currentAssistantMsg = null;
		
		for (const msg of history) {
			// 处理 assistant 消息
			if (msg.role === 'assistant') {
				// 确保 toolCalls 数组存在
				if (!msg.toolCalls) {
					msg.toolCalls = [];
				}
				processedMessages.push(msg);
				currentAssistantMsg = msg;
				continue;
			}
			
			// 处理 tool 消息 - 合并到最近的 assistant 消息
			if (msg.role === 'tool') {
				if (currentAssistantMsg) {
					const params = msg.arguments || msg.params;
					
					// 从 params 中提取 action
					let action = '';
					try {
						const args = typeof params === 'string' ? JSON.parse(params) : params;
						action = args?.action || args?.method || '';
					} catch {
						action = '';
					}
					
					const toolData = {
						id: msg.toolCallId || `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						name: msg.metadata?.toolName || 'tool',
						action: action,
						params: params,
						result: null,
						status: 'completed',
						duration: 0,
					};
					
					// 尝试解析 content 作为 result
					if (msg.content) {
						try {
							const parsed = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
							toolData.result = parsed;
							if (parsed.success === false) {
								toolData.status = 'error';
								toolData.error = parsed.error;
							}
						} catch {
							toolData.result = { content: msg.content };
						}
					}
					
					// 从 metadata 中提取更多信息
					if (msg.metadata) {
						if (msg.metadata.isMultimodal) {
							toolData.isMultimodal = true;
						}
						if (msg.metadata.aiContext) {
							toolData.aiContext = msg.metadata.aiContext;
						}
					}
					
					currentAssistantMsg.toolCalls.push(toolData);
					console.log(`[processHistoryToolCalls] 将 tool 消息合并到 assistant 消息:`, toolData.name);
				} else {
					console.warn(`[processHistoryToolCalls] 找到 tool 消息但没有前置的 assistant 消息`);
				}
				continue;
			}
			
			// 处理包含截图结果的 user 消息（多模态内容）
			if (msg.role === 'user' && msg.content && msg.content.includes('[截图结果]')) {
				// 如果上一条是 assistant 消息，将截图内容附加到它的最后一条 tool
				if (currentAssistantMsg && currentAssistantMsg.toolCalls && currentAssistantMsg.toolCalls.length > 0) {
					const lastTool = currentAssistantMsg.toolCalls[currentAssistantMsg.toolCalls.length - 1];
					// 从 content 中提取图片信息
					const imageMatch = msg.content.match(/\[图片\]/);
					if (imageMatch && lastTool.result) {
						// 截图结果已经在 tool 消息中，这里只是标记
						console.log(`[processHistoryToolCalls] 跳过截图 user 消息，结果已在 tool 中`);
						continue;
					}
				}
				// 如果不符合上述条件，作为普通 user 消息处理
				processedMessages.push(msg);
				currentAssistantMsg = null;
				continue;
			}
			
			// 普通 user 消息
			if (msg.role === 'user') {
				processedMessages.push(msg);
				currentAssistantMsg = null;
				continue;
			}
			
			// 其他角色（如 system）直接保留
			processedMessages.push(msg);
		}
		
		// 处理 assistant 消息中的 toolCalls
		processedMessages.forEach(msg => {
			if (msg.role === 'assistant' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
				msg.toolCalls = msg.toolCalls.map((tool, index) => {
					// 兼容处理：确保有 id 字段
					if (!tool.id) {
						tool.id = `${tool.name || 'tool'}-${msg.timestamp || Date.now()}-${index}`;
					}
					
					// 兼容处理：如果后端返回的是 arguments，转换为 params
					if (tool.arguments !== undefined && tool.params === undefined) {
						tool.params = tool.arguments;
					}
					
					// 确保 status 字段存在
					if (!tool.status) {
						tool.status = tool.result ? 'success' : 'running';
					}
					
					// 从 params 中提取 action
					if (!tool.action) {
						try {
							const args = typeof tool.params === 'string' ? JSON.parse(tool.params) : tool.params;
							tool.action = args?.action || args?.method || '';
						} catch {
							tool.action = '';
						}
					}
					
					return tool;
				});
			}
		});
		
		return processedMessages;
	};

	// 加载数据
	const loadSessions = async () => {
		try {
			const list = await api.get('/api/sessions');
			sessions.value = list;
			console.log(`[loadSessions] 加载了 ${list.length} 个会话`);

			// 尝试恢复最近的 sessionId
			const savedId = localStorage.getItem('nutbot_currentSessionId');
			if (savedId && list.find(s => s.id === savedId)) {
				currentSessionId.value = savedId;
				// 加载该会话的历史
				try {
					const history = await api.get(`/api/sessions/${savedId}/history`);
					// 确保历史记录是数组
					if (Array.isArray(history)) {
						messages.value = processHistoryToolCalls(history);
						console.log(`[loadSessions] 成功加载 ${history.length} 条历史消息`);
					} else {
						console.warn('[loadSessions] 返回的历史记录不是数组:', history);
						messages.value = [];
					}
				} catch (e) {
					console.warn(`[loadSessions] 会话历史加载失败: ${e.message}`);
					messages.value = [];
				}
			} else if (list.length > 0) {
				// 如果没有保存的，选择最近更新的
				const sorted = [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
				currentSessionId.value = sorted[0].id;
				localStorage.setItem('nutbot_currentSessionId', sorted[0].id);
				console.log(`[loadSessions] 选择最近更新的会话: ${sorted[0].id}`);
				try {
					const history = await api.get(`/api/sessions/${sorted[0].id}/history`);
					if (Array.isArray(history)) {
						messages.value = processHistoryToolCalls(history);
						console.log(`[loadSessions] 成功加载 ${history.length} 条历史消息`);
					} else {
						messages.value = [];
					}
				} catch (e) {
					console.warn(`[loadSessions] 会话历史加载失败: ${e.message}`);
					messages.value = [];
				}
			} else {
				// 没有会话，创建一个新会话
				console.log('[loadSessions] 没有会话，创建新会话');
				await createSession();
			}
		} catch (error) {
			console.error('[loadSessions] 加载会话列表失败:', error);
			// 出错时清空会话列表，等待下次重试
			sessions.value = [];
			currentSessionId.value = null;
			messages.value = [];
			// 尝试创建新会话
			try {
				await createSession();
			} catch (e) {
				console.error('[loadSessions] 创建新会话也失败:', e);
			}
		}
	};

	const loadProviders = async () => {
		try {
			providers.value = await api.get('/api/providers');
		} catch (error) {
			console.error('Failed to load providers:', error);
		}
	};

	const loadTools = async (grouped = false) => {
		try {
			if (grouped) {
				toolsGrouped.value = await api.get('/api/tools?grouped=true');
			} else {
				tools.value = await api.get('/api/tools');
			}
		} catch (error) {
			console.error('Failed to load tools:', error);
		}
	};

	// ========== Agent Profiles ==========

	const loadAgents = async () => {
		try {
			const data = await api.get('/api/agents');
			agents.value = data.agents || [];
			currentAgentId.value = data.currentId || 'default';
		} catch (error) {
			console.error('Failed to load agents:', error);
		}
	};

	const getAgent = (id) => {
		return agents.value.find((a) => a.id === id);
	};

	const getCurrentAgent = () => {
		return agents.value.find((a) => a.id === currentAgentId.value);
	};

	const createAgent = async (data) => {
		try {
			const result = await api.post('/api/agents', data);
			await loadAgents();
			return result.agent;
		} catch (error) {
			console.error('Failed to create agent:', error);
			throw error;
		}
	};

	const updateAgent = async (id, data) => {
		try {
			const result = await api.put(`/api/agents/${id}`, data);
			await loadAgents();
			return result.agent;
		} catch (error) {
			console.error('Failed to update agent:', error);
			throw error;
		}
	};

	const deleteAgent = async (id) => {
		try {
			await api.del(`/api/agents/${id}`);
			await loadAgents();
		} catch (error) {
			console.error('Failed to delete agent:', error);
			throw error;
		}
	};

	const duplicateAgent = async (id) => {
		try {
			const result = await api.post(`/api/agents/${id}/duplicate`);
			await loadAgents();
			return result.agent;
		} catch (error) {
			console.error('Failed to duplicate agent:', error);
			throw error;
		}
	};

	const setCurrentAgent = async (id) => {
		try {
			await api.post('/api/agents/current', { id });
			currentAgentId.value = id;
		} catch (error) {
			console.error('Failed to set current agent:', error);
			throw error;
		}
	};

	const exportAgent = async (id) => {
		try {
			const data = await api.get(`/api/agents/${id}/export`);
			return data;
		} catch (error) {
			console.error('Failed to export agent:', error);
			throw error;
		}
	};

	const importAgent = async (data) => {
		try {
			const result = await api.post('/api/agents/import', data);
			await loadAgents();
			return result.agent;
		} catch (error) {
			console.error('Failed to import agent:', error);
			throw error;
		}
	};

	const loadConfig = async () => {
		try {
			config.value = await api.get('/api/config');
		} catch (error) {
			console.error('Failed to load config:', error);
		}
	};

	const createSession = async () => {
		try {
			// 调用后端 API 创建会话，确保前后端使用相同的 ID
			const session = await api.post('/api/sessions', { title: 'New Chat' });
			sessions.value.unshift(session);
			currentSessionId.value = session.id;
			localStorage.setItem('nutbot_currentSessionId', session.id);
			messages.value = [];
			console.log(`[createSession] 成功创建会话: ${session.id}`);
		} catch (error) {
			console.error('[createSession] 创建会话失败:', error);
			// 不再回退到本地创建，而是抛出错误让调用者处理
			// 这样可以避免前后端会话 ID 不一致的问题
			throw new Error(`创建会话失败: ${error.message}`);
		}
	};

	const deleteSession = async (id) => {
		try {
			await api.del(`/api/sessions/${id}`);
			// 从列表中移除
			const index = sessions.value.findIndex(s => s.id === id);
			if (index !== -1) {
				sessions.value.splice(index, 1);
			}
			// 如果删除的是当前会话，切换到第一个或创建新会话
			if (currentSessionId.value === id) {
				if (sessions.value.length > 0) {
					await selectSession(sessions.value[0].id);
				} else {
					createSession();
				}
			}
		} catch (error) {
			console.error('Failed to delete session:', error);
			throw error;
		}
	};

	const clearAllSessions = async () => {
		try {
			await api.del('/api/sessions');
			sessions.value = [];
			currentSessionId.value = null;
			messages.value = [];
			localStorage.removeItem('nutbot_currentSessionId');
			// 调用 loadSessions，它会在列表为空时自动创建新会话
			// 确保清空操作完全生效后再获取最新列表
			await loadSessions();
		} catch (error) {
			console.error('Failed to clear sessions:', error);
			throw error;
		}
	};

	const selectSession = async (id) => {
		currentSessionId.value = id;
		localStorage.setItem('nutbot_currentSessionId', id);
		console.log(`[selectSession] 切换到会话: ${id}`);
		try {
			const history = await api.get(`/api/sessions/${id}/history`);
			if (Array.isArray(history)) {
				messages.value = processHistoryToolCalls(history);
				console.log(`[selectSession] 成功加载 ${history.length} 条历史消息`);
			} else if (history.error) {
				console.error(`[selectSession] 加载历史失败: ${history.message}`);
				messages.value = [];
			} else {
				console.warn('[selectSession] 返回的历史记录格式不正确:', history);
				messages.value = [];
			}
		} catch (error) {
			console.error('[selectSession] 加载会话历史失败:', error);
			messages.value = [];
		}
	};

	// 发送调试确认响应
	const sendDebugResponse = (approved) => {
		if (!debugConfirm.value) return;
		
		const confirmId = debugConfirm.value.confirmId;
		
		if (ws.value && ws.value.readyState === 1) {
			ws.value.send(JSON.stringify({
				type: 'debug_response',
				payload: {
					confirmId,
					approved,
				},
			}));
		}
		
		// 清除调试状态
		debugConfirm.value = null;
		currentStatus.value = approved ? { type: 'tool_running', tool: 'computer' } : null;
	};
	
	// 发送安全确认响应
	const sendSecurityResponse = (approved) => {
		if (!securityConfirm.value) return;
		
		const confirmId = securityConfirm.value.confirmId;
		const tool = securityConfirm.value.tool;
		
		if (ws.value && ws.value.readyState === 1) {
			ws.value.send(JSON.stringify({
				type: 'debug_response', // 复用同一个响应处理器
				payload: {
					confirmId,
					approved,
				},
			}));
		}
		
		// 清除确认状态
		securityConfirm.value = null;
		currentStatus.value = approved ? { type: 'tool_running', tool } : null;
	};

	return {
		// 状态
		connected,
		ws,
		sessions,
		currentSessionId,
		currentSession,
		messages,
		providers,
		tools,
		toolsGrouped,
		config,
		currentStatus,
		toolExecutions,
		debugConfirm,
		securityConfirm,
		logs,
		agents,
		currentAgentId,
		connectionStatus,
		// 步骤流相关
		processingSteps,
		currentStep,

		// 方法
		setConnected,
		setWebSocket,
		handleMessage,
		sendMessage,
		interruptChat,
		loadSessions,
		loadProviders,
		loadTools,
		loadConfig,
		createSession,
		deleteSession,
		clearAllSessions,
		selectSession,
		sendDebugResponse,
		sendSecurityResponse,
		clearLogs,
		startHeartbeat,
		stopHeartbeat,
		checkConnectionStatus,

		// Agent Profiles
		loadAgents,
		getAgent,
		getCurrentAgent,
		createAgent,
		updateAgent,
		deleteAgent,
		duplicateAgent,
		setCurrentAgent,
		exportAgent,
		importAgent,
	};
});
