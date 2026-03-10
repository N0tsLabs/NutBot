<template>
	<div class="page-container">
		<!-- 页面标题 -->
		<header class="page-header">
			<div class="header-left">
				<h1 class="page-title">🤖 AI Provider</h1>
				<p class="page-desc">管理 AI 服务提供商和模型库</p>
			</div>
		</header>

		<main class="page-content">
			<!-- 供应商管理区域 -->
			<section class="section">
				<div class="section-header">
					<h2 class="section-title">🏢 供应商管理</h2>
					<button class="btn-primary" @click="openProviderModal()">
						<span>➕</span> 添加供应商
					</button>
				</div>

				<div v-if="store.providers.length === 0" class="empty-state">
					<div class="empty-icon">🏢</div>
					<p class="empty-text">还没有配置 AI Provider</p>
					<p class="empty-hint">点击上方"添加供应商"按钮开始配置</p>
				</div>

				<div v-else class="provider-list">
					<div v-for="provider in store.providers" :key="provider.id" class="provider-card">
						<div class="provider-header">
							<div class="provider-info">
								<div class="provider-name">{{ provider.name || provider.id }}</div>
								<span class="provider-type">{{ provider.type || 'OpenAI' }} 兼容</span>
							</div>
							<div class="provider-actions">
								<button class="btn-sm" @click="openProviderModal(provider)">编辑</button>
								<button class="btn-sm btn-danger" @click="removeProvider(provider.id)">删除</button>
							</div>
						</div>
						<div class="provider-url">{{ provider.baseUrl }}</div>
						<div class="provider-actions-row">
							<button
								class="btn-sm btn-primary"
								@click="fetchModels(provider)"
								:disabled="loadingStates[`fetch-${provider.id}`]"
							>
								{{ loadingStates[`fetch-${provider.id}`] ? '获取中...' : '🔍 获取模型列表' }}
							</button>
							<button class="btn-sm" @click="testProvider(provider.id)">
								测试连接
							</button>
						</div>
					</div>
				</div>
			</section>

			<!-- 模型库管理区域 -->
			<section class="section">
				<div class="section-header">
					<h2 class="section-title">📚 模型库</h2>
					<div class="section-actions">
						<button class="btn-primary" @click="openAddModelModal()">
							<span>➕</span> 手动添加模型
						</button>
					</div>
				</div>

				<!-- 默认模型选择 -->
				<div class="default-model-section" v-if="modelLibrary.models.length > 0">
					<label>默认模型：</label>
					<select v-model="defaultModelId" @change="setDefaultModel" class="input-sm">
						<option value="">不设置默认模型</option>
						<option v-for="model in enabledModels" :key="model.id" :value="model.id">
							{{ model.name }} ({{ model.providerId }})
						</option>
					</select>
				</div>

				<div v-if="modelLibrary.models.length === 0" class="empty-state">
					<div class="empty-icon">📚</div>
					<p class="empty-text">模型库为空</p>
					<p class="empty-hint">从供应商获取模型或手动添加模型</p>
				</div>

				<div v-else class="models-table">
					<div class="models-table-header">
						<div class="col-enable">启用</div>
						<div class="col-name">模型名称</div>
						<div class="col-provider">供应商</div>
						<div class="col-capabilities">能力</div>
						<div class="col-actions">操作</div>
					</div>
					<div class="models-table-body">
						<div
							v-for="model in modelLibrary.models"
							:key="model.id"
							class="model-row"
							:class="{ 'is-default': model.id === defaultModelId, 'is-disabled': !model.enabled }"
						>
							<div class="col-enable">
								<input
									type="checkbox"
									:checked="model.enabled"
									@change="toggleModelEnabled(model)"
								/>
							</div>
							<div class="col-name">
								<span class="model-name">{{ model.name }}</span>
								<span v-if="model.id === defaultModelId" class="default-badge">默认</span>
							</div>
							<div class="col-provider">{{ model.providerId }}</div>
							<div class="col-capabilities">
								<span v-if="model.supportsVision" class="capability-badge vision">👁️ 图像</span>
								<span v-if="model.supportsFunctionCall" class="capability-badge">🔧 工具</span>
								<span v-if="model.supportsThinking" class="capability-badge">🧠 思考</span>
							</div>
							<div class="col-actions">
								<button class="btn-xs" @click="testModel(model)">测试</button>
								<button class="btn-xs" @click="openEditModelModal(model)">编辑</button>
								<button class="btn-xs btn-danger" @click="removeModel(model.id)">删除</button>
							</div>
						</div>
					</div>
				</div>
			</section>
		</main>

		<!-- 供应商添加/编辑弹窗 -->
		<div v-if="showProviderModal" class="modal-overlay" @click.self="closeProviderModal">
			<div class="modal-content">
				<div class="modal-header">
					<h3>{{ editingProvider ? '编辑供应商' : '添加供应商' }}</h3>
					<button class="btn-close" @click="closeProviderModal">×</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label>供应商名称 <span class="required">*</span></label>
						<input
							v-model="providerForm.name"
							placeholder="如: OpenAI, Claude, Gemini"
							class="input-sm"
							:disabled="!!editingProvider"
						/>
					</div>
					<div class="form-group">
						<label>API 协议 <span class="required">*</span></label>
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
						<label>API Key <span class="required">*</span></label>
						<input
							v-model="providerForm.apiKey"
							type="text"
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

		<!-- 从供应商获取模型弹窗 -->
		<div v-if="showFetchModelsModal" class="modal-overlay" @click.self="closeFetchModelsModal">
			<div class="modal-content modal-lg">
				<div class="modal-header">
					<h3>从 {{ currentProvider?.name }} 获取模型</h3>
					<button class="btn-close" @click="closeFetchModelsModal">×</button>
				</div>
				<div class="modal-body">
					<div v-if="fetchedModels.length === 0" class="empty-state">
						<p>点击"获取"按钮从供应商获取可用模型列表</p>
					</div>
					<div v-else class="fetched-models-list">
						<div class="fetched-models-header">
							<label class="checkbox-all">
								<input type="checkbox" :checked="allFetchedSelected" @change="toggleAllFetched" />
								全选
							</label>
							<span>{{ selectedFetchedModels.length }} / {{ fetchedModels.length }} 已选择</span>
						</div>
						<div class="fetched-models-items">
							<div
								v-for="model in fetchedModels"
								:key="model"
								class="fetched-model-item"
							>
								<input
									type="checkbox"
									:checked="selectedFetchedModels.includes(model)"
									@change="toggleFetchedModel(model)"
								/>
								<span class="model-name">{{ model }}</span>
							</div>
						</div>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn-sm" @click="closeFetchModelsModal">取消</button>
					<button
						class="btn-sm"
						@click="doFetchModels"
						:disabled="loadingStates['do-fetch']"
					>
						{{ loadingStates['do-fetch'] ? '获取中...' : '获取模型列表' }}
					</button>
					<button
						class="btn-sm btn-primary"
						@click="addSelectedModels"
						:disabled="selectedFetchedModels.length === 0 || loadingStates['add-selected']"
					>
						{{ loadingStates['add-selected'] ? '添加中...' : `添加选中模型 (${selectedFetchedModels.length})` }}
					</button>
				</div>
			</div>
		</div>

		<!-- 手动添加/编辑模型弹窗 -->
		<div v-if="showModelModal" class="modal-overlay" @click.self="closeModelModal">
			<div class="modal-content">
				<div class="modal-header">
					<h3>{{ editingModel ? '编辑模型' : '添加模型' }}</h3>
					<button class="btn-close" @click="closeModelModal">×</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label>模型名称 <span class="required">*</span></label>
						<input
							v-model="modelForm.name"
							placeholder="如: GPT-4o, gpt-4o-mini"
							class="input-sm"
							:disabled="!!editingModel"
						/>
						<p class="form-hint">模型名称将作为唯一标识，如: gpt-4o</p>
					</div>
					<div class="form-group">
						<label>供应商 <span class="required">*</span></label>
						<select v-model="modelForm.providerId" class="input-sm" :disabled="!!editingModel">
							<option value="">请选择供应商</option>
							<option v-for="provider in store.providers" :key="provider.id" :value="provider.id">
								{{ provider.name || provider.id }}
							</option>
						</select>
						<p v-if="store.providers.length === 0" class="form-hint" style="color: var(--danger);">
							请先添加供应商
						</p>
					</div>
					<div class="form-group">
						<label>模型能力</label>
						<div class="checkbox-group">
							<label class="checkbox-item">
								<input type="checkbox" v-model="modelForm.supportsVision" />
								<span>支持图像理解</span>
							</label>
							<label class="checkbox-item">
								<input type="checkbox" v-model="modelForm.supportsFunctionCall" />
								<span>支持函数调用</span>
							</label>
							<label class="checkbox-item">
								<input type="checkbox" v-model="modelForm.supportsThinking" />
								<span>支持思考/推理</span>
							</label>
						</div>
					</div>
					<div class="form-group">
						<label>描述</label>
						<textarea v-model="modelForm.description" placeholder="模型描述（可选）" class="input-sm" rows="2"></textarea>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn-sm" @click="closeModelModal">取消</button>
					<button
						class="btn-sm btn-primary"
						@click="saveModel"
						:disabled="loadingStates['save-model']"
					>
						{{ loadingStates['save-model'] ? '保存中...' : '保存' }}
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
const showFetchModelsModal = ref(false);
const showModelModal = ref(false);
const editingProvider = ref(null);
const editingModel = ref(null);
const currentProvider = ref(null);
const loadingStates = reactive({});

// 模型库数据
const modelLibrary = ref({ models: [], defaultModelId: null });

// 从供应商获取的模型
const fetchedModels = ref([]);
const selectedFetchedModels = ref([]);

// 表单
const providerForm = reactive({
	name: '',
	type: 'openai',
	baseUrl: '',
	apiKey: '',
});

const modelForm = reactive({
	id: '',
	name: '',
	providerId: '',
	supportsVision: false,
	supportsFunctionCall: false,
	supportsThinking: false,
	description: '',
});

// 计算属性
const enabledModels = computed(() => {
	return modelLibrary.value.models.filter(m => m.enabled);
});

const defaultModelId = computed({
	get: () => modelLibrary.value.defaultModelId || '',
	set: (val) => {},
});

const allFetchedSelected = computed(() => {
	return fetchedModels.value.length > 0 && selectedFetchedModels.value.length === fetchedModels.value.length;
});

// 初始化
onMounted(async () => {
	await store.loadProviders();
	await loadModelLibrary();
});

// 加载模型库
const loadModelLibrary = async () => {
	try {
		const result = await api.get('/api/models');
		modelLibrary.value = result;
	} catch (error) {
		toast.error('加载模型库失败: ' + error.message);
	}
};

// ========== Provider 操作 ==========

const openProviderModal = (provider = null) => {
	if (provider) {
		editingProvider.value = provider.id;
		providerForm.name = provider.name || provider.id;
		providerForm.type = provider.type || 'openai';
		providerForm.baseUrl = provider.baseUrl || '';
		providerForm.apiKey = provider.apiKey || '';
	} else {
		editingProvider.value = null;
		resetProviderForm();
	}
	showProviderModal.value = true;
};

const closeProviderModal = () => {
	showProviderModal.value = false;
	editingProvider.value = null;
	resetProviderForm();
};

const resetProviderForm = () => {
	providerForm.name = '';
	providerForm.type = 'openai';
	providerForm.baseUrl = '';
	providerForm.apiKey = '';
};

const saveProvider = async () => {
	if (!providerForm.name || !providerForm.baseUrl || !providerForm.apiKey) {
		toast.warning('请填写供应商名称、API 地址和 API Key');
		return;
	}

	loadingStates['save-provider'] = true;

	try {
		if (editingProvider.value) {
			const updateData = {
				name: providerForm.name,
				type: providerForm.type,
				baseUrl: providerForm.baseUrl,
				apiKey: providerForm.apiKey,
			};
			await api.put(`/api/providers/${editingProvider.value}`, updateData);
		} else {
			await api.post('/api/providers', {
				name: providerForm.name,
				type: providerForm.type,
				baseUrl: providerForm.baseUrl,
				apiKey: providerForm.apiKey,
			});
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
	if (!confirm('确定删除这个供应商？')) return;

	try {
		await api.del(`/api/providers/${id}`);
		await store.loadProviders();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

const testProvider = async (id) => {
	const key = `test-${id}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${id}/test`);
		if (result.success) {
			toast.success('连接测试成功');
		} else {
			toast.error(result.message || '连接失败');
		}
	} catch (error) {
		toast.error('测试失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

// ========== 从供应商获取模型 ==========

const fetchModels = async (provider) => {
	currentProvider.value = provider;
	fetchedModels.value = [];
	selectedFetchedModels.value = [];
	showFetchModelsModal.value = true;
};

const closeFetchModelsModal = () => {
	showFetchModelsModal.value = false;
	currentProvider.value = null;
	fetchedModels.value = [];
	selectedFetchedModels.value = [];
};

const doFetchModels = async () => {
	if (!currentProvider.value) return;

	const key = 'do-fetch';
	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/providers/${currentProvider.value.id}/models`);
		if (result.models?.length > 0) {
			fetchedModels.value = result.models;
			toast.success(`成功获取 ${result.models.length} 个模型`);
		} else {
			toast.warning('未获取到模型列表，请检查 API 配置');
		}
	} catch (error) {
		toast.error('获取失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

const toggleFetchedModel = (model) => {
	const index = selectedFetchedModels.value.indexOf(model);
	if (index === -1) {
		selectedFetchedModels.value.push(model);
	} else {
		selectedFetchedModels.value.splice(index, 1);
	}
};

const toggleAllFetched = () => {
	if (allFetchedSelected.value) {
		selectedFetchedModels.value = [];
	} else {
		selectedFetchedModels.value = [...fetchedModels.value];
	}
};

const addSelectedModels = async () => {
	if (!currentProvider.value || selectedFetchedModels.value.length === 0) return;

	const key = 'add-selected';
	loadingStates[key] = true;
	try {
		const modelsToAdd = selectedFetchedModels.value.map(modelName => ({
			id: `${currentProvider.value.id}/${modelName}`,
			name: modelName,
			providerId: currentProvider.value.id,
			supportsVision: false, // 默认不开启，需要手动测试
		}));

		await api.post('/api/models/batch', { models: modelsToAdd });
		await loadModelLibrary();
		closeFetchModelsModal();
		toast.success(`成功添加 ${modelsToAdd.length} 个模型到模型库`);
	} catch (error) {
		toast.error('添加失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
};

// ========== 模型库操作 ==========

const openAddModelModal = () => {
	editingModel.value = null;
	resetModelForm();
	showModelModal.value = true;
};

const openEditModelModal = (model) => {
	editingModel.value = model.id;
	modelForm.id = model.id;
	modelForm.name = model.name;
	modelForm.providerId = model.providerId || '';
	modelForm.supportsVision = model.supportsVision || false;
	modelForm.supportsFunctionCall = model.supportsFunctionCall || false;
	modelForm.supportsThinking = model.supportsThinking || false;
	modelForm.description = model.description || '';
	showModelModal.value = true;
};

const closeModelModal = () => {
	showModelModal.value = false;
	editingModel.value = null;
	resetModelForm();
};

const resetModelForm = () => {
	modelForm.id = '';
	modelForm.name = '';
	modelForm.providerId = '';
	modelForm.supportsVision = false;
	modelForm.supportsFunctionCall = false;
	modelForm.supportsThinking = false;
	modelForm.description = '';
};

const saveModel = async () => {
	if (!modelForm.name || !modelForm.providerId) {
		toast.warning('请填写模型名称并选择供应商');
		return;
	}

	// 使用模型名称作为 ID
	const modelId = modelForm.name;

	loadingStates['save-model'] = true;
	try {
		if (editingModel.value) {
			await api.put(`/api/models/${editingModel.value}`, {
				name: modelForm.name,
				providerId: modelForm.providerId,
				supportsVision: modelForm.supportsVision,
				supportsFunctionCall: modelForm.supportsFunctionCall,
				supportsThinking: modelForm.supportsThinking,
				description: modelForm.description,
			});
		} else {
			await api.post('/api/models', {
				id: modelId,
				name: modelForm.name,
				providerId: modelForm.providerId,
				supportsVision: modelForm.supportsVision,
				supportsFunctionCall: modelForm.supportsFunctionCall,
				supportsThinking: modelForm.supportsThinking,
				description: modelForm.description,
			});
		}

		await loadModelLibrary();
		closeModelModal();
		toast.success('保存成功');
	} catch (error) {
		toast.error('保存失败: ' + error.message);
	} finally {
		loadingStates['save-model'] = false;
	}
};

const removeModel = async (id) => {
	if (!confirm('确定从模型库删除这个模型？')) return;

	try {
		await api.del(`/api/models/${id}`);
		await loadModelLibrary();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

const toggleModelEnabled = async (model) => {
	try {
		await api.put(`/api/models/${model.id}`, { enabled: !model.enabled });
		await loadModelLibrary();
		toast.success(model.enabled ? '已禁用' : '已启用');
	} catch (error) {
		toast.error('操作失败: ' + error.message);
	}
};

const setDefaultModel = async (e) => {
	const modelId = e.target.value || null;
	try {
		await api.post('/api/models/default', { modelId });
		await loadModelLibrary();
		toast.success(modelId ? '已设置默认模型' : '已清除默认模型');
	} catch (error) {
		toast.error('设置失败: ' + error.message);
	}
};

const testModel = async (model) => {
	const key = `test-model-${model.id}`;
	if (loadingStates[key]) return;

	loadingStates[key] = true;
	try {
		const result = await api.get(`/api/models/${model.id}/test`);
		if (result.success) {
			toast.success('模型测试成功');
		} else {
			toast.error(result.message || '测试失败');
		}
	} catch (error) {
		toast.error('测试失败: ' + error.message);
	} finally {
		loadingStates[key] = false;
	}
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

/* 区域样式 */
.section {
	margin-bottom: 32px;
}

.section-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 20px;
}

.section-title {
	font-size: 16px;
	font-weight: 600;
	color: var(--text-primary);
}

.section-actions {
	display: flex;
	gap: 12px;
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
	gap: 16px;
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
	margin-bottom: 12px;
}

.provider-actions-row {
	display: flex;
	gap: 8px;
	padding-top: 12px;
	border-top: 1px solid var(--border-color);
}

/* 默认模型选择 */
.default-model-section {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 20px;
	padding: 12px 16px;
	background-color: var(--bg-secondary);
	border-radius: 8px;
}

.default-model-section label {
	font-size: 13px;
	color: var(--text-secondary);
}

.default-model-section select {
	width: 300px;
}

/* 模型表格 */
.models-table {
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 12px;
	overflow: hidden;
}

.models-table-header {
	display: grid;
	grid-template-columns: 60px 1fr 120px 200px 150px;
	gap: 12px;
	padding: 12px 16px;
	background-color: var(--bg-tertiary);
	font-size: 12px;
	font-weight: 600;
	color: var(--text-secondary);
	border-bottom: 1px solid var(--border-color);
}

.models-table-body {
	max-height: 400px;
	overflow-y: auto;
}

.model-row {
	display: grid;
	grid-template-columns: 60px 1fr 120px 200px 150px;
	gap: 12px;
	padding: 12px 16px;
	align-items: center;
	border-bottom: 1px solid var(--border-color);
	transition: background-color 0.15s;
}

.model-row:hover {
	background-color: var(--bg-hover);
}

.model-row.is-default {
	background-color: rgba(59, 130, 246, 0.08);
}

.model-row.is-disabled {
	opacity: 0.6;
}

.model-row:last-child {
	border-bottom: none;
}

.col-enable {
	display: flex;
	align-items: center;
	justify-content: center;
}

.col-enable input {
	width: 18px;
	height: 18px;
	cursor: pointer;
}

.col-name {
	display: flex;
	align-items: center;
	gap: 8px;
}

.model-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
}

.default-badge {
	font-size: 10px;
	padding: 2px 6px;
	background-color: var(--accent);
	color: white;
	border-radius: 4px;
}

.col-provider {
	font-size: 13px;
	color: var(--text-secondary);
}

.col-capabilities {
	display: flex;
	gap: 6px;
}

.capability-badge {
	font-size: 11px;
	padding: 2px 6px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 4px;
	color: var(--text-secondary);
}

.capability-badge.vision {
	background-color: rgba(59, 130, 246, 0.1);
	border-color: rgba(59, 130, 246, 0.3);
	color: #3b82f6;
}

.col-actions {
	display: flex;
	gap: 6px;
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

.modal-content.modal-lg {
	max-width: 600px;
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
	font-weight: 500;
	color: var(--text-secondary);
	margin-bottom: 6px;
}

.form-group label .required {
	color: var(--error);
}

.form-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 4px;
}

.checkbox-group {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.checkbox-item {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
	font-size: 13px;
	color: var(--text-primary);
}

.checkbox-item input {
	width: 16px;
	height: 16px;
}

/* 获取模型弹窗 */
.fetched-models-list {
	max-height: 400px;
	overflow-y: auto;
}

.fetched-models-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px;
	background-color: var(--bg-tertiary);
	border-radius: 8px;
	margin-bottom: 12px;
}

.checkbox-all {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
	font-size: 13px;
}

.fetched-models-items {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.fetched-model-item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	background-color: var(--bg-tertiary);
	border-radius: 6px;
	cursor: pointer;
}

.fetched-model-item:hover {
	background-color: var(--bg-hover);
}

.fetched-model-item input {
	width: 16px;
	height: 16px;
}

.fetched-model-item .model-name {
	font-size: 13px;
	color: var(--text-primary);
	font-family: ui-monospace, monospace;
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
	padding: 4px 10px;
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

textarea.input-sm {
	resize: vertical;
	min-height: 60px;
}
</style>
