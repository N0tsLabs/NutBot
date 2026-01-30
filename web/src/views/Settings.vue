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
			<!-- 快速设置 -->
			<section id="quick" class="settings-section">
				<h2 class="section-title">
					<span>⚡</span>
					快速设置
				</h2>
				<div class="settings-grid">
					<!-- 默认模型 -->
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">默认模型</span>
							<span class="setting-value">{{ defaultModel || '未设置' }}</span>
						</div>
						<p class="setting-desc">在 AI Provider 中选择模型并点击"设为默认"</p>
					</div>
					
					<!-- 调试模式 -->
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">调试模式</span>
							<label class="switch">
								<input type="checkbox" v-model="debugMode" @change="saveDebugMode" />
								<span class="slider"></span>
							</label>
						</div>
						<p class="setting-desc">开启后每步操作需确认，图片保存到 ~/.nutbot/debug</p>
					</div>
					
					<!-- 沙盒模式 -->
					<div class="setting-item">
						<div class="setting-header">
							<span class="setting-label">沙盒模式</span>
							<select v-model="sandboxMode" class="input-sm" @change="saveSandboxMode">
								<option value="off">关闭</option>
								<option value="permissive">宽松</option>
								<option value="strict">严格</option>
							</select>
						</div>
						<p class="setting-desc">控制 AI 执行危险操作的权限</p>
					</div>
				</div>
			</section>

			<!-- AI Provider -->
			<section id="provider" class="settings-section">
				<h2 class="section-title">
					<span>🤖</span>
					AI Provider
				</h2>
				
				<!-- Provider 列表 -->
				<div class="provider-list">
					<div v-for="provider in store.providers" :key="provider.id" class="provider-card">
						<div class="provider-header">
							<div class="provider-info">
								<span class="provider-name">{{ provider.name || provider.id }}</span>
								<span class="provider-url">{{ provider.baseUrl }}</span>
							</div>
							<div class="provider-actions">
								<button @click="editProvider(provider)" class="btn-sm">编辑</button>
								<button @click="removeProvider(provider.id)" class="btn-sm btn-danger">删除</button>
							</div>
						</div>
						
						<!-- 模型列表 -->
						<div class="models-section">
							<div class="models-header">
								<span>模型 ({{ provider.models?.length || 0 }})</span>
								<div class="models-actions">
									<input
										v-model="modelSearchQuery[provider.id]"
										placeholder="搜索/添加..."
										class="input-xs"
										@keyup.enter="addModel(provider.id)"
									/>
									<button
										@click="fetchModels(provider)"
										:disabled="loadingStates[`fetch-${provider.id}`]"
										class="btn-xs"
									>
										{{ loadingStates[`fetch-${provider.id}`] ? '获取中' : '获取' }}
									</button>
								</div>
							</div>
							
							<div v-if="provider.models?.length" class="model-list">
								<div
									v-for="model in filterModels(provider)"
									:key="model"
									class="model-item"
									:class="{ 'is-default': isDefaultModel(provider.id, model) }"
								>
									<span class="model-name" :title="model">{{ model }}</span>
									<div class="model-badges">
										<span v-if="isDefaultModel(provider.id, model)" class="badge badge-blue">默认</span>
										<span v-if="modelVisionSupport[`${provider.id}/${model}`]" class="badge badge-green">图像</span>
									</div>
									<div class="model-actions">
										<button @click="testModel(provider.id, model)" :disabled="loadingStates[`test-${provider.id}/${model}`]" class="btn-xs">
											{{ loadingStates[`test-${provider.id}/${model}`] ? '...' : '测试' }}
										</button>
										<button @click="testVision(provider.id, model)" :disabled="loadingStates[`vision-${provider.id}/${model}`]" class="btn-xs">
											{{ loadingStates[`vision-${provider.id}/${model}`] ? '...' : '图像' }}
										</button>
										<button v-if="!isDefaultModel(provider.id, model)" @click="setDefaultModel(provider.id, model)" class="btn-xs btn-primary">默认</button>
										<button @click="removeModel(provider.id, model)" class="btn-xs btn-danger">×</button>
									</div>
								</div>
							</div>
							<div v-else class="models-empty">暂无模型</div>
						</div>
					</div>
					
					<div v-if="store.providers.length === 0" class="empty-state">
						还没有配置 AI Provider
					</div>
				</div>
				
				<!-- 添加/编辑 Provider -->
				<div class="provider-form">
					<h3>{{ editingProvider ? '编辑 Provider' : '添加 Provider' }}</h3>
					<form @submit.prevent="saveProvider" class="form-grid">
						<div class="form-row">
							<div class="form-group">
								<label>ID</label>
								<input v-model="providerForm.id" placeholder="如: openai" class="input-sm" :disabled="!!editingProvider" />
							</div>
							<div class="form-group">
								<label>类型</label>
								<select v-model="providerForm.type" class="input-sm">
									<option value="openai">OpenAI 兼容</option>
									<option value="anthropic">Anthropic</option>
								</select>
							</div>
						</div>
						<div class="form-group">
							<label>名称</label>
							<input v-model="providerForm.name" placeholder="显示名称（可选）" class="input-sm" />
						</div>
						<div class="form-group">
							<label>API 地址</label>
							<input v-model="providerForm.baseUrl" placeholder="https://api.openai.com/v1" class="input-sm" />
						</div>
						<div class="form-group">
							<label>API Key</label>
							<input v-model="providerForm.apiKey" type="password" :placeholder="editingProvider ? '留空不修改' : 'sk-...'" class="input-sm" />
						</div>
						<div class="form-actions">
							<button v-if="editingProvider" type="button" @click="cancelEdit" class="btn-sm">取消</button>
							<button type="submit" :disabled="loadingStates['save-provider']" class="btn-sm btn-primary">
								{{ editingProvider ? '保存' : '添加' }}
							</button>
						</div>
					</form>
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

			<!-- 个人设置 -->
			<section id="user" class="settings-section">
				<h2 class="section-title">
					<span>👤</span>
					个人设置
				</h2>
				
				<div class="settings-grid cols-3">
					<div class="setting-item">
						<label class="setting-label">昵称</label>
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
						<span class="memory-content">{{ memory.content }}</span>
						<div class="memory-actions">
							<button @click="startEditMemory(memory)" class="btn-icon">✏️</button>
							<button @click="deleteMemory(memory.id)" class="btn-icon text-red-400">🗑️</button>
						</div>
					</div>
				</div>
				<div v-else class="empty-state">还没有记忆</div>
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
				
				<div class="sandbox-modes">
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'off' }">
						<span class="mode-badge danger">关闭</span>
						<div class="mode-info">
							<strong>完全信任</strong> - AI 可执行任何操作
							<span class="mode-warning">⚠️ 仅在完全信任时使用</span>
						</div>
					</div>
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'permissive' }">
						<span class="mode-badge warning">宽松</span>
						<div class="mode-info">
							<strong>平衡模式</strong> - 危险操作需确认
							<span class="mode-tip">💡 推荐日常使用</span>
						</div>
					</div>
					<div class="sandbox-mode" :class="{ active: sandboxMode === 'strict' }">
						<span class="mode-badge success">严格</span>
						<div class="mode-info">
							<strong>最高安全</strong> - 所有写操作需确认
							<span class="mode-tip">🔒 每步都需批准</span>
						</div>
					</div>
				</div>
			</section>
		</main>

		<!-- 添加记忆弹窗 -->
		<div v-if="showAddMemory" class="modal-overlay" @click.self="showAddMemory = false">
			<div class="modal-content">
				<h4>添加记忆</h4>
				<div class="form-group">
					<label>类型</label>
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
					<textarea v-model="newMemory.content" placeholder="如：喜欢用英文交流" class="input-sm h-20 resize-none"></textarea>
				</div>
				<div class="form-actions">
					<button @click="showAddMemory = false" class="btn-sm">取消</button>
					<button @click="addMemory" class="btn-sm btn-primary" :disabled="!newMemory.content.trim()">添加</button>
				</div>
			</div>
		</div>

		<!-- 编辑记忆弹窗 -->
		<div v-if="editingMemory" class="modal-overlay" @click.self="editingMemory = null">
			<div class="modal-content">
				<h4>编辑记忆</h4>
				<div class="form-group">
					<label>内容</label>
					<textarea v-model="editMemoryContent" class="input-sm h-20 resize-none"></textarea>
				</div>
				<div class="form-actions">
					<button @click="editingMemory = null" class="btn-sm">取消</button>
					<button @click="saveMemoryEdit(editingMemory)" class="btn-sm btn-primary">保存</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';

const store = useAppStore();
const contentRef = ref(null);
const activeCategory = ref('quick');

// 分类导航
const categories = [
	{ id: 'quick', icon: '⚡', label: '快速设置' },
	{ id: 'provider', icon: '🤖', label: 'AI Provider' },
	{ id: 'ocr', icon: '👁️', label: 'OCR-SoM' },
	{ id: 'user', icon: '👤', label: '个人设置' },
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

// 表单状态
const providerForm = reactive({
	id: '',
	name: '',
	type: 'openai',
	baseUrl: '',
	apiKey: '',
});
const editingProvider = ref(null);
const modelSearchQuery = reactive({});
const loadingStates = reactive({});
const modelVisionSupport = reactive({});

// 配置
const defaultModel = ref('');
const sandboxMode = ref('permissive');
const debugMode = ref(false);
const config = reactive({
	server: { host: '127.0.0.1', port: 18800 },
});

// OCR-SoM 配置
const ocrConfig = reactive({
	enabled: true,
	baseUrl: 'http://localhost:5000',
	timeout: 30000,
});
const ocrStatus = ref(null);

// 用户设置
const userSettings = reactive({
	name: '',
	location: '',
	language: '',
	customPrompt: '',
});

// 记忆管理
const memories = ref([]);
const showAddMemory = ref(false);
const editingMemory = ref(null);
const editMemoryContent = ref('');
const newMemory = reactive({
	category: 'preference',
	content: '',
});

const categoryLabels = {
	preference: '偏好',
	habit: '习惯',
	fact: '事实',
	instruction: '指令',
	other: '其他',
};

// ========== Provider 操作 ==========

const editProvider = (provider) => {
	editingProvider.value = provider.id;
	providerForm.id = provider.id;
	providerForm.name = provider.name || '';
	providerForm.type = provider.type || 'openai';
	providerForm.baseUrl = provider.baseUrl || '';
	providerForm.apiKey = '';
};

const cancelEdit = () => {
	editingProvider.value = null;
	resetProviderForm();
};

const resetProviderForm = () => {
	providerForm.id = '';
	providerForm.name = '';
	providerForm.type = 'openai';
	providerForm.baseUrl = '';
	providerForm.apiKey = '';
};

const saveProvider = async () => {
	if (!providerForm.baseUrl) {
		alert('请填写 API 地址');
		return;
	}

	loadingStates['save-provider'] = true;

	try {
		if (editingProvider.value) {
			const updateData = {
				name: providerForm.name,
				type: providerForm.type,
				baseUrl: providerForm.baseUrl,
			};
			if (providerForm.apiKey) {
				updateData.apiKey = providerForm.apiKey;
			}
			await api.put(`/api/providers/${editingProvider.value}`, updateData);
		} else {
			if (!providerForm.id || !providerForm.apiKey) {
				alert('请填写 ID 和 API Key');
				return;
			}
			await api.post('/api/providers', providerForm);
		}

		await store.loadProviders();
		cancelEdit();
	} catch (error) {
		alert('保存失败: ' + error.message);
	} finally {
		loadingStates['save-provider'] = false;
	}
};

const removeProvider = async (id) => {
	if (!confirm('确定删除这个 Provider？')) return;

	try {
		await api.del(`/api/providers/${id}`);
		await store.loadProviders();
	} catch (error) {
		alert('删除失败: ' + error.message);
	}
};

// ========== 模型操作 ==========

const fetchModels = async (provider) => {
	const key = `fetch-${provider.id}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${provider.id}/models?refresh=true`);
		if (result.models?.length) {
			const existingModels = provider.models || [];
			const newModels = [...new Set([...existingModels, ...result.models])];
			await api.put(`/api/providers/${provider.id}/models`, { models: newModels });
			await store.loadProviders();
		} else {
			alert('未获取到模型列表');
		}
	} catch (error) {
		alert('获取失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const addModel = async (providerId) => {
	const model = (modelSearchQuery[providerId] || '').trim();
	if (!model) return;

	const provider = store.providers.find((p) => p.id === providerId);
	if (!provider) return;

	const models = [...(provider.models || [])];
	if (!models.includes(model)) {
		models.push(model);
		try {
			await api.put(`/api/providers/${providerId}/models`, { models });
			await store.loadProviders();
			modelSearchQuery[providerId] = '';
		} catch (error) {
			alert('添加失败: ' + error.message);
		}
	}
};

const filterModels = (provider) => {
	const query = (modelSearchQuery[provider.id] || '').toLowerCase().trim();
	if (!query) return provider.models || [];
	return (provider.models || []).filter((m) => m.toLowerCase().includes(query));
};

const removeModel = async (providerId, model) => {
	const provider = store.providers.find((p) => p.id === providerId);
	if (!provider) return;

	const models = (provider.models || []).filter((m) => m !== model);
	try {
		await api.put(`/api/providers/${providerId}/models`, { models });
		await store.loadProviders();
	} catch (error) {
		alert('删除失败: ' + error.message);
	}
};

const testModel = async (providerId, model) => {
	const key = `test-${providerId}/${model}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${providerId}/test?model=${encodeURIComponent(model)}`);
		alert(result.success ? `✅ 连接成功` : `❌ ${result.message}`);
	} catch (error) {
		alert('❌ ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const testVision = async (providerId, model) => {
	const key = `vision-${providerId}/${model}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${providerId}/test-vision?model=${encodeURIComponent(model)}`);
		const modelKey = `${providerId}/${model}`;

		if (result.supported) {
			modelVisionSupport[modelKey] = true;
			await api.patch(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, { supportsVision: true });
			await store.loadProviders();
			alert(`✅ 支持图像理解`);
		} else {
			modelVisionSupport[modelKey] = false;
			await api.patch(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, { supportsVision: false });
			await store.loadProviders();
			alert(`❌ 不支持图像理解`);
		}
	} catch (error) {
		alert('❌ ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const setDefaultModel = async (providerId, model) => {
	const modelRef = `${providerId}/${model}`;
	try {
		await api.put('/api/config', { 'agent.defaultModel': modelRef });
		defaultModel.value = modelRef;
		await store.loadConfig();
	} catch (error) {
		alert('设置失败: ' + error.message);
	}
};

const isDefaultModel = (providerId, model) => {
	return defaultModel.value === `${providerId}/${model}`;
};

// ========== 其他设置 ==========

const saveSandboxMode = async () => {
	try {
		await api.put('/api/config', { 'sandbox.mode': sandboxMode.value });
	} catch (error) {
		console.error('Save failed:', error);
	}
};

const saveDebugMode = async () => {
	try {
		await api.put('/api/config', { 'agent.debugMode': debugMode.value });
	} catch (error) {
		console.error('Save debug mode failed:', error);
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

// ========== 用户设置 ==========

const loadUserSettings = async () => {
	try {
		const data = await api.get('/api/user');
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
			name: userSettings.name || null,
			location: userSettings.location || null,
			language: userSettings.language || null,
			customPrompt: userSettings.customPrompt || null,
		});
	} catch (error) {
		console.error('Save user settings failed:', error);
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
	} catch (error) {
		alert('添加失败: ' + error.message);
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
	} catch (error) {
		alert('保存失败: ' + error.message);
	}
};

const deleteMemory = async (id) => {
	if (!confirm('确定删除？')) return;
	try {
		await api.del(`/api/memories/${id}`);
		await loadMemories();
	} catch (error) {
		alert('删除失败: ' + error.message);
	}
};

// ========== 初始化 ==========

onMounted(async () => {
	await store.loadProviders();
	await store.loadConfig();
	await loadUserSettings();
	await loadMemories();
	await loadOcrConfig();

	defaultModel.value = store.config.agent?.defaultModel || '';
	sandboxMode.value = store.config.sandbox?.mode || 'permissive';
	debugMode.value = store.config.agent?.debugMode || false;
	Object.assign(config.server, store.config.server || {});

	for (const provider of store.providers) {
		const visionModels = provider.visionModels || [];
		for (const model of visionModels) {
			modelVisionSupport[`${provider.id}/${model}`] = true;
		}
	}

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
	cursor: pointer;
	color: var(--text-secondary);
	font-size: 13px;
	text-align: left;
	transition: all 0.15s;
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
	max-width: 900px;
}

.settings-section {
	margin-bottom: 32px;
	padding-bottom: 24px;
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
	margin-bottom: 12px;
}

.section-desc {
	font-size: 13px;
	color: var(--text-muted);
	margin-bottom: 16px;
}

/* 设置网格 */
.settings-grid {
	display: grid;
	gap: 12px;
}

.settings-grid.cols-2 {
	grid-template-columns: repeat(2, 1fr);
}

.settings-grid.cols-3 {
	grid-template-columns: repeat(3, 1fr);
}

.setting-item {
	padding: 12px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
}

.setting-item.full-width {
	grid-column: 1 / -1;
}

.setting-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.setting-label {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
}

.setting-value {
	font-size: 13px;
	color: var(--text-secondary);
}

.setting-desc {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 6px;
}

.setting-hint {
	font-size: 11px;
	color: var(--text-muted);
	margin-top: 4px;
}

/* 输入框尺寸 */
.input-xs {
	padding: 4px 8px;
	font-size: 12px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-primary);
	outline: none;
}

.input-sm {
	width: 100%;
	padding: 6px 10px;
	font-size: 13px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	outline: none;
}

.input-xs:focus, .input-sm:focus {
	border-color: var(--accent);
}

/* 按钮尺寸 */
.btn-xs {
	padding: 2px 8px;
	font-size: 11px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-primary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-sm {
	padding: 6px 12px;
	font-size: 12px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-xs:hover, .btn-sm:hover {
	background-color: var(--bg-hover);
}

.btn-xs:disabled, .btn-sm:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.btn-primary {
	background-color: var(--accent);
	border-color: var(--accent);
	color: white;
}

.btn-primary:hover:not(:disabled) {
	background-color: var(--accent-hover);
}

.btn-danger {
	color: var(--error);
}

.btn-danger:hover {
	background-color: rgba(244, 67, 54, 0.1);
}

/* Provider */
.provider-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-bottom: 16px;
}

.provider-card {
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 12px;
}

.provider-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}

.provider-info {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.provider-name {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
}

.provider-url {
	font-size: 11px;
	color: var(--text-muted);
}

.provider-actions {
	display: flex;
	gap: 6px;
}

.models-section {
	border-top: 1px solid var(--border-color);
	padding-top: 12px;
}

.models-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
	font-size: 12px;
	color: var(--text-secondary);
}

.models-actions {
	display: flex;
	gap: 6px;
}

.model-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-height: 200px;
	overflow-y: auto;
}

.model-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	background-color: var(--bg-tertiary);
	border-radius: 4px;
	font-size: 12px;
}

.model-item.is-default {
	background-color: var(--accent-subtle);
	border: 1px solid var(--accent);
}

.model-name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--text-primary);
}

.model-badges {
	display: flex;
	gap: 4px;
}

.model-actions {
	display: flex;
	gap: 4px;
}

.models-empty {
	font-size: 12px;
	color: var(--text-muted);
	text-align: center;
	padding: 12px;
}

/* Provider 表单 */
.provider-form {
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	padding: 16px;
}

.provider-form h3 {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
	margin-bottom: 12px;
}

.form-grid {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.form-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;
}

.form-group {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.form-group label {
	font-size: 11px;
	color: var(--text-muted);
}

.form-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 4px;
}

/* Badge */
.badge {
	padding: 2px 6px;
	font-size: 10px;
	border-radius: 4px;
	font-weight: 500;
}

.badge-blue {
	background-color: rgba(0, 122, 204, 0.2);
	color: var(--accent);
}

.badge-green {
	background-color: rgba(78, 201, 176, 0.2);
	color: var(--success);
}

/* OCR 状态 */
.ocr-status {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-top: 8px;
	padding: 8px 12px;
	border-radius: 6px;
	font-size: 12px;
}

.ocr-status.connected {
	background-color: rgba(78, 201, 176, 0.1);
	color: var(--success);
}

.ocr-status.disconnected {
	background-color: rgba(244, 67, 54, 0.1);
	color: var(--error);
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
	gap: 10px;
	padding: 8px 12px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
}

.memory-category {
	padding: 2px 8px;
	font-size: 11px;
	border-radius: 4px;
	flex-shrink: 0;
}

.memory-category.preference {
	background-color: rgba(76, 175, 80, 0.2);
	color: #4caf50;
}

.memory-category.habit {
	background-color: rgba(33, 150, 243, 0.2);
	color: #2196f3;
}

.memory-category.fact {
	background-color: rgba(156, 39, 176, 0.2);
	color: #9c27b0;
}

.memory-category.instruction {
	background-color: rgba(255, 152, 0, 0.2);
	color: #ff9800;
}

.memory-category.other {
	background-color: var(--bg-tertiary);
	color: var(--text-muted);
}

.memory-content {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
}

.memory-actions {
	display: flex;
	gap: 4px;
}

.btn-icon {
	padding: 4px;
	background: none;
	border: none;
	cursor: pointer;
	border-radius: 4px;
	transition: background 0.15s;
}

.btn-icon:hover {
	background-color: var(--bg-hover);
}

/* 沙盒模式 */
.sandbox-modes {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.sandbox-mode {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 12px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	opacity: 0.6;
	transition: all 0.15s;
}

.sandbox-mode.active {
	opacity: 1;
	border-color: var(--accent);
	background-color: var(--accent-subtle);
}

.mode-badge {
	padding: 4px 10px;
	font-size: 11px;
	font-weight: 600;
	border-radius: 4px;
	flex-shrink: 0;
}

.mode-badge.danger {
	background-color: rgba(244, 67, 54, 0.2);
	color: #f44336;
}

.mode-badge.warning {
	background-color: rgba(255, 152, 0, 0.2);
	color: #ff9800;
}

.mode-badge.success {
	background-color: rgba(76, 175, 80, 0.2);
	color: #4caf50;
}

.mode-info {
	font-size: 13px;
	color: var(--text-secondary);
}

.mode-info strong {
	color: var(--text-primary);
}

.mode-warning {
	display: block;
	margin-top: 4px;
	font-size: 11px;
	color: var(--error);
}

.mode-tip {
	display: block;
	margin-top: 4px;
	font-size: 11px;
	color: var(--text-muted);
}

/* 空状态 */
.empty-state {
	text-align: center;
	padding: 24px;
	color: var(--text-muted);
	font-size: 13px;
}

/* Switch */
.switch {
	position: relative;
	display: inline-block;
	width: 36px;
	height: 20px;
	flex-shrink: 0;
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
	background-color: #52525b;
	transition: 0.3s;
	border-radius: 20px;
}

.slider:before {
	position: absolute;
	content: "";
	height: 14px;
	width: 14px;
	left: 3px;
	bottom: 3px;
	background-color: white;
	transition: 0.3s;
	border-radius: 50%;
}

input:checked + .slider {
	background-color: #10b981;
}

input:checked + .slider:before {
	transform: translateX(16px);
}

/* 弹窗 */
.modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 50;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.6);
}

.modal-content {
	width: 100%;
	max-width: 400px;
	margin: 16px;
	padding: 20px;
	background-color: var(--bg-secondary);
	border-radius: 12px;
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.modal-content h4 {
	font-size: 16px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 16px;
}

/* 响应式 */
@media (max-width: 768px) {
	.settings-sidebar {
		display: none;
	}
	
	.settings-content {
		padding: 16px;
	}
	
	.settings-grid.cols-2,
	.settings-grid.cols-3 {
		grid-template-columns: 1fr;
	}
	
	.form-row {
		grid-template-columns: 1fr;
	}
}

/* 工具类 */
.flex { display: flex; }
.gap-2 { gap: 8px; }
.items-center { align-items: center; }
.ml-auto { margin-left: auto; }
.w-24 { width: 96px; }
.w-64 { width: 256px; }
.h-20 { height: 80px; }
.resize-none { resize: none; }
.text-red-400 { color: #f87171; }
</style>
