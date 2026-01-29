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
	const config = ref({});

	// 实时状态
	const currentStatus = ref(null); // 当前执行状态
	const toolExecutions = ref([]); // 工具执行历史

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
			case 'event':
				handleEvent(message);
				break;
		}
	};

	const handleChatChunk = (message) => {
		const chunk = message.chunk;
		const lastMessage = messages.value[messages.value.length - 1];

		switch (chunk.type) {
			case 'thinking':
				currentStatus.value = { type: 'thinking', iteration: chunk.iteration };
				// thinking chunk 内容会在 tools chunk 时作为 _pendingContent 处理
				break;

			case 'content':
				if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
					// 追加内容到 pendingContent（等看是否有工具调用）
					if (!lastMessage._pendingContent) lastMessage._pendingContent = '';
					lastMessage._pendingContent += chunk.content || '';
				}
				currentStatus.value = { type: 'generating' };
				break;

			case 'tools':
				currentStatus.value = { type: 'tools', count: chunk.count };
				// 把思考内容暂存，等 tool_start 时附加到工具调用上
				if (lastMessage && lastMessage.role === 'assistant') {
					const thinking = chunk.thinking || lastMessage._pendingContent || '';
					if (thinking) {
						lastMessage._currentThinking = thinking; // 暂存当前迭代的思考
						lastMessage._pendingContent = '';
					}
				}
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
				// 在当前消息中添加工具调用记录，附带思考内容
				if (lastMessage && lastMessage.role === 'assistant') {
					if (!lastMessage.toolCalls) lastMessage.toolCalls = [];
					// 只有第一个工具调用带上思考内容（同一批次的工具共享一个思考）
					const isFirstInBatch =
						!lastMessage.toolCalls.length ||
						lastMessage.toolCalls[lastMessage.toolCalls.length - 1].thinking;
					lastMessage.toolCalls.push({
						name: chunk.tool,
						arguments: chunk.args,
						status: 'running',
						description: chunk.description,
						thinking: isFirstInBatch ? lastMessage._currentThinking : null,
					});
					// 清空暂存的思考（已附加到工具调用）
					if (isFirstInBatch) {
						lastMessage._currentThinking = '';
					}
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
		}
	};

	const handleChatDone = (message) => {
		const lastMessage = messages.value[messages.value.length - 1];
		if (lastMessage && lastMessage.role === 'assistant') {
			// 如果有待处理的内容，放到 content（这是最终回复）
			if (lastMessage._pendingContent) {
				// 如果已有 content，追加；否则设置
				if (lastMessage.content) {
					lastMessage.content += lastMessage._pendingContent;
				} else {
					lastMessage.content = lastMessage._pendingContent;
				}
				delete lastMessage._pendingContent;
			}
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

	const handleEvent = (message) => {
		console.log('Event:', message.event, message.data);
	};

	// 发送消息
	const sendMessage = async (content) => {
		// 清理之前的状态
		currentStatus.value = { type: 'sending' };
		toolExecutions.value = [];

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

	const loadTools = async () => {
		try {
			tools.value = await api.get('/api/tools');
		} catch (error) {
			console.error('Failed to load tools:', error);
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

	return {
		// 状态
		connected,
		sessions,
		currentSessionId,
		currentSession,
		messages,
		providers,
		tools,
		config,
		currentStatus,
		toolExecutions,

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
	};
});
