<template>
	<div class="chat-layout">
		<!-- 侧边栏 -->
		<aside v-if="showSidebar" class="sidebar">
			<div class="sidebar-header">
				<span class="sidebar-title">聊天历史</span>
				<button class="sidebar-toggle" @click="showSidebar = false" title="收起侧边栏">
					&lt;
				</button>
			</div>

			<!-- 新建对话按钮 -->
			<button class="new-chat-btn" @click="createNewChat">
				<span>+</span> 新建对话
			</button>

			<!-- 会话列表 -->
			<div class="session-list">
				<div
					v-for="session in store.sessions"
					:key="session.id"
					class="session-item"
					:class="{ active: isCurrentSession(session.id) }"
					@click="selectSession(session.id)"
				>
					<div class="session-info">
						<span class="session-icon">
							{{ session.id === store.currentSessionId ? '💬' : '📝' }}
						</span>
						<div class="session-details">
							<span class="session-title" :title="session.title">
								{{ getShortTitle(session.title) }}
							</span>
							<span class="session-time">{{ formatTime(session.updatedAt) }}</span>
						</div>
					</div>
					<button
						class="session-delete"
						@click="deleteSession(session.id, $event)"
						title="删除会话"
					>
						×
					</button>
				</div>

				<!-- 空状态 -->
				<div v-if="!store.sessions || store.sessions.length === 0" class="sidebar-empty">
					暂无历史对话
				</div>
			</div>

			<!-- 侧边栏底部 -->
			<div class="sidebar-footer">
				<button
					class="clear-all-btn"
					@click="handleClearAllSessions"
					:disabled="!store.sessions || store.sessions.length === 0"
				>
					清空全部对话
				</button>
			</div>
		</aside>

		<!-- 隐藏侧边栏时显示的展开按钮 -->
		<div v-if="!showSidebar" class="sidebar-collapsed">
			<button class="sidebar-expand-btn" @click="showSidebar = true" title="显示侧边栏">
				&gt;
			</button>
		</div>

		<!-- 确认清空模态框 -->
		<div v-if="confirmClearAll" class="confirm-modal-overlay" @click="confirmClearAll = false">
			<div class="confirm-modal" @click.stop>
				<div class="confirm-modal-title">确认清空</div>
				<div class="confirm-modal-body">
					确定要删除所有聊天历史吗？此操作不可恢复。
				</div>
				<div class="confirm-modal-footer">
					<button class="btn btn-secondary" @click="confirmClearAll = false">取消</button>
					<button class="btn btn-danger" @click="confirmClearAllSessions">确定删除</button>
				</div>
			</div>
		</div>

		<!-- 聊天主容器 -->
		<div class="chat-container">
		<!-- 头部 -->
		<header class="chat-header">
			<div class="chat-header-left">
				<h2 class="chat-title">{{ store.currentSession?.title || '新对话' }}</h2>
				<!-- Agent 选择器 -->
				<div class="agent-selector">
					<button class="agent-selector-btn" @click="showAgentDropdown = !showAgentDropdown">
						<span class="agent-selector-icon">{{ currentAgent?.icon || '🤖' }}</span>
						<span class="agent-selector-name">{{ currentAgent?.name || 'Agent' }}</span>
						<span class="agent-selector-arrow">▼</span>
					</button>
					<div v-if="showAgentDropdown" class="agent-dropdown" @click.stop>
						<div
							v-for="agent in store.agents"
							:key="agent.id"
							class="agent-dropdown-item"
							:class="{ active: store.currentAgentId === agent.id }"
							@click="selectAgent(agent.id)"
						>
							<span class="agent-dropdown-icon">{{ agent.icon || '🤖' }}</span>
							<span class="agent-dropdown-name">{{ agent.name }}</span>
							<span v-if="store.currentAgentId === agent.id" class="agent-dropdown-check">✓</span>
						</div>
					</div>
				</div>
				<!-- 当前模型显示（可点击切换） -->
				<div class="current-model" :title="currentModelDisplay" @click="showModelDropdown = !showModelDropdown">
					<span class="model-icon">🧠</span>
					<span class="model-name">{{ currentModelShortName }}</span>
					<span class="model-arrow">▼</span>
					<!-- 模型选择下拉框 -->
					<div v-if="showModelDropdown" class="model-dropdown" @click.stop>
						<div class="model-dropdown-header">选择默认模型</div>
						<div
							v-for="model in enabledModels"
							:key="model.id"
							class="model-dropdown-item"
							:class="{ active: defaultModelId === model.id }"
							@click="selectDefaultModel(model.id)"
						>
							<span class="model-dropdown-name">{{ model.name }}</span>
							<span class="model-dropdown-provider">({{ model.providerId }})</span>
							<span v-if="defaultModelId === model.id" class="model-dropdown-check">✓</span>
						</div>
						<div v-if="enabledModels.length === 0" class="model-dropdown-empty">
							暂无可用模型，请先在 Provider 页面添加
						</div>
					</div>
				</div>
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
					<!-- 用户消息 -->
					<template v-for="msg in groupedMessages" :key="msg.id">
					<!-- 用户消息 -->
					<div v-if="msg.role === 'user'" class="msg msg-user">
						<div class="msg-content user-bubble">{{ msg.content }}</div>
					</div>
					
					<!-- AI 消息 -->
					<div v-else class="msg msg-ai">
						<div class="msg-body">
							<!-- AI 名称 + 实时状态 -->
							<div class="ai-header">
								<span class="ai-name">{{ aiName }}</span>
								<span v-if="msg.streaming || hasRunningTools(msg)" class="ai-status">
									<template v-if="hasRunningTools(msg)">
										正在执行 {{ getRunningToolName(msg) }}...
									</template>
									<template v-else>
										正在输入...
									</template>
								</span>
							</div>
							
							<!-- 工具调用（流式横向布局）-->
							<div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls">
								<div class="tool-calls-header" @click="toggleTools(msg.id)">
									<div class="tool-flow-list">
										<div
											v-for="(tool, idx) in msg.toolCalls"
											:key="idx"
											class="tool-flow-item"
											:class="{
												running: tool.status === 'running',
												success: tool.status === 'success' || tool.result?.success,
												error: tool.status === 'error' || tool.result?.error,
											}"
										>
											<span class="tool-flow-icon">
												<span v-if="tool.status === 'running'" class="spin">⚙️</span>
												<span v-else-if="tool.status === 'success' || tool.result?.success">✅</span>
												<span v-else-if="tool.status === 'error' || tool.result?.error">❌</span>
												<span v-else>🔧</span>
											</span>
											<span class="tool-flow-name">{{ getToolChineseName(tool) }}</span>
										</div>
									</div>
									<span class="tool-calls-toggle">{{ isToolsExpanded(msg.id) ? '收起' : '展开' }}</span>
								</div>
								
								<div v-if="isToolsExpanded(msg.id)" class="tool-calls-list">
									<div
										v-for="(tool, idx) in msg.toolCalls"
										:key="idx"
										class="tool-call-item"
									>
										<div class="tool-call-row" @click.stop="toggleToolDetail(msg.id, idx)">
											<span class="tool-icon">
												<span v-if="tool.status === 'running'" class="spin">⚙️</span>
												<span v-else-if="tool.status === 'success' || tool.result?.success">✅</span>
												<span v-else-if="tool.status === 'error' || tool.result?.error">❌</span>
												<span v-else>🔧</span>
											</span>
											<span class="tool-name">{{ getToolChineseName(tool) }}</span>
											<span class="tool-duration">{{ formatToolDuration(tool) }}</span>
											<span class="tool-expand">{{ isToolExpanded(msg.id, idx) ? '−' : '+' }}</span>
										</div>
										<div v-if="isToolExpanded(msg.id, idx)" class="tool-detail">
											<div class="tool-section">
												<div class="tool-section-head">
													<span>参数</span>
													<button class="copy-btn" @click.stop="copyToClipboard(formatToolArgs(tool.arguments))">📋 复制</button>
												</div>
												<pre class="tool-code">{{ formatToolArgs(tool.arguments) }}</pre>
											</div>
										<!-- 系统截图工具 (screenshot) 的截图显示 -->
												<div v-if="tool.name === 'screenshot' && (tool.result?.base64 || tool.result?.savedPath)" class="tool-section">
													<div class="tool-section-head"><span>截图预览</span></div>
													<div class="screenshot-box" @click="openImageModal(tool.result.base64 || tool.result.savedPath)">
														<img 
															:src="tool.result.savedPath ? getSystemScreenshotUrl(tool.result.savedPath) : 'data:image/jpeg;base64,' + tool.result.base64" 
															alt="截图" 
														/>
														<div class="screenshot-hover">🔍 点击放大</div>
													</div>
												</div>
												<!-- computer 工具的截图显示（点击、拖拽等操作后的屏幕状态） -->
												<div v-if="tool.name === 'computer' && tool.result?.screenshot?.base64" class="tool-section">
													<div class="tool-section-head"><span>操作后屏幕状态</span></div>
													<div class="screenshot-box" @click="openImageModal('data:image/png;base64,' + tool.result.screenshot.base64)">
														<img 
															:src="'data:image/png;base64,' + tool.result.screenshot.base64" 
															alt="操作后截图" 
														/>
														<div class="screenshot-hover">🔍 点击放大</div>
													</div>
												</div>
											<!-- 浏览器工具 (browser) 的截图显示 -->
											<div v-if="tool.name === 'browser' && tool.result?.action === 'screenshot' && tool.result?.imageUrl" class="tool-section">
												<div class="tool-section-head"><span>浏览器截图预览</span></div>
												<div class="screenshot-box" @click="openBrowserImageModal(tool.result.imageUrl)">
													<img :src="tool.result.imageUrl" alt="浏览器截图" />
													<div class="screenshot-hover">🔍 点击放大</div>
												</div>
											</div>
													<!-- computer 工具的点击标记截图显示 -->
													<div v-if="tool.name === 'computer' && tool.result?.markedScreenshot" class="tool-section">
														<div class="tool-section-head"><span>点击位置标记</span></div>
														<div class="screenshot-box" @click="openMarkedScreenshotModal(tool.result.markedScreenshot)">
															<img 
																:src="getMarkedScreenshotUrl(tool.result.markedScreenshot)" 
																alt="点击标记"
															/>
															<div class="screenshot-hover">🔍 点击放大</div>
														</div>
													</div>
											<div v-if="tool.result" class="tool-section">
												<div class="tool-section-head">
													<span>结果</span>
													<button class="copy-btn" @click.stop="copyToClipboard(getRawResult(tool.result))">📋 复制</button>
												</div>
												<pre class="tool-code" :class="{ error: tool.result?.error, 'browser-snapshot': tool.result?.action === 'snapshot' }">{{ formatToolResult(tool.result, false) }}</pre>
											</div>
										</div>
									</div>
								</div>
							</div>
							
							<!-- 消息文本（包含思考内容和回复内容） -->
							<div v-if="getFullMessageContent(msg)" class="msg-text markdown" v-html="renderMarkdown(getFullMessageContent(msg) + (msg.streaming ? '▊' : ''))"></div>
							<div v-else-if="msg.streaming && msg.content" class="msg-text markdown" v-html="renderMarkdown(msg.content + '▊')"></div>
							<div v-else-if="!msg.streaming && !msg.content && !msg.error" class="msg-text markdown text-gray-500">无内容</div>
							<div v-if="msg.error" class="msg-error">
								<div class="error-icon">❌</div>
								<div class="error-content">
									<div class="error-title">发生错误</div>
									<div class="error-message">{{ msg.error }}</div>
								</div>
							</div>
						</div>
					</div>
				</template>
			</template>

			<!-- 实时状态（简化版，当没有消息正在流式输出时显示）-->
			<div v-if="store.currentStatus && store.currentStatus.type !== 'sending' && !hasStreamingMessage" class="msg msg-ai status-msg">
				<div class="msg-body">
					<div class="ai-header">
						<span class="ai-name">{{ aiName }}</span>
						<span class="ai-status">{{ getCurrentStatusText() }}</span>
					</div>
					<div class="status-cursor">▊</div>
				</div>
			</div>
		</div>

		<!-- 输入框 -->
		<div class="input-area">
			<div class="input-form">
				<div class="textarea-container">
					<textarea
						v-model="input"
						@keydown="handleKeydown"
						@input="autoResize"
						@paste="handlePaste"
						ref="textareaRef"
						placeholder="输入消息...（Shift+Enter换行，Enter发送）"
						class="input-textarea"
						:disabled="sending"
						rows="1"
					></textarea>
					<div class="input-actions">
						<button 
							v-if="hasActiveChat"
							@click="stopChat"
							class="btn btn-secondary stop-btn"
							title="停止当前对话"
						>
							⏹️ 停止
						</button>
						<button 
							@click="send"
							class="btn btn-primary" 
							:disabled="!input.trim() || sending"
							title="发送消息"
						>
							{{ sending ? '发送中...' : '发送' }}
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- 图片预览模态框（系统截图） -->
		<div v-if="imageModal.visible" class="image-modal" @click="closeImageModal">
			<div class="image-modal-content" @click.stop>
				<button class="image-modal-close" @click="closeImageModal">✕</button>
				<img :src="imageModal.base64.startsWith('data:') ? imageModal.base64 : 'data:image/jpeg;base64,' + imageModal.base64" class="image-modal-img" />
			</div>
		</div>

		<!-- 浏览器截图预览模态框 -->
		<div v-if="browserImageModal.visible" class="image-modal" @click="closeBrowserImageModal">
			<div class="image-modal-content" @click.stop>
				<button class="image-modal-close" @click="closeBrowserImageModal">✕</button>
				<img :src="browserImageModal.imageUrl" class="image-modal-img" />
			</div>
		</div>

											<!-- 标记截图预览模态框 -->
											<div v-if="markedScreenshotModal.visible" class="image-modal" @click="closeMarkedScreenshotModal">
												<div class="image-modal-content" @click.stop>
													<button class="image-modal-close" @click="closeMarkedScreenshotModal">✕</button>
													<div class="image-modal-info">
														<div class="image-modal-title">🎯 点击位置标记</div>
														<div class="image-modal-path">{{ markedScreenshotModal.imagePath }}</div>
													</div>
													<img 
														:src="getMarkedScreenshotUrl(markedScreenshotModal.imagePath)" 
														class="image-modal-img"
														@error="(e) => console.error('模态框截图加载失败:', markedScreenshotModal.imagePath, 'URL:', getMarkedScreenshotUrl(markedScreenshotModal.imagePath), '错误:', e)"
													/>
												</div>
											</div>

		<!-- 调试确认模态框 -->
		<div v-if="store.debugConfirm" class="debug-modal-overlay">
			<div class="debug-modal">
				<div class="debug-modal-header">
					<h3>🔍 调试模式 - 确认操作</h3>
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
</div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { marked } from 'marked';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';

const store = useAppStore();

// Agent 选择器
const showAgentDropdown = ref(false);

// 模型选择器
const showModelDropdown = ref(false);
const modelLibrary = ref({ models: [], defaultModelId: null });

// 加载模型库
const loadModelLibrary = async () => {
	try {
		const result = await api.get('/api/models');
		modelLibrary.value = result;
	} catch (error) {
		console.error('加载模型库失败:', error);
	}
};

// 启用的模型列表
const enabledModels = computed(() => {
	return modelLibrary.value.models.filter(m => m.enabled);
});

// 默认模型 ID
const defaultModelId = computed(() => modelLibrary.value.defaultModelId);

// 选择默认模型
const selectDefaultModel = async (modelId) => {
	try {
		await api.post('/api/models/default', { modelId });
		modelLibrary.value.defaultModelId = modelId;
		toast.success('默认模型已更新');
	} catch (error) {
		toast.error('设置默认模型失败: ' + error.message);
	}
	showModelDropdown.value = false;
};

const currentAgent = computed(() => {
	return store.agents.find(a => a.id === store.currentAgentId);
});

const selectAgent = async (id) => {
	try {
		await store.setCurrentAgent(id);
	} catch (error) {
		console.error('Failed to set agent:', error);
	}
	showAgentDropdown.value = false;
};

// ========== 会话侧边栏 ==========
const showSidebar = ref(true);
const confirmClearAll = ref(false);

// 创建新对话
const createNewChat = async () => {
	await store.createSession();
};

// 选择会话
const selectSession = (sessionId) => {
	store.selectSession(sessionId);
};

// 删除单个会话
const deleteSession = async (sessionId, event) => {
	event.stopPropagation();
	event.preventDefault();
	if (sessionId === store.currentSessionId) {
		const otherSession = store.sessions.find(s => s.id !== sessionId);
		if (otherSession) {
			store.selectSession(otherSession.id);
		} else {
			await store.createSession();
		}
	}
	await store.deleteSession(sessionId);
};

// 确认清空全部会话
const handleClearAllSessions = () => {
	confirmClearAll.value = true;
};

// 确认执行清空
const confirmClearAllSessions = async () => {
	await store.clearAllSessions();
	confirmClearAll.value = false;
	await store.createSession();
};

// 格式化时间
const formatTime = (dateStr) => {
	try {
		const date = new Date(dateStr);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		if (days === 0) {
			return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
		} else if (days === 1) {
			return '昨天';
		} else if (days < 7) {
			return `${days} 天前`;
		} else {
			return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
		}
	} catch {
		return '';
	}
};

// 获取简短标题
const getShortTitle = (title, maxLen = 12) => {
	if (!title) return '新对话';
	return title.length > maxLen ? title.substring(0, maxLen) + '...' : title;
};

// 判断是否为当前会话
const isCurrentSession = (sessionId) => {
	return sessionId === store.currentSessionId;
};

// 点击外部关闭下拉菜单
const handleClickOutside = (event) => {
	if (showAgentDropdown.value && !event.target.closest('.agent-selector')) {
		showAgentDropdown.value = false;
	}
	if (showModelDropdown.value && !event.target.closest('.current-model')) {
		showModelDropdown.value = false;
	}
};

onMounted(() => {
	document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
	document.removeEventListener('click', handleClickOutside);
});

// 当前模型显示（优先使用 modelLibrary 中的默认模型）
const currentModelRef = computed(() => {
	// 优先使用 modelLibrary 中设置的默认模型
	if (modelLibrary.value.defaultModelId) {
		return modelLibrary.value.defaultModelId;
	}
	// 否则使用当前 Agent 配置的模型
	if (currentAgent.value?.model) {
		return currentAgent.value.model;
	}
	// 最后使用全局默认模型
	return store.config?.agent?.defaultModel || '';
});

const currentModelDisplay = computed(() => {
	return currentModelRef.value;
});

const currentModelShortName = computed(() => {
	const modelRef = currentModelRef.value;
	if (!modelRef) return '未设置模型';
	const [providerId, ...modelParts] = modelRef.split('/');
	const modelName = modelParts.join('/');
	// 简化模型名称显示
	if (modelName.length > 25) {
		return modelName.substring(0, 22) + '...';
	}
	return modelName || modelRef;
});

// AI 名称
const aiName = computed(() => {
	return store.config?.user?.aiName || 'NutBot';
});

// 消息列表（不再合并连续的 assistant 消息）
const groupedMessages = computed(() => {
	const messages = store.messages;
	if (!messages || messages.length === 0) return [];
	
	// 直接返回原始消息列表，不再合并
	// 每个 assistant 消息会独立显示，避免内容重复
	return messages;
});

// 格式化工具执行时间
const formatToolDuration = (tool) => {
	if (!tool.duration && tool.duration !== 0) {
		if (tool.status === 'running') return '执行中...';
		return '';
	}
	
	const ms = tool.duration;
	
	if (ms < 1000) {
		return `${ms}ms`;
	} else if (ms < 60000) {
		return `${(ms / 1000).toFixed(1)}s`;
	} else {
		const minutes = Math.floor(ms / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}
};

// 检查消息是否有正在运行的工具
const hasRunningTools = (msg) => {
	return msg.toolCalls?.some(t => t.status === 'running');
};

// 获取正在运行的工具名
const getRunningToolName = (msg) => {
	const runningTool = msg.toolCalls?.find(t => t.status === 'running');
	return getToolDisplayName(runningTool);
};

// 检查是否有正在流式输出的消息
const hasStreamingMessage = computed(() => {
	return store.messages.some(m => m.streaming || hasRunningTools(m));
});

// 检查是否有活跃的聊天（用于显示停止按钮）
const hasActiveChat = computed(() => {
	return sending.value || hasStreamingMessage.value;
});

// 获取当前状态文本
const getCurrentStatusText = () => {
	if (!store.currentStatus) return '';
	switch (store.currentStatus.type) {
		case 'thinking': return '正在分析...';
		case 'generating': return '正在输入...';
		case 'status': return store.currentStatus.status;
		case 'tool_running': {
			const tool = store.currentStatus.tool;
			const action = store.currentStatus.action;
			const displayName = action ? `${tool}.${action}` : tool;
			return `正在执行 ${displayName}...`;
		}
		case 'tool_done': return '执行完成';
		case 'tool_error': return '执行出错';
		default: return '';
	}
};

// 工具栏头部文字
const getToolsHeaderText = (toolCalls) => {
	const total = toolCalls.length;
	const completed = toolCalls.filter((t) => t.status === 'success' || t.result?.success).length;
	const failed = toolCalls.filter((t) => t.status === 'error' || t.result?.error).length;
	const running = toolCalls.filter((t) => t.status === 'running').length;

	if (running > 0) {
		const runningTool = toolCalls.find((t) => t.status === 'running');
		const displayName = getToolDisplayName(runningTool);
		return `执行中 ${completed + 1}/${total}: ${displayName}`;
	}

	if (failed > 0) {
		return `已完成 ${completed}/${total}，${failed} 失败`;
	}

	return `已完成 ${total} 步`;
};

const input = ref('');
const sending = ref(false);
const messagesContainer = ref(null);
const executionStatus = ref(null);
const expandedTools = ref(new Set());
const expandedToolsGroup = ref(new Set());
const textareaRef = ref(null);

// 图片预览模态框（用于系统截图的 base64）
const imageModal = ref({
	visible: false,
	base64: '',
});

const openImageModal = (base64) => {
	imageModal.value.base64 = base64;
	imageModal.value.visible = true;
};

// 浏览器截图预览模态框（用于浏览器截图的 URL）
const browserImageModal = ref({
	visible: false,
	imageUrl: '',
});

const openBrowserImageModal = (imageUrl) => {
	browserImageModal.value.imageUrl = imageUrl;
	browserImageModal.value.visible = true;
};

const closeBrowserImageModal = () => {
	browserImageModal.value.visible = false;
	browserImageModal.value.imageUrl = '';
};

// 标记截图预览模态框（用于 computer 工具的点击标记截图）
const markedScreenshotModal = ref({
	visible: false,
	imagePath: '',
});

const openMarkedScreenshotModal = (imagePath) => {
	markedScreenshotModal.value.imagePath = imagePath;
	markedScreenshotModal.value.visible = true;
};

const closeMarkedScreenshotModal = () => {
	markedScreenshotModal.value.visible = false;
	markedScreenshotModal.value.imagePath = '';
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
	// 【关键】将单个换行符转换为 <br> 标签，确保换行正确显示
	// marked 默认会把单个换行符转为空格，只有双换行符才会产生新段落
	// 使用负向回顾断言，不把双换行中的第一个换行替换掉
	cleaned = cleaned.replace(/(?<!\n)\n(?!\n)/g, '<br>');
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

// 工具中文名称映射
const toolNameMap = {
	// 浏览器工具
	browser: '浏览器',
	// 截图工具
	screenshot: '截图',
	// 电脑控制工具
	computer: '电脑控制',
	// 命令执行工具
	exec: '执行命令',
	// 文件工具
	file: '文件操作',
	// MCP 工具
	mcp: '扩展工具',
};

// 获取工具中文名称
const getToolChineseName = (tool) => {
	if (!tool) return '';
	const chineseName = toolNameMap[tool.name] || tool.name;
	const action = getToolAction(tool);
	if (action) {
		return `${chineseName} · ${action}`;
	}
	return chineseName;
};

// 获取工具显示名称（格式：工具名.action）
const getToolDisplayName = (tool) => {
	if (!tool) return '';
	const action = tool.action || '';
	if (action && tool.name) {
		return `${tool.name}.${action}`;
	}
	return tool.name || '';
};

// 获取工具操作简述
const getToolAction = (tool) => {
	if (!tool) return '';
	// 优先使用已解析的 action
	if (tool.action) return tool.action;
	// 否则从 params 或 arguments 中解析
	try {
		const params = tool.params || tool.arguments;
		const args = typeof params === 'string' ? JSON.parse(params) : params;
		const method = args?.method || args?.action || '';
		
		if (tool.name === 'browser') {
			switch (method) {
				case 'open':
					return '打开浏览器';
				case 'goto': {
					const url = args.url || '';
					const host = url.match(/https?:\/\/([^\/]+)/)?.[1] || url.substring(0, 30);
					return `访问 ${host}`;
				}
				case 'state':
				case 'snapshot':
				case 'snapshoot':
					return '获取页面状态';
				case 'click':
					return `点击元素 #${args.ref}`;
				case 'type':
					return `输入 "${(args.text || '').substring(0, 20)}"`;
				case 'press':
					return `按键 [${args.key}]`;
				case 'scroll':
					return `滚动页面`;
				case 'tabs':
					return '获取标签页列表';
				case 'switch_tab':
					return '切换标签页';
				case 'back':
					return '后退';
				case 'wait':
					return `等待${args.waitFor === 'network' ? '网络' : '加载'}`;
				case 'close':
					return '关闭浏览器';
				case 'evaluate':
					return '执行脚本';
				case 'screenshot':
					return '浏览器截图';
				default:
					return method || '浏览器操作';
			}
		}
		if (tool.name === 'screenshot') {
			switch (method) {
				case 'capture':
					return '截取屏幕';
				case 'save':
					return '保存截图';
				case 'list_screens':
					return '获取截图列表';
				default:
					return '截图操作';
			}
		}
		if (tool.name === 'computer') {
			switch (method) {
				case 'mouse_move':
					return `移动鼠标到 (${args.x}, ${args.y})`;
				case 'left_click':
					return '左键点击';
				case 'right_click':
					return '右键点击';
				case 'double_click':
					return '双击';
				case 'scroll':
					return `滚动 ${args.direction || ''}`;
				case 'type':
					return `输入 "${(args.text || '').substring(0, 20)}"`;
				case 'key':
					return `按键 [${args.key}]`;
				case 'hotkey':
					return `快捷键 [${args.keys?.join('+') || args.hotkey}]`;
				case 'cursor_position':
					return '获取鼠标位置';
				case 'list_elements':
					return '获取界面元素';
				case 'click_element':
					return `点击元素 #${args.element_id}`;
				default:
					return method || '电脑操作';
			}
		}
		if (tool.name === 'exec') {
			const cmd = args?.command || '';
			return `执行 ${cmd.substring(0, 30)}${cmd.length > 30 ? '...' : ''}`;
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
		const method = parsedArgs?.method || parsedArgs?.action || '';
		
		if (toolName === 'browser') {
			const actionMap = {
				open: '打开浏览器',
				goto: '访问网页',
				state: '获取页面状态',
				snapshot: '获取页面元素',
				snapshoot: '获取页面元素',
				click: '点击元素',
				type: '输入文本',
				press: '按键',
				scroll: '滚动页面',
				tabs: '获取标签页',
				switch_tab: '切换标签页',
				back: '后退',
				wait: '等待页面加载',
				close: '关闭浏览器',
				evaluate: '执行脚本',
				screenshot: '浏览器截图',
			};
			return actionMap[method] || '浏览器操作';
		}
		if (toolName === 'screenshot') {
			const actionMap = {
				capture: '截取屏幕',
				save: '保存截图',
				list_screens: '获取截图列表',
			};
			return actionMap[method] || '截图操作';
		}
		if (toolName === 'computer') {
			const actionMap = {
				mouse_move: '移动鼠标',
				left_click: '左键点击',
				right_click: '右键点击',
				double_click: '双击',
				scroll: '滚动',
				type: '输入文本',
				key: '按键',
				hotkey: '快捷键',
				cursor_position: '获取鼠标位置',
				list_elements: '获取界面元素',
				click_element: '点击元素',
			};
			return actionMap[method] || '电脑操作';
		}
		if (toolName === 'exec') return '执行命令';
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

	// 特殊处理 browser snapshot - 优先显示增强分析
	if (cleaned.action === 'snapshot' && cleaned.compressedText) {
		let displayText = `🗜️ 页面结构分析

${cleaned.compressedText}`;

		// 如果不是摘要模式，添加分隔线和完整数据
		if (!summarize) {
			displayText += `

═══════════════════════════════════════════════════════════

📋 完整数据:`;
			
			// 处理base64图片数据
			if (cleaned.base64) {
				cleaned.base64 = `[图片数据 ${Math.round(cleaned.base64.length / 1024)}KB]`;
			}
			
			// 摘要模式下简化元素显示
			if (cleaned.elements && Array.isArray(cleaned.elements)) {
				if (summarize) {
					cleaned.elements = `[${cleaned.elements.length} 个元素]`;
				} else {
					displayText += `

🔍 元素列表（共 ${cleaned.elements.length} 个）:`;
				}
			}
			
			displayText += `

${JSON.stringify(cleaned, null, 2)}`;
		}

		return displayText;
	}

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

// 获取标记截图的 URL
const getMarkedScreenshotUrl = (filePath) => {
	if (!filePath) return '';
	// 从完整路径中提取文件名
	const filename = filePath.split(/[\\/]/).pop();
	if (!filename) return '';
	// 使用后端 API 地址
	return `${api.getBaseUrl()}/screenshots/marked-clicks/${filename}`;
};

// 获取系统截图的 URL
const getSystemScreenshotUrl = (filePath) => {
	if (!filePath) return '';
	// 从完整路径中提取文件名
	const filename = filePath.split(/[\\/]/).pop();
	if (!filename) return '';
	// 使用后端 API 地址
	return `${api.getBaseUrl()}/screenshots/system/${filename}`;
};

// 提取 <thinking> 标签内容
const extractThinking = (content) => {
	if (!content) return { thinking: '', content: content };

	// 匹配两种格式：
	// 1. <thinking>\n...\n</thinking> (多行格式)
	// 2. <thinking>...</thinking> (无换行格式)
	const match = content.match(/<thinking>\n?([\s\S]*?)\n?<\/thinking>/);
	if (match) {
		const thinking = match[1].trim();
		// 移除 thinking 标签，保留剩余内容
		const remaining = content.replace(/<thinking>\n?[\s\S]*?\n?<\/thinking>\n?\n?/g, '').trim();
		return { thinking, content: remaining };
	}

	return { thinking: '', content };
};

// 获取消息的思考内容（优先从 metadata.thinking，其次 thinkingContent，否则从内容提取）
const getMessageThinking = (msg) => {
	// 优先从 metadata 获取
	if (msg?.metadata?.thinking) {
		return msg.metadata.thinking;
	}
	// 其次从 thinkingContent 获取（实时流式传输时）
	if (msg?.thinkingContent) {
		return msg.thinkingContent;
	}
	// 否则从内容提取
	if (!msg?.content) return '';
	const { thinking } = extractThinking(msg.content);
	return thinking;
};

// 获取消息去除思考后的内容
const getMessageContent = (msg) => {
	// 优先从 content 获取
	if (msg?.content) {
		const { content } = extractThinking(msg.content);
		return content || msg.content;
	}
	// 如果没有 content 但有 thinkingContent，返回空（思考内容会单独显示）
	return '';
};

// 获取完整消息内容（思考内容 + 回复内容，作为普通文本显示）
const getFullMessageContent = (msg) => {
	if (!msg) return '';
	
	let content = '';
	
	// 如果有 content，直接使用（包含 <thinking> 标签的内容）
	if (msg.content) {
		content = msg.content;
	}
	
	// 如果有 thinkingContent（实时流式传输时），追加到内容中
	if (msg.thinkingContent) {
		if (content) {
			content = content + '\n\n' + msg.thinkingContent;
		} else {
			content = msg.thinkingContent;
		}
	}
	
	return content;
};

// 键盘事件处理
const handleKeydown = (event) => {
	if (event.key === 'Enter') {
		if (event.shiftKey) {
			// Shift + Enter: 换行
			return;
		} else {
			// Enter: 发送消息
			event.preventDefault();
			send();
		}
	}
};

// 自动调整textarea高度
const autoResize = () => {
	const textarea = textareaRef.value;
	if (textarea) {
		textarea.style.height = 'auto';
		textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'; // 最大高度200px
	}
};

// 处理粘贴事件（保持格式）
const handlePaste = (event) => {
	// 默认行为即可，保持粘贴的格式
};

// 停止聊天
const stopChat = () => {
	console.log('[Chat] stopChat() 被调用，当前状态:', {
		sending: sending.value,
		wsReadyState: store.ws?.readyState,
		hasActiveChat: hasActiveChat.value
	});
	
	// 添加用户反馈
	store.currentStatus = { type: 'status', message: '正在停止...' };
	
	// 直接发送中断消息，不再检查 sending.value
	// 因为中断的目的就是取消正在进行的操作
	if (store.ws) {
		const wsState = store.ws.readyState;
		console.log('[Chat] WebSocket 状态:', wsState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
		
		if (wsState === 1) { // WebSocket.OPEN
			console.log('[Chat] 发送中断消息...');
			store.ws.send(JSON.stringify({
				type: 'chat_interrupt',
				payload: {
					reason: 'user_requested',
				},
			}));
			console.log('[Chat] 中断消息已发送');
		} else if (wsState === 0) { // WebSocket.CONNECTING
			console.log('[Chat] WebSocket 正在连接，等待连接后发送中断');
			// 等待连接打开后发送
			store.ws.addEventListener('open', () => {
				console.log('[Chat] WebSocket 已连接，发送中断消息');
				store.ws.send(JSON.stringify({
					type: 'chat_interrupt',
					payload: {
						reason: 'user_requested',
					},
				}));
			}, { once: true });
		} else {
			console.warn('[Chat] WebSocket 未连接，无法发送中断消息');
		}
	} else {
		console.warn('[Chat] WebSocket 对象不存在');
	}
	
	// 立即重置状态
	sending.value = false;
	store.currentStatus = null;
	store.toolExecutions = [];
	
	console.log('[Chat] stopChat() 完成');
};

const send = async () => {
	const message = input.value.trim();
	if (!message || sending.value) return;

	// 如果没有会话，先创建
	if (!store.currentSessionId) {
		await store.createSession();
	}

	sending.value = true;

	try {
		await store.sendMessage(message);
		// 清空输入框
		input.value = '';
		// 重置textarea高度
		await nextTick();
		autoResize();
		// 聚焦到textarea
		textareaRef.value?.focus();
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
	await store.loadAgents(); // 加载 Agent Profiles
	await store.loadSessions(); // 确保会话加载完成后再继续
	await loadModelLibrary(); // 加载模型库
	// 不自动创建会话，发送消息时才创建
});
</script>

<style scoped>
.chat-layout {
	display: flex;
	flex: 1;
	height: 100vh;
	background-color: var(--bg-primary);
}

.chat-container {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-width: 0;
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

/* Agent 选择器 */
.agent-selector {
	position: relative;
}

.agent-selector-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 10px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	cursor: pointer;
	transition: all 0.15s;
}

.agent-selector-btn:hover {
	border-color: var(--accent);
}

.agent-selector-icon {
	font-size: 14px;
}

.agent-selector-name {
	font-size: 12px;
	font-weight: 500;
	color: var(--text-primary);
	max-width: 120px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.agent-selector-arrow {
	font-size: 8px;
	color: var(--text-muted);
}

/* 当前模型显示 */
.current-model {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	cursor: pointer;
	position: relative;
	transition: background-color 0.15s;
}

.current-model:hover {
	background-color: var(--bg-hover);
}

.current-model .model-icon {
	font-size: 12px;
}

.current-model .model-name {
	font-size: 12px;
	color: var(--text-muted);
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: ui-monospace, monospace;
}

.current-model .model-arrow {
	font-size: 10px;
	color: var(--text-muted);
	margin-left: 2px;
}

.agent-dropdown {
	position: absolute;
	top: 100%;
	left: 0;
	z-index: 50;
	min-width: 180px;
	margin-top: 4px;
	padding: 6px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.agent-dropdown-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.15s;
}

.agent-dropdown-item:hover {
	background-color: var(--bg-hover);
}

.agent-dropdown-item.active {
	background-color: var(--accent-subtle);
}

.agent-dropdown-icon {
	font-size: 16px;
}

.agent-dropdown-name {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
}

.agent-dropdown-check {
	font-size: 12px;
	color: var(--accent);
}

/* 模型下拉框样式 */
.model-dropdown {
	position: absolute;
	top: 100%;
	left: 0;
	z-index: 50;
	min-width: 220px;
	margin-top: 4px;
	padding: 6px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.model-dropdown-header {
	padding: 8px 10px;
	font-size: 12px;
	font-weight: 600;
	color: var(--text-muted);
	border-bottom: 1px solid var(--border-color);
	margin-bottom: 4px;
}

.model-dropdown-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.15s;
}

.model-dropdown-item:hover {
	background-color: var(--bg-hover);
}

.model-dropdown-item.active {
	background-color: var(--accent-subtle);
}

.model-dropdown-name {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
}

.model-dropdown-provider {
	font-size: 11px;
	color: var(--text-muted);
}

.model-dropdown-check {
	font-size: 12px;
	color: var(--accent);
}

.model-dropdown-empty {
	padding: 12px;
	text-align: center;
	font-size: 12px;
	color: var(--text-muted);
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
	flex: 1;
	overflow-y: auto;
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 24px;
	max-width: 900px;
	margin: 0 auto;
	width: 100%;
}

/* ========== Gemini 风格消息 ========== */
.msg {
	display: flex;
	gap: 12px;
	animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
	from { opacity: 0; transform: translateY(8px); }
	to { opacity: 1; transform: translateY(0); }
}

.msg-user {
	justify-content: flex-end;
}

.msg-ai {
	align-items: flex-start;
}

.msg-body {
	flex: 1;
	min-width: 0;
	max-width: 100%;
}

/* AI 名称 + 状态头部 */
.ai-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}

.ai-name {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}

.ai-status {
	font-size: 12px;
	color: var(--text-muted);
	opacity: 0.8;
}

.status-cursor {
	color: var(--text-muted);
	animation: blink 1s infinite;
}

@keyframes blink {
	0%, 50% { opacity: 1; }
	51%, 100% { opacity: 0; }
}

.user-bubble {
	display: inline-block;
	max-width: 70%;
	padding: 12px 18px;
	background: linear-gradient(135deg, var(--accent) 0%, #6366f1 100%);
	color: white;
	border-radius: 20px 20px 4px 20px;
	font-size: 14px;
	line-height: 1.5;
	word-break: break-word;
}

.msg-text {
	font-size: 14px;
	line-height: 1.7;
	color: var(--text-primary);
	word-break: break-word;
}

.msg-error {
	margin-top: 12px;
	padding: 12px 16px;
	background-color: rgba(239, 68, 68, 0.15);
	border: 1px solid rgba(239, 68, 68, 0.3);
	border-radius: 10px;
	color: #f87171;
	font-size: 13px;
	display: flex;
	align-items: flex-start;
	gap: 10px;
}

.msg-error .error-icon {
	font-size: 16px;
	flex-shrink: 0;
}

.msg-error .error-content {
	flex: 1;
}

.msg-error .error-title {
	font-weight: 600;
	margin-bottom: 4px;
	color: #ef4444;
}

.msg-error .error-message {
	color: #f87171;
	word-break: break-word;
}

/* ========== 工具调用（流式横向布局）========== */
.tool-calls {
	margin-bottom: 12px;
}

.tool-calls-header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	background-color: var(--bg-tertiary);
	border-radius: 10px;
	cursor: pointer;
	transition: background 0.15s;
}

.tool-calls-header:hover {
	background-color: var(--bg-hover);
}

/* 流式工具列表 */
.tool-flow-list {
	flex: 1;
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	overflow: hidden;
}

.tool-flow-item {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	background-color: var(--bg-secondary);
	border-radius: 16px;
	font-size: 12px;
	transition: all 0.2s;
	border: 1px solid transparent;
}

.tool-flow-item.running {
	background-color: rgba(245, 158, 11, 0.15);
	border-color: rgba(245, 158, 11, 0.3);
	animation: toolPulse 1.5s infinite;
}

.tool-flow-item.success {
	background-color: rgba(16, 185, 129, 0.15);
	border-color: rgba(16, 185, 129, 0.3);
}

.tool-flow-item.error {
	background-color: rgba(239, 68, 68, 0.15);
	border-color: rgba(239, 68, 68, 0.3);
}

@keyframes toolPulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.7; }
}

.tool-flow-icon {
	font-size: 12px;
	display: flex;
	align-items: center;
}

.tool-flow-item.running .tool-flow-icon {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}

.tool-flow-name {
	color: var(--text-secondary);
	white-space: nowrap;
}

.tool-flow-item.running .tool-flow-name {
	color: #f59e0b;
}

.tool-flow-item.success .tool-flow-name {
	color: #10b981;
}

.tool-flow-item.error .tool-flow-name {
	color: #ef4444;
}

/* 旧版点状指示器（保留兼容） */
.tool-calls-dots {
	display: flex;
	gap: 4px;
}

.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: var(--text-muted);
	transition: all 0.3s;
}

.dot.running {
	background-color: #f59e0b;
	animation: dotPulse 1s infinite;
}

.dot.success {
	background-color: #10b981;
}

.dot.error {
	background-color: #ef4444;
}

@keyframes dotPulse {
	0%, 100% { transform: scale(1); opacity: 1; }
	50% { transform: scale(1.3); opacity: 0.7; }
}

.tool-calls-text {
	flex: 1;
	font-size: 13px;
	color: var(--text-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tool-calls-toggle {
	font-size: 12px;
	color: var(--accent);
	font-weight: 500;
	white-space: nowrap;
}

.tool-calls-list {
	margin-top: 8px;
	padding-left: 12px;
	border-left: 2px solid var(--border-color);
}

.tool-call-item {
	margin-bottom: 8px;
}

.tool-thinking {
	padding: 6px 10px;
	margin-bottom: 4px;
	font-size: 12px;
	color: var(--text-muted);
	font-style: italic;
	background-color: var(--bg-tertiary);
	border-radius: 6px;
}

/* 消息思考内容样式 */
.msg-thinking {
	margin: 12px 0;
	padding: 12px 16px;
	background-color: var(--bg-tertiary);
	border-left: 3px solid var(--accent);
	border-radius: 0 8px 8px 0;
}

.thinking-header {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 8px;
}

.thinking-icon {
	font-size: 14px;
}

.thinking-label {
	font-size: 12px;
	font-weight: 500;
	color: var(--accent);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.thinking-content {
	font-size: 14px;
	line-height: 1.6;
	color: var(--text-secondary);
	font-style: italic;
}

.tool-call-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.15s;
}

.tool-call-row:hover {
	background-color: var(--bg-tertiary);
}

.tool-icon {
	font-size: 14px;
}

.tool-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--accent);
	font-family: ui-monospace, monospace;
}

.tool-duration {
	font-size: 12px;
	color: var(--text-muted);
	margin-left: auto;
	margin-right: 8px;
	min-width: 60px;
	text-align: right;
}

.tool-expand {
	font-size: 14px;
	color: var(--text-muted);
	width: 20px;
	text-align: center;
}

.tool-detail {
	margin-top: 8px;
	margin-left: 22px;
	padding: 12px;
	background-color: var(--bg-tertiary);
	border-radius: 8px;
}

.tool-section {
	margin-bottom: 12px;
}

.tool-section:last-child {
	margin-bottom: 0;
}

.tool-section-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
	font-size: 11px;
	font-weight: 500;
	color: var(--text-muted);
	text-transform: uppercase;
}

.copy-btn {
	font-size: 11px;
	padding: 2px 6px;
	border-radius: 4px;
	background-color: var(--bg-secondary);
	color: var(--text-muted);
	cursor: pointer;
	transition: all 0.15s;
}

.copy-btn:hover {
	background-color: var(--accent);
	color: white;
}

.tool-code {
	padding: 10px;
	background-color: var(--bg-secondary);
	border-radius: 6px;
	font-size: 12px;
	font-family: ui-monospace, monospace;
	color: var(--text-primary);
	overflow-x: auto;
	max-height: 200px;
	word-break: break-all;
}

/* 特殊处理browser snapshot的显示 */
.tool-code.browser-snapshot {
	max-height: 600px;
	overflow-y: auto;
}

.tool-code.error {
	color: #f87171;
}

.screenshot-box {
	position: relative;
	border-radius: 8px;
	overflow: hidden;
	cursor: pointer;
}

.screenshot-box img {
	width: 100%;
	max-height: 200px;
	object-fit: contain;
	background-color: #000;
}

.screenshot-hover {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.5);
	color: white;
	font-size: 14px;
	opacity: 0;
	transition: opacity 0.2s;
}

.screenshot-box:hover .screenshot-hover {
	opacity: 1;
}

/* ========== 状态指示器 ========== */
.status-msg {
	opacity: 0.9;
}

.status-indicator {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	background-color: var(--bg-tertiary);
	border-radius: 12px;
	animation: statusFadeIn 0.3s ease;
}

@keyframes statusFadeIn {
	from { opacity: 0; }
	to { opacity: 1; }
}

.status-icon {
	font-size: 16px;
}

.status-label {
	font-size: 13px;
	color: var(--text-secondary);
}

.status-detail {
	font-size: 12px;
	color: var(--text-muted);
	margin-left: 4px;
}

/* 动画 */
.spin {
	display: inline-block;
	animation: spin 1s linear infinite;
}

@keyframes spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}

.pulse {
	animation: pulse 1.5s infinite;
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.5; }
}

/* ========== 欢迎页面 ========== */
.welcome-screen {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
	text-align: center;
}

.welcome-logo {
	font-size: 64px;
	margin-bottom: 16px;
	animation: welcomeBounce 2s infinite;
}

@keyframes welcomeBounce {
	0%, 100% { transform: translateY(0); }
	50% { transform: translateY(-10px); }
}

.welcome-title {
	font-size: 24px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 8px;
}

.welcome-desc {
	font-size: 14px;
	color: var(--text-muted);
}

.welcome-examples {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	justify-content: center;
	margin-top: 32px;
	max-width: 500px;
}

.example-btn {
	padding: 10px 16px;
	font-size: 13px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 20px;
	color: var(--text-secondary);
	cursor: pointer;
	transition: all 0.2s;
}

.example-btn:hover {
	background-color: var(--bg-hover);
	border-color: var(--accent);
	color: var(--accent);
	transform: translateY(-2px);
}

/* ========== 输入区域 ========== */
.input-area {
	padding: 16px 24px 24px;
	background-color: var(--bg-primary);
	max-width: 900px;
	margin: 0 auto;
	width: 100%;
}

.input-form {
	width: 100%;
}

.textarea-container {
	position: relative;
	padding: 8px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 24px;
	transition: border-color 0.2s;
}

.textarea-container:focus-within {
	border-color: var(--accent);
}

.input-textarea {
	width: 100%;
	min-height: 40px;
	max-height: 200px;
	padding: 10px 120px 10px 16px;
	background: transparent;
	border: none;
	outline: none;
	resize: none;
	font-size: 14px;
	color: var(--text-primary);
	font-family: inherit;
	line-height: 1.5;
	overflow-y: auto;
}

.input-textarea::placeholder {
	color: var(--text-muted);
}

.input-actions {
	position: absolute;
	right: 12px;
	bottom: 12px;
	display: flex;
	gap: 8px;
}

.stop-btn {
	padding: 8px 16px;
	border-radius: 20px;
	font-size: 12px;
	font-weight: 500;
	background-color: var(--bg-tertiary);
	color: var(--text-secondary);
	border: 1px solid var(--border-color);
}

.input-form .btn {
	padding: 10px 24px;
	border-radius: 20px;
	font-size: 14px;
	font-weight: 500;
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

	.textarea-container {
		padding: 6px;
	}

	.input-textarea {
		padding: 8px 100px 8px 12px;
		min-height: 36px;
	}

	.input-actions {
		right: 8px;
		bottom: 8px;
		gap: 6px;
	}

	.stop-btn {
		padding: 6px 12px;
		font-size: 11px;
	}

	.input-form .btn {
		padding: 8px 20px;
		font-size: 13px;
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

/* ========== 侧边栏样式 ========== */
.chat-layout {
	display: flex;
	flex: 1;
	height: 100vh;
	background-color: var(--bg-primary);
}

.sidebar {
	width: 260px;
	min-width: 260px;
	height: 100%;
	background-color: var(--bg-secondary);
	border-right: 1px solid var(--border-color);
	display: flex;
	flex-direction: column;
}

.sidebar-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px;
	border-bottom: 1px solid var(--border-color);
}

.sidebar-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}

.sidebar-toggle {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-secondary);
	cursor: pointer;
}

.sidebar-toggle:hover {
	background-color: var(--bg-hover);
	color: var(--accent);
}

.new-chat-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin: 12px 12px 8px;
	padding: 10px 16px;
	background-color: var(--accent);
	border: none;
	border-radius: 8px;
	color: white;
	font-size: 13px;
	cursor: pointer;
}

.new-chat-btn:hover {
	background-color: #4f46e5;
}

.session-list {
	flex: 1;
	overflow-y: auto;
	padding: 8px;
}

.session-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px;
	margin-bottom: 4px;
	background-color: transparent;
	border-radius: 8px;
	cursor: pointer;
}

.session-item:hover {
	background-color: var(--bg-hover);
}

.session-item.active {
	background-color: var(--accent-subtle);
	border: 1px solid var(--accent);
}

.session-info {
	display: flex;
	align-items: center;
	gap: 10px;
	flex: 1;
	min-width: 0;
}

.session-icon {
	font-size: 16px;
}

.session-details {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.session-title {
	font-size: 13px;
	color: var(--text-primary);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.session-time {
	font-size: 11px;
	color: var(--text-muted);
	margin-top: 2px;
}

.session-delete {
	width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: transparent;
	border: none;
	border-radius: 4px;
	color: var(--text-muted);
	font-size: 16px;
	cursor: pointer;
	opacity: 0;
	transition: opacity 0.15s;
}

.session-item:hover .session-delete {
	opacity: 1;
}

.session-delete:hover {
	background-color: rgba(239, 68, 68, 0.1);
	color: #ef4444;
}

.sidebar-empty {
	padding: 20px;
	text-align: center;
	font-size: 13px;
	color: var(--text-muted);
}

.sidebar-footer {
	padding: 12px;
	border-top: 1px solid var(--border-color);
}

.clear-all-btn {
	width: 100%;
	padding: 8px 12px;
	background-color: transparent;
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-secondary);
	font-size: 12px;
	cursor: pointer;
}

.clear-all-btn:hover:not(:disabled) {
	background-color: rgba(239, 68, 68, 0.1);
	border-color: #ef4444;
	color: #ef4444;
}

.clear-all-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.sidebar-collapsed {
	position: relative;
	width: 0;
	overflow: hidden;
	transition: width 0.2s ease;
}

.sidebar-expand-btn {
	position: absolute;
	top: 16px;
	left: 0;
	z-index: 40;
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-secondary);
	font-size: 14px;
	cursor: pointer;
}

.sidebar-expand-btn:hover {
	background-color: var(--bg-hover);
	color: var(--accent);
}

/* 确认模态框 */
.confirm-modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 50;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.8);
}

.confirm-modal {
	border-radius: 12px;
	box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	width: 100%;
	max-width: 320px;
	margin: 16px;
	display: flex;
	flex-direction: column;
	background-color: var(--bg-secondary);
}

.confirm-modal-title {
	padding: 16px;
	font-size: 18px;
	font-weight: bold;
	border-bottom: 1px solid var(--border-color);
	color: var(--text-primary);
}

.confirm-modal-body {
	padding: 16px;
	font-size: 14px;
	color: var(--text-secondary);
}

.confirm-modal-footer {
	padding: 16px;
	border-top: 1px solid var(--border-color);
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}

.btn-danger {
	background-color: #ef4444;
	color: white;
	border: none;
	padding: 8px 16px;
	border-radius: 6px;
	font-size: 13px;
	cursor: pointer;
}

.btn-danger:hover {
	background-color: #dc2626;
}
</style>
