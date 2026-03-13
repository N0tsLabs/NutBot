<template>
	<div class="settings-page">
		<!-- 页面标题区域 -->
		<header class="settings-header">
			<h1 class="page-title">设置</h1>
			<div class="header-actions">
				<span class="auto-save-hint">
					<span class="save-icon">💾</span>
					自动保存已启用
				</span>
			</div>
		</header>

		<div class="settings-body">
			<!-- 左侧分类导航 -->
			<aside class="settings-sidebar">
				<nav class="settings-nav">
					<button
						v-for="category in categories"
						:key="category.id"
						class="nav-btn"
						:class="{ active: activeCategory === category.id, important: category.important }"
						@click="scrollToCategory(category.id)"
					>
						<span class="nav-icon">{{ category.icon }}</span>
						<span class="nav-label">{{ category.label }}</span>
						<span v-if="category.important" class="important-badge">重要</span>
					</button>
				</nav>
			</aside>

			<!-- 右侧内容区 -->
			<main class="settings-content" ref="contentRef">
				<!-- 浏览器设置 -->
				<section id="browser" class="settings-section important-section">
					<h2 class="section-title">
						<span>🌐</span>
						浏览器
						<span class="section-badge important">核心功能</span>
					</h2>
					<p class="section-desc">配置浏览器实例，用于自动化操作网页</p>

					<!-- 浏览器状态卡片 -->
					<div class="browser-status-card">
						<div class="status-info">
							<div class="status-indicator" :class="browserStatus"></div>
							<div class="status-text">
								<span class="status-label">{{ browserStatusText }}</span>
								<span v-if="browserStatus === 'running'" class="status-detail">
									浏览器正在运行中
								</span>
								<span v-else-if="browserStatus === 'error'" class="status-detail error">
									{{ browserError || '浏览器启动失败' }}
								</span>
								<span v-else class="status-detail">
									点击"打开浏览器"启动实例
								</span>
							</div>
						</div>
						<div class="status-actions">
							<button
								@click="openBrowser"
								:disabled="browserStatus === 'running' || browserStatus === 'starting'"
								class="btn-sm btn-success"
							>
								{{ browserStatus === 'starting' ? '启动中...' : '打开浏览器' }}
							</button>
							<button
								@click="closeBrowser"
								:disabled="browserStatus !== 'running'"
								class="btn-sm btn-danger"
							>
								关闭浏览器
							</button>
						</div>
					</div>

					<div class="settings-grid cols-2">
						<!-- 浏览器路径配置 -->
						<div class="setting-item full-width">
							<label class="setting-label">
								浏览器路径
								<span class="help-tip" title="指定浏览器可执行文件路径，如 Chrome 或 Edge">?</span>
							</label>
							<div class="input-with-button">
								<input
									v-model="browserSettings.path"
									placeholder="留空则自动检测系统已安装的浏览器"
									class="input-sm"
									@blur="saveBrowserConfig"
								/>
								<button
									@click="detectBrowser"
									:disabled="loadingStates['browser-detect']"
									class="btn-sm"
								>
									{{ loadingStates['browser-detect'] ? '检测中...' : '自动检测' }}
								</button>
							</div>
							<p class="setting-hint">支持 Chrome、Edge、Chromium 等基于 Chromium 的浏览器</p>
						</div>

						<!-- 身份标识 -->
						<div class="setting-item">
							<label class="setting-label">
								NutBot 身份标识
								<span class="help-tip" title="用于区分不同的浏览器实例">?</span>
							</label>
							<input
								v-model="browserSettings.identity"
								placeholder="NutBot"
								class="input-sm"
								@blur="saveBrowserConfig"
							/>
							<p class="setting-hint">用于区分不同的浏览器实例</p>
						</div>

						<!-- 无头模式 -->
						<div class="setting-item">
							<div class="setting-header">
								<span class="setting-label">
									无头模式
									<span class="help-tip" title="无头模式下浏览器不会显示窗口">?</span>
								</span>
								<label class="switch">
									<input type="checkbox" v-model="browserSettings.headless" @change="saveBrowserConfig" />
									<span class="slider"></span>
								</label>
							</div>
							<p class="setting-hint">启用后浏览器将在后台运行，不显示窗口</p>
						</div>

						<!-- 禁用图片加载 -->
						<div class="setting-item">
							<div class="setting-header">
								<span class="setting-label">
									禁用图片加载
									<span class="help-tip" title="禁用图片可加快页面加载速度">?</span>
								</span>
								<label class="switch">
									<input type="checkbox" v-model="browserSettings.disableImages" @change="saveBrowserConfig" />
									<span class="slider"></span>
								</label>
							</div>
							<p class="setting-hint">禁用图片加载可提高页面加载速度</p>
						</div>
					</div>
				</section>

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
	</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';

const store = useAppStore();
const contentRef = ref(null);
const activeCategory = ref('browser');

// 分类导航
const categories = [
	{ id: 'browser', icon: '🌐', label: '浏览器', important: true },
	{ id: 'user', icon: '👤', label: '个人设置' },
	{ id: 'agent', icon: '🤖', label: 'Agent' },
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

// ========== 浏览器设置 ==========
const browserSettings = reactive({
	path: '',
	identity: 'NutBot',
	headless: false,
	disableImages: false,
});

const browserStatus = ref('stopped'); // 'running' | 'stopped' | 'error' | 'starting'
const browserError = ref('');

const browserStatusText = computed(() => {
	switch (browserStatus.value) {
		case 'running': return '运行中';
		case 'starting': return '启动中';
		case 'error': return '错误';
		default: return '已停止';
	}
});

const loadBrowserConfig = async () => {
	try {
		const data = await api.get('/api/browser/config');
		browserSettings.path = data.browserPath || '';
		browserSettings.identity = data.identity || 'NutBot';
		browserSettings.headless = data.headless ?? false;
		browserSettings.disableImages = data.disableImages ?? false;
	} catch (error) {
		console.error('Load browser config failed:', error);
	}
};

const saveBrowserConfig = async () => {
	try {
		await api.put('/api/browser/config', {
			browserPath: browserSettings.path || null,
			identity: browserSettings.identity || 'NutBot',
			headless: browserSettings.headless,
			disableImages: browserSettings.disableImages,
		});
		toast.success('浏览器配置已保存');
	} catch (error) {
		console.error('Save browser config failed:', error);
		toast.error('保存失败: ' + error.message);
	}
};

const loadBrowserStatus = async () => {
	try {
		const data = await api.get('/api/browser/status');
		browserStatus.value = data.status || 'stopped';
		browserError.value = data.error || '';
	} catch (error) {
		console.error('Load browser status failed:', error);
		browserStatus.value = 'error';
		browserError.value = error.message || '无法获取状态';
	}
};

const openBrowser = async () => {
	if (browserStatus.value === 'running' || browserStatus.value === 'starting') return;
	
	browserStatus.value = 'starting';
	browserError.value = '';
	
	try {
		const result = await api.post('/api/browser/open');
		if (result.success) {
			browserStatus.value = 'running';
			toast.success('浏览器已启动');
		} else {
			browserStatus.value = 'error';
			browserError.value = result.message || '启动失败';
			toast.error('浏览器启动失败: ' + result.message);
		}
	} catch (error) {
		browserStatus.value = 'error';
		browserError.value = error.message || '启动失败';
		toast.error('浏览器启动失败: ' + error.message);
	}
};

const closeBrowser = async () => {
	if (browserStatus.value !== 'running') return;
	
	try {
		const result = await api.post('/api/browser/close');
		if (result.success) {
			browserStatus.value = 'stopped';
			toast.success('浏览器已关闭');
		} else {
			toast.error('关闭失败: ' + result.error);
		}
	} catch (error) {
		toast.error('关闭浏览器失败: ' + error.message);
	}
};

const detectBrowser = async () => {
	if (loadingStates['browser-detect']) return;
	loadingStates['browser-detect'] = true;
	
	try {
		const result = await api.get('/api/browser/detect');
		if (result.path) {
			browserSettings.path = result.path;
			toast.success('检测到浏览器: ' + result.path);
			await saveBrowserConfig();
		} else {
			toast.warning('未检测到可用的浏览器');
		}
	} catch (error) {
		toast.error('检测失败: ' + error.message);
	} finally {
		loadingStates['browser-detect'] = false;
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
	await loadBrowserConfig();
	await loadBrowserStatus();

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
	flex-direction: column;
	height: 100vh;
	background-color: var(--bg-primary);
}

/* 页面标题区域 */
.settings-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 24px;
	background-color: var(--bg-secondary);
	border-bottom: 1px solid var(--border-color);
	flex-shrink: 0;
}

.page-title {
	font-size: 20px;
	font-weight: 600;
	color: var(--text-primary);
	margin: 0;
}

.header-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}

.auto-save-hint {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--text-muted);
	padding: 4px 10px;
	background-color: var(--bg-tertiary);
	border-radius: 4px;
}

.save-icon {
	font-size: 14px;
}

.settings-body {
	display: flex;
	flex: 1;
	overflow: hidden;
}

/* 左侧导航 */
.settings-sidebar {
	width: 180px;
	flex-shrink: 0;
	background-color: var(--bg-secondary);
	border-right: 1px solid var(--border-color);
	padding: 16px 8px;
	overflow-y: auto;
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
	padding: 10px 12px;
	border-radius: 6px;
	background: none;
	border: none;
	font-size: 13px;
	color: var(--text-secondary);
	cursor: pointer;
	transition: all 0.15s;
	text-align: left;
	position: relative;
}

.nav-btn:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.nav-btn.active {
	background-color: var(--accent-subtle);
	color: var(--accent);
}

.nav-btn.important {
	background-color: rgba(59, 130, 246, 0.08);
}

.nav-btn.important.active {
	background-color: rgba(59, 130, 246, 0.15);
}

.nav-icon {
	font-size: 14px;
}

.nav-label {
	flex: 1;
}

.important-badge {
	font-size: 10px;
	padding: 2px 6px;
	background-color: var(--accent);
	color: white;
	border-radius: 4px;
	font-weight: 500;
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

/* 重要设置区域高亮 */
.settings-section.important-section {
	background-color: rgba(59, 130, 246, 0.03);
	border: 1px solid rgba(59, 130, 246, 0.15);
	border-radius: 12px;
	padding: 20px;
	margin-bottom: 32px;
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

.section-badge {
	font-size: 10px;
	padding: 2px 8px;
	border-radius: 4px;
	font-weight: 500;
	margin-left: auto;
}

.section-badge.important {
	background-color: rgba(59, 130, 246, 0.15);
	color: #3b82f6;
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
	display: flex;
	align-items: center;
	gap: 4px;
}

.setting-hint {
	font-size: 11px;
	color: var(--text-muted);
	margin-top: 2px;
}

/* 帮助提示 */
.help-tip {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 14px;
	height: 14px;
	font-size: 10px;
	font-weight: 600;
	color: var(--text-muted);
	background-color: var(--bg-tertiary);
	border-radius: 50%;
	cursor: help;
}

/* 输入框带按钮 */
.input-with-button {
	display: flex;
	gap: 8px;
}

.input-with-button input {
	flex: 1;
}

/* 浏览器状态卡片 */
.browser-status-card {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	background-color: var(--bg-secondary);
	border-radius: 10px;
	margin-bottom: 20px;
	border: 1px solid var(--border-color);
}

.status-info {
	display: flex;
	align-items: center;
	gap: 12px;
}

.status-indicator {
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background-color: #9ca3af;
}

.status-indicator.running {
	background-color: #10b981;
	box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
	animation: pulse 2s infinite;
}

.status-indicator.starting {
	background-color: #f59e0b;
	animation: pulse 1s infinite;
}

.status-indicator.error {
	background-color: #ef4444;
}

.status-indicator.stopped {
	background-color: #9ca3af;
}

@keyframes pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.5; }
}

.status-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.status-label {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
}

.status-detail {
	font-size: 12px;
	color: var(--text-muted);
}

.status-detail.error {
	color: #ef4444;
}

.status-actions {
	display: flex;
	gap: 8px;
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
	transition: border-color 0.15s;
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
	padding: 8px 14px;
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
	border-color: var(--accent);
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

.btn-sm.btn-success {
	background-color: #10b981;
	border-color: #10b981;
	color: white;
}

.btn-sm.btn-success:hover:not(:disabled) {
	background-color: #059669;
}

.btn-sm.btn-danger {
	background-color: #ef4444;
	border-color: #ef4444;
	color: white;
}

.btn-sm.btn-danger:hover:not(:disabled) {
	background-color: #dc2626;
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

	.browser-status-card {
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.status-actions {
		width: 100%;
	}

	.status-actions button {
		flex: 1;
	}
}

/* 导入按钮组 */
.import-buttons {
	display: flex;
	gap: 8px;
	margin-bottom: 8px;
}

.btn-import {
	background-color: rgba(59, 130, 246, 0.1);
	border-color: rgba(59, 130, 246, 0.3);
	color: #3b82f6;
}

.btn-import:hover:not(:disabled) {
	background-color: rgba(59, 130, 246, 0.2);
	border-color: #3b82f6;
}

.setting-hint strong {
	color: var(--text-secondary);
}
</style>
