<template>
	<div class="chat-container">
		<!-- 头部 -->
		<header class="chat-header">
			<div class="chat-header-left">
				<h2 class="chat-title">{{ store.currentSession?.title || '新对话' }}</h2>
				<span v-if="currentModelDisplay" class="current-model-badge" :title="currentModelDisplay">
					🤖 {{ currentModelShortName }}
				</span>
			</div>
			<button @click="store.createSession()" class="btn btn-secondary">新对话</button>
		</header>

		<!-- 消息列表 -->
		<div ref="messagesContainer" class="messages-container">
			<template v-if="store.messages.length === 0">
				<div class="welcome-screen">
					<span class="welcome-logo">🥜</span>
					<h3 class="welcome-title">欢迎使用 NutBot</h3>
					<p class="welcome-desc">输入消息开始对话，或让我帮你完成任务</p>
					<div class="welcome-examples">
						<button v-for="example in examples" :key="example" @click="input = example" class="example-btn">
							{{ example }}
						</button>
					</div>
				</div>
			</template>

			<template v-else>
				<div
					v-for="msg in store.messages"
					:key="msg.id"
					class="message"
					:class="msg.role === 'user' ? 'message-user' : 'message-assistant'"
				>
					<div class="flex items-start gap-3">
						<span class="text-xl flex-shrink-0">{{ msg.role === 'user' ? '👤' : '🥜' }}</span>
						<div class="flex-1 min-w-0">
							<!-- 工具调用（GPT 风格：折叠成一行，点击展开）-->
							<div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="mb-3">
								<div class="tools-summary" :class="{ expanded: isToolsExpanded(msg.id) }">
									<!-- 折叠状态：显示步骤数 + 当前思考内容 -->
									<div class="tools-header" @click="toggleTools(msg.id)">
										<div class="tools-progress">
											<span
												v-for="(tool, idx) in msg.toolCalls"
												:key="idx"
												class="tool-dot"
												:class="{
													running: tool.status === 'running',
													success: tool.status === 'success' || tool.result?.success,
													error: tool.status === 'error' || tool.result?.error,
												}"
											></span>
										</div>
										<span class="tools-text">
											{{ getToolsSummaryWithThinking(msg.toolCalls) }}
										</span>
										<span class="tools-toggle">{{ isToolsExpanded(msg.id) ? '▲' : '▼' }}</span>
									</div>

									<!-- 展开状态：显示详细工具调用，每个步骤带思考 -->
									<div v-if="isToolsExpanded(msg.id)" class="tools-detail">
										<div
											v-for="(tool, idx) in msg.toolCalls"
											:key="idx"
											class="tool-item"
											:class="{ expanded: isToolExpanded(msg.id, idx) }"
										>
											<!-- 思考内容（如果有）-->
											<div v-if="tool.thinking" class="tool-thinking">💭 {{ tool.thinking }}</div>
											<div class="tool-item-header" @click.stop="toggleToolDetail(msg.id, idx)">
												<span class="tool-status-icon">
													<span v-if="tool.status === 'running'" class="animate-spin"
														>⚙️</span
													>
													<span v-else-if="tool.status === 'success' || tool.result?.success"
														>✅</span
													>
													<span v-else-if="tool.status === 'error' || tool.result?.error"
														>❌</span
													>
													<span v-else>🔧</span>
												</span>
												<span class="tool-name">{{ tool.name }}</span>
												<span class="tool-action">{{ getToolAction(tool) }}</span>
												<span class="tool-item-toggle">{{
													isToolExpanded(msg.id, idx) ? '−' : '+'
												}}</span>
											</div>
											<div v-if="isToolExpanded(msg.id, idx)" class="tool-item-detail">
												<div class="tool-section">
													<div class="tool-section-header">
														<span class="tool-label">参数:</span>
														<button
															class="copy-btn"
															@click.stop="
																copyToClipboard(formatToolArgs(tool.arguments))
															"
														>
															📋 复制
														</button>
													</div>
													<pre class="tool-code">{{ formatToolArgs(tool.arguments) }}</pre>
												</div>
												<!-- 截图预览 -->
												<div
													v-if="tool.name === 'screenshot' && tool.result?.base64"
													class="tool-section"
												>
													<div class="tool-section-header">
														<span class="tool-label">截图预览:</span>
													</div>
													<div
														class="screenshot-preview"
														@click="openImageModal(tool.result.base64)"
													>
														<img
															:src="'data:image/jpeg;base64,' + tool.result.base64"
															class="screenshot-thumbnail"
															alt="截图"
														/>
														<div class="screenshot-overlay">
															<span>🔍 点击放大</span>
														</div>
													</div>
												</div>
												<div v-if="tool.result" class="tool-section">
													<div class="tool-section-header">
														<span class="tool-label">结果:</span>
														<button
															class="copy-btn"
															@click.stop="copyToClipboard(getRawResult(tool.result))"
														>
															📋 复制
														</button>
													</div>
													<pre
														class="tool-code scrollable"
														:class="{ error: tool.result?.error }"
														>{{ formatToolResult(tool.result, false) }}</pre
													>
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>

							<!-- 消息内容 -->
							<div v-if="msg.streaming" class="markdown" v-html="renderMarkdown(msg.content + '▊')"></div>
							<div v-else-if="msg.content" class="markdown" v-html="renderMarkdown(msg.content)"></div>
							<div v-if="msg.error" class="text-red-400 text-sm mt-2">❌ {{ msg.error }}</div>
						</div>
					</div>
				</div>
			</template>

			<!-- 实时执行状态（固定在底部）-->
			<div
				v-if="store.currentStatus && store.currentStatus.type !== 'sending'"
				class="execution-status"
				ref="executionStatus"
			>
				<div class="status-content">
					<!-- 当前状态图标 -->
					<span class="status-icon">
						<span v-if="store.currentStatus.type === 'thinking'" class="animate-pulse">🤔</span>
						<span v-else-if="store.currentStatus.type === 'generating'" class="animate-pulse">✍️</span>
						<span v-else-if="store.currentStatus.type === 'tool_running'" class="animate-spin">⚙️</span>
						<span v-else-if="store.currentStatus.type === 'tool_done'">✅</span>
						<span v-else-if="store.currentStatus.type === 'tool_error'">❌</span>
						<span v-else-if="store.currentStatus.type === 'status'" class="animate-pulse">⏳</span>
					</span>

					<!-- 状态文字 -->
					<div class="status-text-wrapper">
						<span class="status-text">
							<template v-if="store.currentStatus.type === 'thinking'"> 正在分析任务... </template>
							<template v-else-if="store.currentStatus.type === 'generating'"> 正在生成回复... </template>
							<template v-else-if="store.currentStatus.type === 'status'">
								{{ store.currentStatus.status }}
							</template>
							<template v-else-if="store.currentStatus.type === 'tool_running'">
								正在{{ getToolDescription(store.currentStatus.tool, store.currentStatus.args) }}
							</template>
							<template v-else-if="store.currentStatus.type === 'tool_done'">
								{{ getToolDescription(store.currentStatus.tool, {}) }} 完成
							</template>
						</span>
						<!-- 显示详细参数 -->
						<span
							v-if="store.currentStatus.type === 'tool_running' && store.currentStatus.args"
							class="status-detail"
						>
							{{ getStatusDetail(store.currentStatus.args) }}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- 输入框 -->
		<div class="input-area">
			<form @submit.prevent="send" class="input-form">
				<input v-model="input" type="text" placeholder="输入消息..." class="input" :disabled="sending" />
				<button type="submit" class="btn btn-primary" :disabled="!input.trim() || sending">
					{{ sending ? '发送中...' : '发送' }}
				</button>
			</form>
		</div>

		<!-- 图片预览模态框 -->
		<div v-if="imageModal.visible" class="image-modal" @click="closeImageModal">
			<div class="image-modal-content" @click.stop>
				<button class="image-modal-close" @click="closeImageModal">✕</button>
				<img :src="'data:image/jpeg;base64,' + imageModal.base64" class="image-modal-img" />
			</div>
		</div>

		<!-- 调试确认模态框 -->
		<div v-if="store.debugConfirm" class="debug-modal-overlay">
			<div class="debug-modal">
				<div class="debug-modal-header">
					<h3>🔍 调试模式 - 确认操作</h3>
					<p class="debug-modal-thinking" v-if="store.debugConfirm.thinking">
						💭 {{ store.debugConfirm.thinking }}
					</p>
				</div>
				
				<div class="debug-modal-body">
					<!-- 三张图片对比 -->
					<div class="debug-images">
						<div class="debug-image-item" v-if="store.debugConfirm.debug?.originalImage">
							<div class="debug-image-label">📸 原始截图</div>
							<img 
								:src="'data:image/png;base64,' + store.debugConfirm.debug.originalImage" 
								class="debug-image"
								@click="openImageModal(store.debugConfirm.debug.originalImage)"
							/>
						</div>
						
						<div class="debug-image-item" v-if="store.debugConfirm.debug?.markedImage">
							<div class="debug-image-label">🏷️ OCR-SoM 标注</div>
							<img 
								:src="'data:image/png;base64,' + store.debugConfirm.debug.markedImage" 
								class="debug-image"
								@click="openImageModal(store.debugConfirm.debug.markedImage)"
							/>
						</div>
						
						<div class="debug-image-item" v-if="store.debugConfirm.debug?.clickImage">
							<div class="debug-image-label">🎯 AI 点击位置</div>
							<img 
								:src="'data:image/png;base64,' + store.debugConfirm.debug.clickImage" 
								class="debug-image"
								@click="openImageModal(store.debugConfirm.debug.clickImage)"
							/>
						</div>
					</div>
					
					<!-- 操作信息 -->
					<div class="debug-info">
						<div class="debug-info-item">
							<span class="debug-info-label">操作:</span>
							<span class="debug-info-value">{{ store.debugConfirm.debug?.action }}</span>
						</div>
						<div class="debug-info-item" v-if="store.debugConfirm.debug?.coordinate">
							<span class="debug-info-label">坐标:</span>
							<span class="debug-info-value">({{ store.debugConfirm.debug.coordinate[0] }}, {{ store.debugConfirm.debug.coordinate[1] }})</span>
						</div>
						<div class="debug-info-item" v-if="store.debugConfirm.debug?.elements?.length">
							<span class="debug-info-label">识别元素:</span>
							<span class="debug-info-value">{{ store.debugConfirm.debug.elements.length }} 个</span>
						</div>
					</div>
				</div>
				
				<div class="debug-modal-footer">
					<button class="btn btn-secondary" @click="store.sendDebugResponse(false)">
						❌ 取消操作
					</button>
					<button class="btn btn-primary" @click="store.sendDebugResponse(true)">
						✅ 确认执行
					</button>
				</div>
			</div>
		</div>
		
		<!-- 安全确认模态框 -->
		<div v-if="store.securityConfirm" class="security-modal-overlay">
			<div class="security-modal">
				<div class="security-modal-header">
					<h3>
						<span v-if="store.securityConfirm.category === 'forbidden'">⛔ 操作被阻止</span>
						<span v-else-if="store.securityConfirm.category === 'sensitive'">🔐 敏感操作确认</span>
						<span v-else>📦 沙盒安全确认</span>
					</h3>
				</div>
				
				<div class="security-modal-body">
					<div class="security-message" v-html="formatSecurityMessage(store.securityConfirm.message)"></div>
					
					<div class="security-info">
						<div class="security-info-item">
							<span class="security-info-label">工具:</span>
							<span class="security-info-value">{{ store.securityConfirm.tool }}</span>
						</div>
						<div class="security-info-item" v-if="store.securityConfirm.args">
							<span class="security-info-label">参数:</span>
							<span class="security-info-value">{{ JSON.stringify(store.securityConfirm.args).substring(0, 100) }}</span>
						</div>
					</div>
				</div>
				
				<div class="security-modal-footer">
					<button class="btn btn-secondary" @click="store.sendSecurityResponse(false)">
						❌ 取消
					</button>
					<button class="btn btn-primary" @click="store.sendSecurityResponse(true)">
						✅ 确认执行
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import { marked } from 'marked';
import { useAppStore } from '../stores/app';

const store = useAppStore();

// 当前模型显示
const currentModelDisplay = computed(() => {
	const modelRef = store.config?.agent?.defaultModel;
	if (!modelRef) return '';
	return modelRef;
});

const currentModelShortName = computed(() => {
	const modelRef = store.config?.agent?.defaultModel;
	if (!modelRef) return '';
	const [providerId, ...modelParts] = modelRef.split('/');
	const modelName = modelParts.join('/');
	// 简化模型名称显示
	if (modelName.length > 25) {
		return modelName.substring(0, 22) + '...';
	}
	return modelName;
});

const input = ref('');
const sending = ref(false);
const messagesContainer = ref(null);
const executionStatus = ref(null);
const expandedTools = ref(new Set());
const expandedToolsGroup = ref(new Set());

// 图片预览模态框
const imageModal = ref({
	visible: false,
	base64: '',
});

const openImageModal = (base64) => {
	imageModal.value.base64 = base64;
	imageModal.value.visible = true;
};

// 格式化安全消息（保留换行）
const formatSecurityMessage = (message) => {
	if (!message) return '';
	return message.replace(/\n/g, '<br>');
};

const closeImageModal = () => {
	imageModal.value.visible = false;
	imageModal.value.base64 = '';
};

const examples = ['打开 B 站搜索影视飓风', '截取当前屏幕', '执行 ls -la 命令', '帮我查一下天气'];

const renderMarkdown = (text) => {
	if (!text) return '';
	// 过滤掉 AI 的思考内容（<think>...</think> 标签）
	let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
	// 如果过滤后为空，可能整段都是思考内容，返回原文
	if (!cleaned) cleaned = text;
	return marked(cleaned);
};

// 工具组展开/折叠
const toggleTools = (msgId) => {
	if (expandedToolsGroup.value.has(msgId)) {
		expandedToolsGroup.value.delete(msgId);
	} else {
		expandedToolsGroup.value.add(msgId);
	}
};

const isToolsExpanded = (msgId) => {
	return expandedToolsGroup.value.has(msgId);
};

// 单个工具详情展开/折叠
const toggleToolDetail = (msgId, toolIdx) => {
	const key = `${msgId}-${toolIdx}`;
	if (expandedTools.value.has(key)) {
		expandedTools.value.delete(key);
	} else {
		expandedTools.value.add(key);
	}
};

const isToolExpanded = (msgId, toolIdx) => {
	return expandedTools.value.has(`${msgId}-${toolIdx}`);
};

// 获取工具执行摘要（详细版）
const getToolsSummary = (toolCalls) => {
	const total = toolCalls.length;
	const completed = toolCalls.filter((t) => t.status === 'success' || t.result?.success).length;
	const failed = toolCalls.filter((t) => t.status === 'error' || t.result?.error).length;
	const running = toolCalls.filter((t) => t.status === 'running').length;

	// 获取最后一个执行的工具描述
	const lastTool = toolCalls[toolCalls.length - 1];
	const lastAction = getToolAction(lastTool);

	if (running > 0) {
		const runningTool = toolCalls.find((t) => t.status === 'running');
		const runningAction = getToolAction(runningTool);
		return `执行中 (${completed}/${total}): ${runningAction || runningTool?.name}`;
	}
	if (failed > 0) {
		return `已完成 ${completed}/${total} 步，${failed} 步失败`;
	}
	// 显示最后执行的操作
	return `已完成 ${total} 步: ${lastAction || '操作完成'}`;
};

// 显示思考内容的摘要（外层展示用）
const getToolsSummaryWithThinking = (toolCalls) => {
	const total = toolCalls.length;
	const completed = toolCalls.filter((t) => t.status === 'success' || t.result?.success).length;
	const failed = toolCalls.filter((t) => t.status === 'error' || t.result?.error).length;
	const running = toolCalls.filter((t) => t.status === 'running').length;

	// 找到当前步骤的思考（最近一个带 thinking 的工具）
	const getCurrentThinking = () => {
		// 优先显示正在运行的工具的思考
		if (running > 0) {
			const runningIdx = toolCalls.findIndex((t) => t.status === 'running');
			// 向上找到最近的 thinking
			for (let i = runningIdx; i >= 0; i--) {
				if (toolCalls[i].thinking) return toolCalls[i].thinking;
			}
		}
		// 否则显示最后一个 thinking
		for (let i = toolCalls.length - 1; i >= 0; i--) {
			if (toolCalls[i].thinking) return toolCalls[i].thinking;
		}
		return null;
	};

	const thinking = getCurrentThinking();

	if (running > 0) {
		if (thinking) {
			return `执行中 第${completed + 1}步: ${thinking}`;
		}
		const runningTool = toolCalls.find((t) => t.status === 'running');
		return `执行中 第${completed + 1}步: ${getToolAction(runningTool) || runningTool?.name}`;
	}

	if (failed > 0) {
		return `已完成 ${completed}/${total} 步，${failed} 步失败`;
	}

	// 完成状态：显示最后的思考
	if (thinking) {
		return `已完成 ${total} 步: ${thinking}`;
	}
	return `已完成 ${total} 步`;
};

// 获取工具操作简述
const getToolAction = (tool) => {
	if (!tool) return '';
	try {
		const args = typeof tool.arguments === 'string' ? JSON.parse(tool.arguments) : tool.arguments;
		if (tool.name === 'browser') {
			switch (args?.action) {
				case 'open':
					return '打开浏览器';
				case 'goto': {
					const url = args.url || '';
					const host = url.match(/https?:\/\/([^\/]+)/)?.[1] || url.substring(0, 30);
					return `访问 ${host}`;
				}
				case 'snapshot':
				case 'snapshoot':
					return '获取页面元素';
				case 'click':
					return `点击元素 #${args.ref}`;
				case 'type':
					return `输入 "${(args.text || '').substring(0, 20)}"`;
				case 'press':
					return `按键 [${args.key}]`;
				case 'wait':
					return `等待${args.waitFor === 'network' ? '网络' : '加载'}`;
				case 'close':
					return '关闭浏览器';
				case 'evaluate':
					return '执行脚本';
				default:
					return args?.action || '操作';
			}
		}
		if (tool.name === 'exec') {
			const cmd = args?.command || '';
			return `执行 ${cmd.substring(0, 30)}${cmd.length > 30 ? '...' : ''}`;
		}
		if (tool.name === 'screenshot') {
			return '截取屏幕';
		}
		if (tool.name === 'web') {
			return `搜索 ${args?.query?.substring(0, 20) || ''}`;
		}
		return tool.name;
	} catch {
		return tool.name || '';
	}
};

// 获取工具描述（用于状态栏）
const getToolDescription = (toolName, args) => {
	try {
		const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
		if (toolName === 'browser') {
			const actionMap = {
				open: '打开浏览器',
				goto: '访问网页',
				snapshot: '获取页面元素',
				snapshoot: '获取页面元素',
				click: '点击元素',
				type: '输入文本',
				press: '按键',
				wait: '等待页面加载',
				close: '关闭浏览器',
				evaluate: '执行脚本',
			};
			return actionMap[parsedArgs?.action] || '执行操作';
		}
		if (toolName === 'exec') return '执行命令';
		if (toolName === 'screenshot') return '截取屏幕';
		return `执行 ${toolName}`;
	} catch {
		return `执行 ${toolName}`;
	}
};

// 获取状态详情（显示关键参数）
const getStatusDetail = (args) => {
	try {
		const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
		if (!parsedArgs) return '';

		// 显示关键参数
		if (parsedArgs.url) {
			const url = parsedArgs.url;
			return url.length > 50 ? url.substring(0, 50) + '...' : url;
		}
		if (parsedArgs.text) {
			return `"${parsedArgs.text}"`;
		}
		if (parsedArgs.ref !== undefined) {
			return `元素 #${parsedArgs.ref}`;
		}
		if (parsedArgs.key) {
			return `[${parsedArgs.key}]`;
		}
		if (parsedArgs.command) {
			return parsedArgs.command.substring(0, 40);
		}
		return '';
	} catch {
		return '';
	}
};

const formatToolArgs = (args) => {
	try {
		const obj = typeof args === 'string' ? JSON.parse(args) : args;
		return JSON.stringify(obj, null, 2);
	} catch {
		return args;
	}
};

const formatToolResult = (result, summarize = false) => {
	if (!result) return '';
	const cleaned = JSON.parse(JSON.stringify(result));

	// 只对 base64 图片数据做处理（太大了没必要显示）
	if (cleaned.base64) {
		cleaned.base64 = `[图片数据 ${Math.round(cleaned.base64.length / 1024)}KB]`;
	}

	// 摘要模式：用于折叠时显示简要信息
	if (summarize) {
		if (cleaned.elements && Array.isArray(cleaned.elements)) {
			cleaned.elements = `[${cleaned.elements.length} 个元素]`;
		}
		if (cleaned.text && cleaned.text.length > 200) {
			cleaned.text = cleaned.text.substring(0, 200) + '...';
		}
	}

	return JSON.stringify(cleaned, null, 2);
};

// 复制到剪贴板
const copyToClipboard = async (text) => {
	try {
		await navigator.clipboard.writeText(text);
		// 可以添加提示
	} catch (err) {
		console.error('复制失败:', err);
	}
};

// 获取原始结果用于复制
const getRawResult = (result) => {
	if (!result) return '';
	return JSON.stringify(result, null, 2);
};

const send = async () => {
	const message = input.value.trim();
	if (!message || sending.value) return;

	input.value = '';
	sending.value = true;

	try {
		await store.sendMessage(message);
	} finally {
		sending.value = false;
	}
};

// 平滑滚动到底部
const scrollToBottom = async (smooth = true) => {
	await nextTick();
	if (messagesContainer.value) {
		messagesContainer.value.scrollTo({
			top: messagesContainer.value.scrollHeight,
			behavior: smooth ? 'smooth' : 'auto',
		});
	}
};

// 监听消息和状态变化，自动滚动
watch(
	() => [store.messages, store.currentStatus, store.toolExecutions],
	async () => {
		await scrollToBottom();
	},
	{ deep: true }
);

onMounted(async () => {
	await store.loadConfig();
	store.loadSessions();
	if (!store.currentSessionId) {
		store.createSession();
	}
});
</script>

<style scoped>
.chat-container {
	@apply flex-1 flex flex-col h-screen;
	background-color: var(--bg-primary);
}

.chat-header {
	@apply h-14 flex items-center justify-between px-4;
	background-color: var(--bg-secondary);
	border-bottom: 1px solid var(--border-color);
}

.chat-header-left {
	@apply flex items-center gap-3;
}

.chat-title {
	@apply font-medium;
	color: var(--text-primary);
}

.current-model-badge {
	@apply text-xs px-2 py-1 rounded-full;
	background-color: var(--accent-subtle);
	color: var(--accent);
	border: 1px solid var(--accent);
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.messages-container {
	@apply flex-1 overflow-y-auto p-4 space-y-4;
}

/* 欢迎页面 */
.welcome-screen {
	@apply flex flex-col items-center justify-center h-full;
}

.welcome-logo {
	@apply text-6xl mb-4;
}

.welcome-title {
	@apply text-xl font-medium mb-2;
	color: var(--text-primary);
}

.welcome-desc {
	@apply text-sm;
	color: var(--text-muted);
}

.welcome-examples {
	@apply mt-6 flex flex-wrap gap-2 justify-center max-w-lg;
}

.example-btn {
	@apply px-3 py-2 text-sm rounded-lg transition-colors;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	color: var(--text-secondary);
}

.example-btn:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
	border-color: var(--accent);
}

/* 输入区域 */
.input-area {
	@apply p-4;
	background-color: var(--bg-secondary);
	border-top: 1px solid var(--border-color);
}

.input-form {
	@apply flex gap-3;
}

/* 移动端适配 */
@media (max-width: 767px) {
	.chat-header {
		@apply px-3;
	}

	.messages-container {
		@apply p-3;
	}

	.input-area {
		@apply p-3;
	}

	.input-form {
		@apply flex-col gap-2;
	}

	.input-form .btn {
		@apply w-full;
	}
}

/* 调试模态框 */
.debug-modal-overlay {
	@apply fixed inset-0 z-50 flex items-center justify-center;
	background-color: rgba(0, 0, 0, 0.8);
}

.debug-modal {
	@apply rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col;
	background-color: var(--bg-secondary);
}

.debug-modal-header {
	@apply p-4 border-b;
	border-color: var(--border-color);
}

.debug-modal-header h3 {
	@apply text-lg font-bold;
	color: var(--text-primary);
}

.debug-modal-thinking {
	@apply text-sm mt-2 p-3 rounded-lg;
	background-color: var(--bg-tertiary);
	color: var(--text-secondary);
}

.debug-modal-body {
	@apply flex-1 overflow-y-auto p-4;
}

.debug-images {
	@apply grid grid-cols-1 md:grid-cols-3 gap-4 mb-4;
}

.debug-image-item {
	@apply flex flex-col;
}

.debug-image-label {
	@apply text-sm font-medium mb-2 text-center;
	color: var(--text-secondary);
}

.debug-image {
	@apply w-full rounded-lg cursor-pointer transition-transform hover:scale-[1.02];
	border: 2px solid var(--border-color);
	max-height: 300px;
	object-fit: contain;
	background-color: #000;
}

.debug-info {
	@apply p-4 rounded-lg space-y-2;
	background-color: var(--bg-tertiary);
}

.debug-info-item {
	@apply flex items-center gap-2;
}

.debug-info-label {
	@apply text-sm font-medium;
	color: var(--text-muted);
}

.debug-info-value {
	@apply text-sm;
	color: var(--text-primary);
}

.debug-modal-footer {
	@apply p-4 border-t flex justify-end gap-3;
	border-color: var(--border-color);
}

/* 安全确认模态框 */
.security-modal-overlay {
	@apply fixed inset-0 z-50 flex items-center justify-center;
	background-color: rgba(0, 0, 0, 0.8);
}

.security-modal {
	@apply rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col;
	background-color: var(--bg-secondary);
}

.security-modal-header {
	@apply p-4 border-b;
	border-color: var(--border-color);
}

.security-modal-header h3 {
	@apply text-lg font-bold;
	color: var(--text-primary);
}

.security-modal-body {
	@apply p-4;
}

.security-message {
	@apply p-4 rounded-lg mb-4 text-sm leading-relaxed;
	background-color: var(--bg-tertiary);
	color: var(--text-primary);
}

.security-info {
	@apply p-4 rounded-lg space-y-2;
	background-color: var(--bg-tertiary);
}

.security-info-item {
	@apply flex items-center gap-2;
}

.security-info-label {
	@apply text-sm font-medium;
	color: var(--text-muted);
}

.security-info-value {
	@apply text-sm font-mono;
	color: var(--text-primary);
}

.security-modal-footer {
	@apply p-4 border-t flex justify-end gap-3;
	border-color: var(--border-color);
}
</style>
