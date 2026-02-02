<template>
	<div class="page-container">
		<header class="page-header">
			<div class="header-left">
				<h1 class="page-title">🤖 AI Provider</h1>
				<p class="page-desc">管理 AI 服务提供商，配置 API 密钥和模型</p>
			</div>
			<button class="btn-primary" @click="openAddModal">
				<span>➕</span> 添加
			</button>
		</header>

		<main class="page-content">
			<!-- 已启用的模型 -->
			<section v-if="enabledModels.length > 0" class="enabled-models-section">
				<div class="section-header">
					<h3 class="section-label">已启用的模型 ({{ enabledModels.length }})</h3>
					<div class="default-model-selector">
						<label>默认模型：</label>
						<select v-model="currentDefaultModel" @change="setDefaultModel" class="input-sm">
							<option value="">请选择默认模型</option>
							<option v-for="model in enabledModels" :key="model" :value="model">
								{{ model }}
							</option>
						</select>
					</div>
				</div>
				<div class="enabled-models-list">
					<div
						v-for="model in enabledModels"
						:key="model"
						class="enabled-model-item"
						:class="{ 'is-default': model === currentDefaultModel }"
					>
						<div class="enabled-model-info">
							<span class="enabled-model-name">{{ model }}</span>
							<span v-if="model === currentDefaultModel" class="default-badge">默认</span>
						</div>
						<div class="enabled-model-actions">
							<button
								v-if="model !== currentDefaultModel"
								class="btn-xs"
								@click="setAsDefault(model)"
							>设为默认</button>
							<button class="btn-xs btn-danger" @click="disableModel(model)">禁用</button>
						</div>
					</div>
				</div>
			</section>
			<!-- Provider 列表 -->
			<div v-if="store.providers.length === 0" class="empty-state">
				<div class="empty-icon">🤖</div>
				<p class="empty-text">还没有配置 AI Provider</p>
				<p class="empty-hint">点击上方按钮添加一个</p>
			</div>

			<div v-else class="provider-list">
				<div v-for="provider in store.providers" :key="provider.id" class="provider-card">
					<div class="provider-header">
						<div class="provider-info">
							<div class="provider-name">{{ provider.id }}</div>
							<span class="provider-type">{{ provider.type || 'OpenAI' }} 兼容</span>
						</div>
						<div class="provider-actions">
							<button class="btn-sm" @click="editProvider(provider)">编辑</button>
							<button class="btn-sm btn-danger" @click="removeProvider(provider.id)">删除</button>
						</div>
					</div>
					<div class="provider-url">{{ provider.baseUrl }}</div>

					<!-- 模型列表 -->
					<div class="models-section">
						<div class="models-header">
							<span class="models-title">模型 ({{ (provider.models || []).length }})</span>
							<div class="models-actions">
								<input
									v-model="modelSearchQuery[provider.id]"
									type="text"
									placeholder="搜索/添加..."
									class="model-search"
									@keydown.enter="addModelManually(provider.id)"
								/>
								<button
									class="btn-sm"
									@click="fetchModels(provider)"
									:disabled="loadingStates[`fetch-${provider.id}`]"
								>
									{{ loadingStates[`fetch-${provider.id}`] ? '获取中...' : '获取' }}
								</button>
							</div>
						</div>

						<div class="models-list">
							<div
								v-for="model in filterModels(provider)"
								:key="model"
								class="model-item"
								:class="{ enabled: isModelEnabled(provider.id, model) }"
							>
								<label class="model-checkbox">
									<input
										type="checkbox"
										:checked="isModelEnabled(provider.id, model)"
										@change="toggleModelEnabled(provider.id, model)"
									/>
									<span class="model-name" v-html="highlightModel(provider.id, model)"></span>
								</label>
								<div class="model-actions">
									<span v-if="isModelEnabled(provider.id, model)" class="model-badge enabled">已启用</span>
									<span
										v-if="getModelVisionSupport(provider.id, model)"
										class="model-badge vision"
									>图像</span>
									<button
										class="btn-xs"
										@click="testModel(provider.id, model)"
										:disabled="loadingStates[`test-${provider.id}/${model}`]"
									>测试</button>
									<button
										class="btn-xs"
										@click="testVision(provider.id, model)"
										:disabled="loadingStates[`vision-${provider.id}/${model}`]"
									>图像</button>
									<button class="btn-xs btn-danger" @click="removeModel(provider.id, model)">×</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>

		<!-- 添加/编辑 Provider 弹窗 -->
		<div v-if="showProviderModal" class="modal-overlay" @click.self="closeProviderModal">
			<div class="modal-content">
				<div class="modal-header">
					<h3>{{ editingProvider ? '编辑 Provider' : '添加 Provider' }}</h3>
					<button class="btn-close" @click="closeProviderModal">×</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label>ID <span class="required">*</span></label>
						<input
							v-model="providerForm.id"
							placeholder="如: openai, claude"
							class="input-sm"
							:disabled="!!editingProvider"
						/>
					</div>
					<div class="form-group">
						<label>名称</label>
						<input v-model="providerForm.name" placeholder="显示名称（可选）" class="input-sm" />
					</div>
					<div class="form-group">
						<label>类型</label>
						<select v-model="providerForm.type" class="input-sm">
							<option value="openai">OpenAI 兼容</option>
							<option value="anthropic">Anthropic</option>
						</select>
					</div>
					<div class="form-group">
						<label>API 地址 <span class="required">*</span></label>
						<input v-model="providerForm.baseUrl" placeholder="https://api.openai.com/v1" class="input-sm" />
					</div>
					<div class="form-group">
						<label>API Key {{ editingProvider ? '（留空保持不变）' : '' }} <span v-if="!editingProvider" class="required">*</span></label>
						<input
							v-model="providerForm.apiKey"
							type="password"
							placeholder="sk-..."
							class="input-sm"
						/>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn-sm" @click="closeProviderModal">取消</button>
					<button
						class="btn-sm btn-primary"
						@click="saveProvider"
						:disabled="loadingStates['save-provider']"
					>
						{{ loadingStates['save-provider'] ? '保存中...' : '保存' }}
					</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';

const store = useAppStore();

// 状态
const showProviderModal = ref(false);
const editingProvider = ref(null);
const loadingStates = reactive({});
const modelSearchQuery = reactive({});
const modelVisionSupport = reactive({});

// 表单
const providerForm = reactive({
	id: '',
	name: '',
	type: 'openai',
	baseUrl: '',
	apiKey: '',
});

// 启用的模型
const enabledModels = computed(() => store.config?.agent?.enabledModels || []);

// 默认模型
const currentDefaultModel = computed({
	get: () => store.config?.agent?.defaultModel || '',
	set: () => {}, // 通过 setDefaultModel 方法设置
});

// 初始化
onMounted(async () => {
	await store.loadProviders();
	await store.loadConfig();
});

// ========== Provider 操作 ==========

const openAddModal = () => {
	editingProvider.value = null;
	resetProviderForm();
	showProviderModal.value = true;
};

const editProvider = (provider) => {
	editingProvider.value = provider.id;
	providerForm.id = provider.id;
	providerForm.name = provider.name || '';
	providerForm.type = provider.type || 'openai';
	providerForm.baseUrl = provider.baseUrl || '';
	providerForm.apiKey = '';
	showProviderModal.value = true;
};

const closeProviderModal = () => {
	showProviderModal.value = false;
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
		toast.warning('请填写 API 地址');
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
				toast.warning('请填写 ID 和 API Key');
				loadingStates['save-provider'] = false;
				return;
			}
			await api.post('/api/providers', providerForm);
		}

		await store.loadProviders();
		closeProviderModal();
		toast.success('保存成功');
	} catch (error) {
		toast.error('保存失败: ' + error.message);
	} finally {
		loadingStates['save-provider'] = false;
	}
};

const removeProvider = async (id) => {
	if (!confirm('确定删除这个 Provider？')) return;

	try {
		await api.del(`/api/providers/${id}`);
		await store.loadProviders();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

// ========== 模型操作 ==========

const fetchModels = async (provider) => {
	const key = `fetch-${provider.id}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${provider.id}/models`);
		if (result.models?.length > 0) {
			await api.put(`/api/providers/${provider.id}/models`, { models: result.models });
			await store.loadProviders();
			toast.success('获取成功');
		} else {
			toast.warning('未获取到模型列表');
		}
	} catch (error) {
		toast.error('获取失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const filterModels = (provider) => {
	const query = (modelSearchQuery[provider.id] || '').toLowerCase();
	return (provider.models || []).filter((m) => m.toLowerCase().includes(query));
};

// 高亮模型名称
const highlightModel = (providerId, model) => {
	const query = (modelSearchQuery[providerId] || '').trim();
	if (!query) return model;
	
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escaped})`, 'gi');
	return model.replace(regex, '<mark class="highlight">$1</mark>');
};

const addModelManually = async (providerId) => {
	const modelName = modelSearchQuery[providerId]?.trim();
	if (!modelName) return;

	const provider = store.providers.find((p) => p.id === providerId);
	if (!provider) return;

	if ((provider.models || []).includes(modelName)) {
		toast.warning('模型已存在');
		return;
	}

	try {
		const models = [...(provider.models || []), modelName];
		await api.put(`/api/providers/${providerId}/models`, { models });
		await store.loadProviders();
		modelSearchQuery[providerId] = '';
		toast.success('添加成功');
	} catch (error) {
		toast.error('添加失败: ' + error.message);
	}
};

const removeModel = async (providerId, model) => {
	const provider = store.providers.find((p) => p.id === providerId);
	if (!provider) return;

	const models = (provider.models || []).filter((m) => m !== model);
	try {
		await api.put(`/api/providers/${providerId}/models`, { models });
		await store.loadProviders();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

const isModelEnabled = (providerId, model) => {
	const modelRef = `${providerId}/${model}`;
	return enabledModels.value.includes(modelRef);
};

const toggleModelEnabled = async (providerId, model) => {
	const modelRef = `${providerId}/${model}`;
	let newEnabledModels = [...enabledModels.value];

	if (newEnabledModels.includes(modelRef)) {
		newEnabledModels = newEnabledModels.filter((m) => m !== modelRef);
		// 如果禁用的是默认模型，清除默认模型
		if (currentDefaultModel.value === modelRef) {
			await api.put('/api/config', { 
				'agent.enabledModels': newEnabledModels,
				'agent.defaultModel': ''
			});
			await store.loadConfig();
			return;
		}
	} else {
		newEnabledModels.push(modelRef);
	}

	try {
		await api.put('/api/config', { 'agent.enabledModels': newEnabledModels });
		await store.loadConfig();
	} catch (error) {
		toast.error('设置失败: ' + error.message);
	}
};

// 设置默认模型
const setDefaultModel = async (e) => {
	const model = e.target.value;
	try {
		await api.put('/api/config', { 'agent.defaultModel': model });
		await store.loadConfig();
		toast.success(model ? '已设置默认模型' : '已清除默认模型');
	} catch (error) {
		toast.error('设置失败: ' + error.message);
	}
};

// 设为默认
const setAsDefault = async (model) => {
	try {
		await api.put('/api/config', { 'agent.defaultModel': model });
		await store.loadConfig();
		toast.success('已设置为默认模型');
	} catch (error) {
		toast.error('设置失败: ' + error.message);
	}
};

// 禁用模型
const disableModel = async (modelRef) => {
	let newEnabledModels = enabledModels.value.filter((m) => m !== modelRef);
	
	try {
		const updates = { 'agent.enabledModels': newEnabledModels };
		// 如果禁用的是默认模型，清除默认模型
		if (currentDefaultModel.value === modelRef) {
			updates['agent.defaultModel'] = '';
		}
		await api.put('/api/config', updates);
		await store.loadConfig();
		toast.success('已禁用');
	} catch (error) {
		toast.error('禁用失败: ' + error.message);
	}
};

const testModel = async (providerId, model) => {
	const key = `test-${providerId}/${model}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${providerId}/test?model=${encodeURIComponent(model)}`);
		if (result.success) {
			toast.success('连接成功');
		} else {
			toast.error(result.message);
		}
	} catch (error) {
		toast.error(error.message);
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
			toast.success('支持图像理解');
		} else {
			modelVisionSupport[modelKey] = false;
			await api.patch(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, { supportsVision: false });
			await store.loadProviders();
			toast.warning('不支持图像理解');
		}
	} catch (error) {
		toast.error(error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const getModelVisionSupport = (providerId, model) => {
	const provider = store.providers.find((p) => p.id === providerId);
	if (!provider?.modelInfo?.[model]) return false;
	return provider.modelInfo[model].supportsVision;
};
</script>

<style scoped>
.page-container {
	display: flex;
	flex-direction: column;
	height: 100%;
	background-color: var(--bg-primary);
}

.page-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	padding: 24px 32px;
	border-bottom: 1px solid var(--border-color);
	background-color: var(--bg-secondary);
}

.header-left {
	flex: 1;
}

.page-title {
	font-size: 20px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 4px;
}

.page-desc {
	font-size: 13px;
	color: var(--text-muted);
}

.page-content {
	flex: 1;
	overflow-y: auto;
	padding: 24px 32px;
}

/* 启用的模型区域 */
.enabled-models-section {
	margin-bottom: 24px;
	padding: 20px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 12px;
}

.section-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.section-label {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}

.default-model-selector {
	display: flex;
	align-items: center;
	gap: 8px;
}

.default-model-selector label {
	font-size: 13px;
	color: var(--text-muted);
}

.default-model-selector .input-sm {
	width: 280px;
}

.enabled-models-list {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}

.enabled-model-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 14px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	transition: all 0.15s;
}

.enabled-model-item.is-default {
	border-color: var(--accent);
	background-color: rgba(59, 130, 246, 0.08);
}

.enabled-model-info {
	display: flex;
	align-items: center;
	gap: 8px;
}

.enabled-model-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
	font-family: ui-monospace, monospace;
}

.default-badge {
	font-size: 10px;
	padding: 2px 6px;
	background-color: var(--accent);
	color: white;
	border-radius: 4px;
}

.enabled-model-actions {
	display: flex;
	gap: 6px;
}

/* 空状态 */
.empty-state {
	padding: 48px;
	text-align: center;
	background-color: var(--bg-secondary);
	border: 1px dashed var(--border-color);
	border-radius: 12px;
}

.empty-icon {
	font-size: 48px;
	margin-bottom: 12px;
}

.empty-text {
	font-size: 15px;
	color: var(--text-primary);
	margin-bottom: 4px;
}

.empty-hint {
	font-size: 13px;
	color: var(--text-muted);
}

/* Provider 列表 */
.provider-list {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.provider-card {
	padding: 20px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 12px;
}

.provider-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}

.provider-info {
	display: flex;
	align-items: center;
	gap: 12px;
}

.provider-name {
	font-size: 16px;
	font-weight: 600;
	color: var(--text-primary);
}

.provider-type {
	font-size: 11px;
	padding: 3px 8px;
	background-color: var(--accent-subtle);
	color: var(--accent);
	border-radius: 4px;
}

.provider-actions {
	display: flex;
	gap: 8px;
}

.provider-url {
	font-size: 12px;
	color: var(--text-muted);
	font-family: ui-monospace, monospace;
	margin-bottom: 16px;
}

/* 模型列表 */
.models-section {
	border-top: 1px solid var(--border-color);
	padding-top: 16px;
}

.models-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}

.models-title {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-secondary);
}

.models-actions {
	display: flex;
	gap: 8px;
}

.model-search {
	width: 160px;
	padding: 6px 10px;
	font-size: 12px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	outline: none;
}

.model-search:focus {
	border-color: var(--accent);
}

.models-list {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: 300px;
	overflow-y: auto;
}

.model-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px;
	background-color: var(--bg-tertiary);
	border-radius: 6px;
	transition: background 0.15s;
}

.model-item:hover {
	background-color: var(--bg-hover);
}

.model-item.enabled {
	background-color: var(--accent-subtle);
}

.model-checkbox {
	display: flex;
	align-items: center;
	gap: 10px;
	cursor: pointer;
}

.model-checkbox input {
	width: 16px;
	height: 16px;
	accent-color: var(--accent);
}

.model-name {
	font-size: 13px;
	color: var(--text-primary);
	font-family: ui-monospace, monospace;
}

.model-actions {
	display: flex;
	align-items: center;
	gap: 6px;
}

.model-badge {
	font-size: 10px;
	padding: 2px 6px;
	border-radius: 4px;
}

.model-badge.enabled {
	background-color: rgba(16, 185, 129, 0.2);
	color: #10b981;
}

.model-badge.vision {
	background-color: rgba(59, 130, 246, 0.2);
	color: #3b82f6;
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
	width: 90%;
	max-width: 480px;
	background-color: var(--bg-secondary);
	border-radius: 12px;
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
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

.form-group label {
	display: block;
	font-size: 13px;
	color: var(--text-secondary);
	margin-bottom: 6px;
}

.form-group label .required {
	color: var(--error);
}

/* 通用按钮 */
.btn-primary {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 10px 16px;
	font-size: 13px;
	background-color: var(--accent);
	border: none;
	border-radius: 8px;
	color: white;
	cursor: pointer;
	transition: background 0.15s;
}

.btn-primary:hover {
	background-color: var(--accent-hover);
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

.btn-sm.btn-danger {
	color: var(--error);
}

.btn-sm.btn-danger:hover:not(:disabled) {
	background-color: rgba(239, 68, 68, 0.1);
}

.btn-xs {
	padding: 4px 8px;
	font-size: 11px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-secondary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-xs:hover:not(:disabled) {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.btn-xs:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.btn-xs.btn-danger {
	color: var(--error);
}

.btn-xs.btn-danger:hover:not(:disabled) {
	background-color: rgba(239, 68, 68, 0.1);
}

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

/* 搜索高亮 */
:deep(.highlight) {
	background-color: rgba(245, 158, 11, 0.3);
	color: #fbbf24;
	padding: 0 2px;
	border-radius: 2px;
}
</style>
