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

	// 调试模式
	const debugConfirm = ref(null); // 当前等待确认的调试数据

	// 沙盒安全
	const securityConfirm = ref(null); // 当前等待确认的安全操作

	// 实时日志
	const logs = ref([]); // 日志列表
	const maxLogs = 1000; // 最大日志条数

	// ========== 连接状态管理 ==========
	const connectionStatus = ref({
		som: { connected: false, latency: null },
		browser: { connected: false, targets: 0 },
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
			const startTime = Date.now();

			// 并行检查浏览器扩展状态
			let browserStatus = { connected: false, targets: 0 };
			try {
				const statusRes = await fetch('/api/status', {
					signal: AbortSignal.timeout(2000), // 2秒超时
				});
				if (statusRes.ok) {
					const data = await statusRes.json();
					const cdpData = data.cdpRelay || data;
					browserStatus = {
						connected: cdpData?.extension?.connected || cdpData?.connected || false,
						targets: cdpData?.extension?.targets || cdpData?.targets || 0,
					};
				}
			} catch (e) {
				// 获取失败，浏览器扩展可能未运行
				browserStatus = { connected: false, targets: 0 };
			}

			const latency = Date.now() - startTime;

			connectionStatus.value = {
				som: {
					connected: connected.value,
					latency: connected.value ? latency : null,
				},
				browser: browserStatus,
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

	const handleChatChunk = (message) => {
		const chunk = message.chunk;
		const lastMessage = messages.value[messages.value.length - 1];

		switch (chunk.type) {
			case 'thinking':
				currentStatus.value = { type: 'thinking', iteration: chunk.iteration };
				break;

			case 'content':
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
					// 直接累积到 content 实现流式显示
					lastMessage.content = (lastMessage.content || '') + (chunk.content || '');
				}
				currentStatus.value = { type: 'generating' };
				break;

			case 'tools':
				currentStatus.value = { type: 'tools', count: chunk.count };
				break;

			case 'tool_start':
				currentStatus.value = {
					type: 'tool_running',
					tool: chunk.tool,
					args: chunk.args,
					description: chunk.description,
				};
				toolExecutions.value.push({
					id: Date.now(),
					tool: chunk.tool,
					args: chunk.args,
					status: 'running',
					startTime: Date.now(),
				});
				// 在当前消息中添加工具调用记录
				if (lastMessage && lastMessage.role === 'assistant') {
					if (!lastMessage.toolCalls) lastMessage.toolCalls = [];
					lastMessage.toolCalls.push({
						name: chunk.tool,
						arguments: chunk.args,
						status: 'running',
						description: chunk.description,
					});
				}
				break;

			case 'tool_result':
				currentStatus.value = {
					type: 'tool_done',
					tool: chunk.tool,
				};
				// 更新工具执行状态
				const runningTool = toolExecutions.value.find((t) => t.tool === chunk.tool && t.status === 'running');
				if (runningTool) {
					runningTool.status = 'success';
					runningTool.result = chunk.result;
					runningTool.duration = Date.now() - runningTool.startTime;
				}
				// 更新消息中的工具调用记录
				if (lastMessage && lastMessage.toolCalls) {
					const toolCall = lastMessage.toolCalls.find((t) => t.name === chunk.tool && t.status === 'running');
					if (toolCall) {
						toolCall.status = 'success';
						toolCall.result = chunk.result;
					}
				}
				break;

			case 'tool_error':
				currentStatus.value = {
					type: 'tool_error',
					tool: chunk.tool,
					error: chunk.error,
				};
				// 更新工具执行状态
				const errorTool = toolExecutions.value.find((t) => t.tool === chunk.tool && t.status === 'running');
				if (errorTool) {
					errorTool.status = 'error';
					errorTool.error = chunk.error;
					errorTool.duration = Date.now() - errorTool.startTime;
				}
				// 更新消息中的工具调用记录
				if (lastMessage && lastMessage.toolCalls) {
					const toolCall = lastMessage.toolCalls.find((t) => t.name === chunk.tool && t.status === 'running');
					if (toolCall) {
						toolCall.status = 'error';
						toolCall.result = { error: chunk.error };
					}
				}
				break;

			case 'done':
				// done 在 handleChatDone 中统一处理
				currentStatus.value = null;
				break;

			case 'error':
				currentStatus.value = { type: 'error', error: chunk.error };
				if (lastMessage && lastMessage.streaming) {
					lastMessage.streaming = false;
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
					lastMessage.error = chunk.reason === 'extension_not_connected' ? '浏览器扩展未连接，任务已终止' : '任务已终止';
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
		const lastMessage = messages.value[messages.value.length - 1];
		if (lastMessage && lastMessage.role === 'assistant') {
			lastMessage.streaming = false;
		}
		// 清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
	};

	const handleChatError = (message) => {
		const lastMessage = messages.value[messages.value.length - 1];
		if (lastMessage && lastMessage.streaming) {
			lastMessage.streaming = false;
			lastMessage.error = message.error?.message;
		}
	};

	const handleChatInterrupted = (message) => {
		const lastMessage = messages.value[messages.value.length - 1];
		if (lastMessage && lastMessage.streaming) {
			lastMessage.streaming = false;
			lastMessage.content = (lastMessage.content || '') + '\n\n⚠️ **任务已中断**';
		}
		// 清理状态
		currentStatus.value = null;
		toolExecutions.value = [];
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
		// 清理之前的状态
		currentStatus.value = { type: 'sending' };
		toolExecutions.value = [];

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

	// 加载数据
	const loadSessions = async () => {
		try {
			sessions.value = await api.get('/api/sessions');
		} catch (error) {
			console.error('Failed to load sessions:', error);
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

	const createSession = () => {
		const newSession = {
			id: Date.now().toString(),
			title: 'New Chat',
			createdAt: new Date().toISOString(),
		};
		sessions.value.unshift(newSession);
		currentSessionId.value = newSession.id;
		messages.value = [];
	};

	const selectSession = async (id) => {
		currentSessionId.value = id;
		try {
			messages.value = await api.get(`/api/sessions/${id}/history`);
		} catch (error) {
			console.error('Failed to load session history:', error);
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

		// 方法
		setConnected,
		setWebSocket,
		handleMessage,
		sendMessage,
		loadSessions,
		loadProviders,
		loadTools,
		loadConfig,
		createSession,
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
