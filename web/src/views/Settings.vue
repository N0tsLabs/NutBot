<template>
	<div class="settings-page">
		<!-- 左侧分类导航 -->
		<aside class="settings-sidebar">
			<nav class="settings-nav">
				<button
					v-for="category in categories"
					:key="category.id"
					class="nav-btn"
					:class="{ active: activeCategory === category.id }"
					@click="scrollToCategory(category.id)"
				>
					<span class="nav-icon">{{ category.icon }}</span>
					<span class="nav-label">{{ category.label }}</span>
				</button>
			</nav>
		</aside>

		<!-- 右侧内容区 -->
		<main class="settings-content" ref="contentRef">
			<!-- 个人设置 -->
			<section id="user" class="settings-section">
				<h2 class="section-title">
					<span>👤</span>
					个人设置
				</h2>
				
				<div class="settings-grid cols-2">
					<div class="setting-item">
						<label class="setting-label">AI 名称</label>
						<input v-model="userSettings.aiName" placeholder="NutBot" class="input-sm" @blur="saveUserSettings" />
						<p class="setting-hint">对话中显示的 AI 名称</p>
					</div>
					<div class="setting-item">
						<label class="setting-label">你的昵称</label>
						<input v-model="userSettings.name" placeholder="AI 称呼你的名字" class="input-sm" @blur="saveUserSettings" />
					</div>
					<div class="setting-item">
						<label class="setting-label">位置</label>
						<input v-model="userSettings.location" placeholder="城市" class="input-sm" @blur="saveUserSettings" />
					</div>
					<div class="setting-item">
						<label class="setting-label">语言</label>
						<select v-model="userSettings.language" class="input-sm" @change="saveUserSettings">
							<option value="">自动</option>
							<option value="中文">中文</option>
							<option value="English">English</option>
							<option value="日本語">日本語</option>
						</select>
					</div>
				</div>
				
				<div class="setting-item full-width">
					<label class="setting-label">自定义 Prompt</label>
					<textarea v-model="userSettings.customPrompt" placeholder="添加自定义指令..." class="input-sm h-20 resize-none" @blur="saveUserSettings"></textarea>
					<p class="setting-hint">这些指令会添加到 AI 的系统提示中</p>
				</div>
			</section>

			<!-- Agent 设置 -->
			<section id="agent" class="settings-section">
				<h2 class="section-title">
					<span>🤖</span>
					Agent 设置
				</h2>
				<p class="section-desc">配置 AI Agent 的行为模式</p>
				
				<div class="settings-grid cols-2">
					<div class="setting-item">
						<label class="setting-label">工具调用模式</label>
						<select v-model="agentSettings.toolCallMode" class="input-sm" @change="saveAgentSettings">
							<option value="prompt">Prompt JSON（推荐）</option>
							<option value="function">Function Calling</option>
						</select>
						<p class="setting-hint">
							<template v-if="agentSettings.toolCallMode === 'prompt'">
								通过 Prompt 让 AI 返回 JSON 格式，兼容所有模型，可显示思考过程
							</template>
							<template v-else>
								使用 API 原生的函数调用，仅支持 OpenAI/Claude 等模型
							</template>
						</p>
					</div>
					
					<div class="setting-item">
						<label class="setting-label">最大迭代次数</label>
						<input v-model.number="agentSettings.maxIterations" type="number" min="1" max="100" class="input-sm w-24" @blur="saveAgentSettings" />
						<p class="setting-hint">Agent 执行工具的最大循环次数</p>
					</div>
					
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">调试模式</span>
							<label class="switch">
								<input type="checkbox" v-model="agentSettings.debugMode" @change="saveAgentSettings" />
								<span class="slider"></span>
							</label>
						</div>
						<p class="setting-hint">操作桌面前显示预览图并等待确认</p>
					</div>
				</div>
			</section>

			<!-- OCR-SoM -->
			<section id="ocr" class="settings-section">
				<h2 class="section-title">
					<span>👁️</span>
					OCR-SoM 视觉识别
				</h2>
				<p class="section-desc">识别屏幕上的文字和 UI 元素，为 AI 提供精确点击坐标</p>
				
				<div class="settings-grid cols-2">
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">启用 OCR-SoM</span>
							<label class="switch">
								<input type="checkbox" v-model="ocrConfig.enabled" @change="saveOcrConfig" />
								<span class="slider"></span>
							</label>
						</div>
					</div>
					
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">超时 (ms)</span>
							<input v-model.number="ocrConfig.timeout" type="number" min="5000" max="120000" step="1000" class="input-xs w-24" @blur="saveOcrConfig" />
						</div>
					</div>
				</div>
				
				<div class="setting-item full-width">
					<div class="setting-header">
						<span class="setting-label">服务地址</span>
						<div class="flex gap-2 items-center">
							<input v-model="ocrConfig.baseUrl" placeholder="http://localhost:5000" class="input-sm w-64" @blur="saveOcrConfig" />
							<button @click="testOcrConnection" :disabled="loadingStates['ocr-test']" class="btn-sm">
								{{ loadingStates['ocr-test'] ? '检测中' : '测试' }}
							</button>
						</div>
					</div>
					<div v-if="ocrStatus" class="ocr-status" :class="ocrStatus.connected ? 'connected' : 'disconnected'">
						<span>{{ ocrStatus.connected ? '🟢' : '🔴' }} {{ ocrStatus.message }}</span>
						<span v-if="ocrStatus.info" class="ocr-info">设备: {{ ocrStatus.info.device }}</span>
					</div>
				</div>
			</section>

			<!-- 记忆管理 -->
			<section id="memory" class="settings-section">
				<h2 class="section-title">
					<span>🧠</span>
					AI 记忆
					<button @click="showAddMemory = true" class="btn-sm ml-auto">+ 添加</button>
				</h2>
				<p class="section-desc">AI 会记住这些信息。也可以在聊天中说"记住这个"来添加。</p>
				
				<div v-if="memories.length" class="memory-list">
					<div v-for="memory in memories" :key="memory.id" class="memory-item">
						<span class="memory-category" :class="memory.category">{{ categoryLabels[memory.category] }}</span>
						<template v-if="editingMemory === memory.id">
							<input v-model="editMemoryContent" class="memory-edit-input" @keyup.enter="saveMemoryEdit(memory.id)" />
							<button @click="saveMemoryEdit(memory.id)" class="btn-xs">保存</button>
							<button @click="editingMemory = null" class="btn-xs">取消</button>
						</template>
						<template v-else>
							<span class="memory-content">{{ memory.content }}</span>
							<div class="memory-actions">
								<button @click="startEditMemory(memory)" class="btn-icon">✏️</button>
								<button @click="deleteMemory(memory.id)" class="btn-icon text-red-400">🗑️</button>
							</div>
						</template>
					</div>
				</div>
				<div v-else class="empty-state">还没有记忆</div>

				<!-- 添加记忆弹窗 -->
				<div v-if="showAddMemory" class="modal-overlay" @click.self="showAddMemory = false">
					<div class="modal-content modal-sm">
						<div class="modal-header">
							<h3>添加记忆</h3>
							<button class="btn-close" @click="showAddMemory = false">×</button>
						</div>
						<div class="modal-body">
							<div class="form-group">
								<label>分类</label>
								<select v-model="newMemory.category" class="input-sm">
									<option value="preference">偏好</option>
									<option value="habit">习惯</option>
									<option value="fact">事实</option>
									<option value="instruction">指令</option>
									<option value="other">其他</option>
								</select>
							</div>
							<div class="form-group">
								<label>内容</label>
								<textarea v-model="newMemory.content" placeholder="记录一些 AI 需要记住的信息..." class="input-sm h-24"></textarea>
							</div>
						</div>
						<div class="modal-footer">
							<button class="btn-sm" @click="showAddMemory = false">取消</button>
							<button class="btn-sm btn-primary" @click="addMemory">添加</button>
						</div>
					</div>
				</div>
			</section>

			<!-- 服务器 -->
			<section id="server" class="settings-section">
				<h2 class="section-title">
					<span>🖥️</span>
					服务器
				</h2>
				<div class="settings-grid cols-2">
					<div class="setting-item">
						<label class="setting-label">地址</label>
						<input v-model="config.server.host" class="input-sm" disabled />
					</div>
					<div class="setting-item">
						<label class="setting-label">端口</label>
						<input v-model="config.server.port" class="input-sm" disabled />
					</div>
				</div>
			</section>

			<!-- 沙盒详情 -->
			<section id="sandbox" class="settings-section">
				<h2 class="section-title">
					<span>🔒</span>
					安全沙盒
				</h2>
				<p class="section-desc">系统会在执行层自动拦截危险操作，用户输入不会被过滤</p>
				
				<div class="sandbox-modes">
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'trust' }" @click="sandboxMode = 'trust'; saveSandboxMode()">
						<span class="mode-badge success">信任</span>
						<div class="mode-info">
							<strong>🚀 信任模式</strong> - 大部分操作直接执行
							<span class="mode-tip">只有安全底线（读取密钥、支付等）需要确认</span>
						</div>
					</div>
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'standard' }" @click="sandboxMode = 'standard'; saveSandboxMode()">
						<span class="mode-badge warning">标准</span>
						<div class="mode-info">
							<strong>⚖️ 标准模式</strong> - 敏感操作需确认
							<span class="mode-tip">💡 推荐日常使用，发送消息/删除文件等需确认</span>
						</div>
					</div>
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'strict' }" @click="sandboxMode = 'strict'; saveSandboxMode()">
						<span class="mode-badge error">严格</span>
						<div class="mode-info">
							<strong>🔒 严格模式</strong> - 所有外部操作需确认
							<span class="mode-tip">适合新用户熟悉系统行为</span>
						</div>
					</div>
				</div>
			</section>
		</main>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';

const store = useAppStore();
const contentRef = ref(null);
const activeCategory = ref('user');

// 分类导航
const categories = [
	{ id: 'user', icon: '👤', label: '个人设置' },
	{ id: 'agent', icon: '🤖', label: 'Agent' },
	{ id: 'ocr', icon: '👁️', label: 'OCR-SoM' },
	{ id: 'memory', icon: '🧠', label: 'AI 记忆' },
	{ id: 'server', icon: '🖥️', label: '服务器' },
	{ id: 'sandbox', icon: '🔒', label: '安全沙盒' },
];

const scrollToCategory = (id) => {
	activeCategory.value = id;
	const el = document.getElementById(id);
	if (el && contentRef.value) {
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
};

// 用户设置
const userSettings = reactive({
	aiName: 'NutBot',
	name: '',
	location: '',
	language: '',
	customPrompt: '',
});

// Agent 设置
const agentSettings = reactive({
	toolCallMode: 'prompt',
	maxIterations: 30,
	debugMode: false,
});

// OCR 配置
const ocrConfig = reactive({
	enabled: true,
	baseUrl: 'http://localhost:5000',
	timeout: 30000,
});
const ocrStatus = ref(null);
const loadingStates = reactive({});

// 记忆
const memories = ref([]);
const showAddMemory = ref(false);
const editingMemory = ref(null);
const editMemoryContent = ref('');
const newMemory = reactive({
	content: '',
	category: 'preference',
});

const categoryLabels = {
	preference: '偏好',
	habit: '习惯',
	fact: '事实',
	instruction: '指令',
	other: '其他',
};

// 服务器配置
const config = reactive({
	server: { host: '127.0.0.1', port: 18800 },
});

// 沙盒模式
const sandboxMode = ref('standard');

// ========== 用户设置 ==========

const loadUserSettings = async () => {
	try {
		const data = await api.get('/api/user');
		userSettings.aiName = data.aiName || 'NutBot';
		userSettings.name = data.name || '';
		userSettings.location = data.location || '';
		userSettings.language = data.language || '';
		userSettings.customPrompt = data.customPrompt || '';
	} catch (error) {
		console.error('Load user settings failed:', error);
	}
};

const saveUserSettings = async () => {
	try {
		await api.put('/api/user', {
			aiName: userSettings.aiName || 'NutBot',
			name: userSettings.name || null,
			location: userSettings.location || null,
			language: userSettings.language || null,
			customPrompt: userSettings.customPrompt || null,
		});
		// 刷新 config 以便其他页面获取最新的 AI 名称
		await store.loadConfig();
	} catch (error) {
		console.error('Save user settings failed:', error);
	}
};

// ========== Agent 设置 ==========

const loadAgentSettings = () => {
	agentSettings.toolCallMode = store.config?.agent?.toolCallMode || 'prompt';
	agentSettings.maxIterations = store.config?.agent?.maxIterations || 30;
	agentSettings.debugMode = store.config?.agent?.debugMode || false;
};

const saveAgentSettings = async () => {
	try {
		await api.put('/api/config', {
			agent: {
				...store.config?.agent,
				toolCallMode: agentSettings.toolCallMode,
				maxIterations: agentSettings.maxIterations,
				debugMode: agentSettings.debugMode,
			},
		});
		await store.loadConfig();
	} catch (error) {
		console.error('Save agent settings failed:', error);
	}
};

// ========== OCR-SoM 设置 ==========

const loadOcrConfig = async () => {
	try {
		const data = await api.get('/api/ocr/config');
		ocrConfig.enabled = data.enabled ?? true;
		ocrConfig.baseUrl = data.baseUrl || 'http://localhost:5000';
		ocrConfig.timeout = data.timeout || 30000;
	} catch (error) {
		console.error('Load OCR config failed:', error);
	}
};

const saveOcrConfig = async () => {
	try {
		await api.put('/api/ocr/config', {
			enabled: ocrConfig.enabled,
			baseUrl: ocrConfig.baseUrl,
			timeout: ocrConfig.timeout,
		});
	} catch (error) {
		console.error('Save OCR config failed:', error);
	}
};

const testOcrConnection = async () => {
	if (loadingStates['ocr-test']) return;
	loadingStates['ocr-test'] = true;
	ocrStatus.value = null;

	try {
		const result = await api.get('/api/ocr/status');
		ocrStatus.value = result;
	} catch (error) {
		ocrStatus.value = {
			connected: false,
			message: error.message || '连接失败',
		};
	} finally {
		loadingStates['ocr-test'] = false;
	}
};

// ========== 记忆管理 ==========

const loadMemories = async () => {
	try {
		memories.value = await api.get('/api/memories');
	} catch (error) {
		console.error('Load memories failed:', error);
	}
};

const addMemory = async () => {
	if (!newMemory.content.trim()) return;
	try {
		await api.post('/api/memories', {
			content: newMemory.content.trim(),
			category: newMemory.category,
		});
		newMemory.content = '';
		newMemory.category = 'preference';
		showAddMemory.value = false;
		await loadMemories();
		toast.success('添加成功');
	} catch (error) {
		toast.error('添加失败: ' + error.message);
	}
};

const startEditMemory = (memory) => {
	editingMemory.value = memory.id;
	editMemoryContent.value = memory.content;
};

const saveMemoryEdit = async (id) => {
	if (!editMemoryContent.value.trim()) return;
	try {
		await api.put(`/api/memories/${id}`, {
			content: editMemoryContent.value.trim(),
		});
		editingMemory.value = null;
		await loadMemories();
		toast.success('保存成功');
	} catch (error) {
		toast.error('保存失败: ' + error.message);
	}
};

const deleteMemory = async (id) => {
	if (!confirm('确定删除？')) return;
	try {
		await api.del(`/api/memories/${id}`);
		await loadMemories();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

// ========== 沙盒设置 ==========

const saveSandboxMode = async () => {
	try {
		await api.put('/api/config', { 'sandbox.mode': sandboxMode.value });
		await store.loadConfig();
	} catch (error) {
		console.error('Save sandbox mode failed:', error);
	}
};

// ========== 初始化 ==========

onMounted(async () => {
	await store.loadConfig();
	await loadUserSettings();
	loadAgentSettings();
	await loadMemories();
	await loadOcrConfig();

	sandboxMode.value = store.config?.sandbox?.mode || 'standard';
	Object.assign(config.server, store.config?.server || {});

	if (ocrConfig.enabled) {
		testOcrConnection();
	}
});
</script>

<style scoped>
.settings-page {
	display: flex;
	height: 100vh;
	background-color: var(--bg-primary);
}

/* 左侧导航 */
.settings-sidebar {
	width: 160px;
	flex-shrink: 0;
	background-color: var(--bg-secondary);
	border-right: 1px solid var(--border-color);
	padding: 16px 8px;
}

.settings-nav {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.nav-btn {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-radius: 6px;
	background: none;
	border: none;
	font-size: 13px;
	color: var(--text-secondary);
	cursor: pointer;
	transition: all 0.15s;
	text-align: left;
}

.nav-btn:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.nav-btn.active {
	background-color: var(--accent-subtle);
	color: var(--accent);
}

.nav-icon {
	font-size: 14px;
}

/* 右侧内容 */
.settings-content {
	flex: 1;
	overflow-y: auto;
	padding: 24px 32px;
}

.settings-section {
	margin-bottom: 32px;
	padding-bottom: 32px;
	border-bottom: 1px solid var(--border-color);
}

.settings-section:last-child {
	border-bottom: none;
}

.section-title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 16px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 8px;
}

.section-title span:first-child {
	font-size: 18px;
}

.section-desc {
	font-size: 13px;
	color: var(--text-muted);
	margin-bottom: 16px;
}

.settings-grid {
	display: grid;
	gap: 16px;
}

.settings-grid.cols-2 {
	grid-template-columns: repeat(2, 1fr);
}

.settings-grid.cols-3 {
	grid-template-columns: repeat(3, 1fr);
}

.setting-item {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.setting-item.full-width {
	grid-column: 1 / -1;
}

.setting-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.setting-label {
	font-size: 13px;
	color: var(--text-secondary);
}

.setting-hint {
	font-size: 11px;
	color: var(--text-muted);
	margin-top: 4px;
}

/* OCR 状态 */
.ocr-status {
	margin-top: 8px;
	padding: 8px 12px;
	border-radius: 6px;
	font-size: 12px;
	display: flex;
	align-items: center;
	gap: 12px;
}

.ocr-status.connected {
	background-color: rgba(16, 185, 129, 0.1);
	color: #10b981;
}

.ocr-status.disconnected {
	background-color: rgba(239, 68, 68, 0.1);
	color: #ef4444;
}

.ocr-info {
	color: var(--text-muted);
}

/* 记忆列表 */
.memory-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.memory-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 12px;
	background-color: var(--bg-secondary);
	border-radius: 8px;
}

.memory-category {
	font-size: 11px;
	padding: 2px 8px;
	border-radius: 4px;
	flex-shrink: 0;
}

.memory-category.preference { background-color: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.memory-category.habit { background-color: rgba(16, 185, 129, 0.2); color: #10b981; }
.memory-category.fact { background-color: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.memory-category.instruction { background-color: rgba(139, 92, 246, 0.2); color: #8b5cf6; }
.memory-category.other { background-color: rgba(156, 163, 175, 0.2); color: #9ca3af; }

.memory-content {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
}

.memory-edit-input {
	flex: 1;
	padding: 4px 8px;
	font-size: 13px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--accent);
	border-radius: 4px;
	color: var(--text-primary);
	outline: none;
}

.memory-actions {
	display: flex;
	gap: 4px;
}

/* 沙盒模式 */
.sandbox-modes {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.sandbox-mode {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	background-color: var(--bg-secondary);
	border: 2px solid transparent;
	border-radius: 10px;
	cursor: pointer;
	transition: all 0.15s;
}

.sandbox-mode:hover {
	border-color: var(--border-color);
}

.sandbox-mode.active {
	border-color: var(--accent);
	background-color: var(--accent-subtle);
}

.mode-badge {
	font-size: 11px;
	padding: 4px 10px;
	border-radius: 4px;
	font-weight: 500;
}

.mode-badge.success { background-color: rgba(16, 185, 129, 0.2); color: #10b981; }
.mode-badge.warning { background-color: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.mode-badge.error { background-color: rgba(239, 68, 68, 0.2); color: #ef4444; }

.mode-info {
	flex: 1;
}

.mode-info strong {
	display: block;
	font-size: 13px;
	color: var(--text-primary);
	margin-bottom: 2px;
}

.mode-tip {
	display: block;
	font-size: 12px;
	color: var(--text-muted);
}

/* 空状态 */
.empty-state {
	padding: 24px;
	text-align: center;
	font-size: 13px;
	color: var(--text-muted);
	background-color: var(--bg-secondary);
	border-radius: 8px;
}

/* 弹窗 */
.modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.6);
}

.modal-content {
	background-color: var(--bg-secondary);
	border-radius: 12px;
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.modal-sm {
	width: 90%;
	max-width: 400px;
}

.modal-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
	font-size: 16px;
	font-weight: 600;
	color: var(--text-primary);
	margin: 0;
}

.btn-close {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: none;
	border: none;
	border-radius: 6px;
	font-size: 18px;
	color: var(--text-muted);
	cursor: pointer;
}

.btn-close:hover {
	background-color: var(--bg-hover);
}

.modal-body {
	padding: 20px;
}

.modal-footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 12px 20px;
	border-top: 1px solid var(--border-color);
}

/* 表单 */
.form-group {
	margin-bottom: 16px;
}

.form-group:last-child {
	margin-bottom: 0;
}

.form-group label {
	display: block;
	font-size: 13px;
	color: var(--text-secondary);
	margin-bottom: 6px;
}

/* 通用样式 */
.input-sm {
	width: 100%;
	padding: 8px 10px;
	font-size: 13px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	outline: none;
}

.input-sm:focus {
	border-color: var(--accent);
}

.input-xs {
	padding: 4px 8px;
	font-size: 12px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-primary);
	outline: none;
}

.btn-sm {
	padding: 6px 12px;
	font-size: 12px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-sm:hover:not(:disabled) {
	background-color: var(--bg-hover);
}

.btn-sm:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.btn-sm.btn-primary {
	background-color: var(--accent);
	border-color: var(--accent);
	color: white;
}

.btn-sm.btn-primary:hover:not(:disabled) {
	background-color: var(--accent-hover);
}

.btn-xs {
	padding: 4px 8px;
	font-size: 11px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-secondary);
	cursor: pointer;
}

.btn-xs:hover {
	background-color: var(--bg-hover);
}

.btn-icon {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: none;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	transition: background 0.15s;
}

.btn-icon:hover {
	background-color: var(--bg-hover);
}

/* Switch */
.switch {
	position: relative;
	width: 44px;
	height: 24px;
}

.switch input {
	opacity: 0;
	width: 0;
	height: 0;
}

.slider {
	position: absolute;
	cursor: pointer;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background-color: var(--bg-tertiary);
	border-radius: 12px;
	transition: 0.15s;
}

.slider:before {
	position: absolute;
	content: '';
	height: 18px;
	width: 18px;
	left: 3px;
	bottom: 3px;
	background-color: white;
	border-radius: 50%;
	transition: 0.15s;
}

input:checked + .slider {
	background-color: var(--accent);
}

input:checked + .slider:before {
	transform: translateX(20px);
}

/* Utility */
.ml-auto { margin-left: auto; }
.flex { display: flex; }
.gap-2 { gap: 8px; }
.items-center { align-items: center; }
.w-24 { width: 6rem; }
.w-64 { width: 16rem; }
.h-20 { height: 5rem; }
.h-24 { height: 6rem; }
.resize-none { resize: none; }
.text-red-400 { color: #f87171; }

@media (max-width: 768px) {
	.settings-sidebar {
		display: none;
	}

	.settings-grid.cols-2,
	.settings-grid.cols-3 {
		grid-template-columns: 1fr;
	}
}
</style>
