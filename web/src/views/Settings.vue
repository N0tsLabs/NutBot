<template>
	<div class="settings-container">
		<h2 class="settings-title">设置</h2>

		<!-- AI Provider 设置 -->
		<section class="card mb-6">
			<h3 class="text-lg font-medium mb-4 flex items-center gap-2">
				<span>🤖</span>
				AI Provider
			</h3>

			<!-- Provider 列表 -->
			<div class="space-y-4 mb-6">
				<div v-for="provider in store.providers" :key="provider.id" class="provider-card">
					<!-- Provider 头部 -->
					<div class="flex items-center justify-between">
						<div class="flex-1 min-w-0">
							<div class="font-medium text-lg">{{ provider.name || provider.id }}</div>
							<div class="text-sm text-zinc-400 truncate">{{ provider.baseUrl }}</div>
						</div>
						<div class="flex items-center gap-2">
							<button @click="editProvider(provider)" class="btn btn-secondary text-sm">编辑</button>
							<button @click="removeProvider(provider.id)" class="text-red-400 hover:text-red-300 px-2">
								删除
							</button>
						</div>
					</div>

					<!-- 模型管理区域 -->
					<div class="mt-4 pt-4 border-t border-zinc-600">
						<div class="flex items-center justify-between mb-3">
							<span class="text-sm font-medium">模型列表 ({{ provider.models?.length || 0 }})</span>
							<button
								@click="fetchModels(provider)"
								:disabled="loadingStates[`fetch-${provider.id}`]"
								class="btn btn-secondary text-xs btn-loading"
								:class="{ loading: loadingStates[`fetch-${provider.id}`] }"
							>
								<span v-if="loadingStates[`fetch-${provider.id}`]" class="spinner"></span>
								{{ loadingStates[`fetch-${provider.id}`] ? '获取中...' : '获取模型列表' }}
							</button>
						</div>

						<!-- 搜索和添加模型 -->
						<div class="flex gap-2 mb-3">
							<input
								v-model="modelSearchQuery[provider.id]"
								placeholder="搜索或添加模型..."
								class="input text-sm flex-1"
								@keyup.enter="addModel(provider.id)"
							/>
							<button
								@click="addModel(provider.id)"
								class="btn btn-secondary text-sm"
								:disabled="!modelSearchQuery[provider.id]?.trim()"
							>
								添加
							</button>
						</div>

						<!-- 模型列表（带搜索过滤和滚动） -->
						<div v-if="provider.models?.length" class="model-list-container">
							<div
								v-for="model in filterModels(provider)"
								:key="model"
								class="model-item"
								:class="{
									'is-default': isDefaultModel(provider.id, model),
									'is-vision': isVisionModel(provider.id, model),
								}"
							>
								<div class="flex items-center gap-2 flex-1 min-w-0">
									<span class="text-sm truncate" :title="model">{{ model }}</span>
									<span v-if="isDefaultModel(provider.id, model)" class="badge badge-primary"
										>默认</span
									>
									<span v-if="modelVisionSupport[`${provider.id}/${model}`]" class="badge badge-green"
										>图像</span
									>
								</div>
								<div class="model-actions">
									<!-- 测试连接 -->
									<button
										@click="testModel(provider.id, model)"
										:disabled="loadingStates[`test-${provider.id}/${model}`]"
										class="btn-text"
										:class="{ loading: loadingStates[`test-${provider.id}/${model}`] }"
									>
										{{ loadingStates[`test-${provider.id}/${model}`] ? '测试中' : '测试' }}
									</button>
									<!-- 测试 Vision -->
									<button
										@click="testVision(provider.id, model)"
										:disabled="loadingStates[`vision-${provider.id}/${model}`]"
										class="btn-text"
										:class="{ loading: loadingStates[`vision-${provider.id}/${model}`] }"
									>
										{{ loadingStates[`vision-${provider.id}/${model}`] ? '检测中' : '检测图像' }}
									</button>
									<!-- 设为默认模型 -->
									<button
										v-if="!isDefaultModel(provider.id, model)"
										@click="setDefaultModel(provider.id, model)"
										class="btn-text btn-blue"
									>
										设为默认
									</button>
									<!-- 删除模型 -->
									<button @click="removeModel(provider.id, model)" class="btn-text btn-red">
										删除
									</button>
								</div>
							</div>
							<!-- 搜索无结果 -->
							<div
								v-if="filterModels(provider).length === 0"
								class="text-sm text-zinc-500 py-4 text-center"
							>
								没有匹配 "{{ modelSearchQuery[provider.id] }}" 的模型
							</div>
						</div>
						<div v-else class="text-sm text-zinc-500 py-4 text-center">
							暂无模型，点击"获取模型列表"或手动添加
						</div>
					</div>
				</div>

				<div v-if="store.providers.length === 0" class="text-zinc-500 text-sm text-center py-8">
					还没有配置 AI Provider，请在下方添加
				</div>
			</div>

			<!-- 添加/编辑 Provider 表单 -->
			<div class="border-t border-zinc-700 pt-4">
				<h4 class="text-sm font-medium mb-3">
					{{ editingProvider ? '编辑 Provider' : '添加 Provider' }}
				</h4>
				<form @submit.prevent="saveProvider" class="space-y-3">
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label class="block text-xs text-zinc-400 mb-1">ID</label>
							<input
								v-model="providerForm.id"
								placeholder="如: openai"
								class="input"
								:disabled="!!editingProvider"
							/>
						</div>
						<div>
							<label class="block text-xs text-zinc-400 mb-1">类型</label>
							<select v-model="providerForm.type" class="input">
								<option value="openai">OpenAI 兼容</option>
								<option value="anthropic">Anthropic</option>
							</select>
						</div>
					</div>
					<div>
						<label class="block text-xs text-zinc-400 mb-1">名称</label>
						<input v-model="providerForm.name" placeholder="显示名称（可选）" class="input" />
					</div>
					<div>
						<label class="block text-xs text-zinc-400 mb-1">API 地址</label>
						<input v-model="providerForm.baseUrl" placeholder="https://api.openai.com/v1" class="input" />
					</div>
					<div>
						<label class="block text-xs text-zinc-400 mb-1">API Key</label>
						<input
							v-model="providerForm.apiKey"
							type="password"
							:placeholder="editingProvider ? '留空则不修改' : 'sk-...'"
							class="input"
						/>
					</div>
					<div class="flex gap-2 justify-end">
						<button v-if="editingProvider" type="button" @click="cancelEdit" class="btn btn-secondary">
							取消
						</button>
						<button
							type="submit"
							:disabled="loadingStates['save-provider']"
							class="btn btn-primary btn-loading"
							:class="{ loading: loadingStates['save-provider'] }"
						>
							<span v-if="loadingStates['save-provider']" class="spinner"></span>
							{{ editingProvider ? '保存修改' : '添加' }}
						</button>
					</div>
				</form>
			</div>
		</section>

		<!-- 当前默认模型 -->
		<section class="card mb-6">
			<h3 class="text-lg font-medium mb-4 flex items-center gap-2">
				<span>🎯</span>
				默认模型
			</h3>
			<div class="flex items-center justify-between p-4 bg-zinc-700/30 rounded-lg">
				<div>
					<div class="font-medium">{{ defaultModel || '未设置' }}</div>
					<div v-if="defaultModel" class="text-sm text-zinc-400 mt-1">
						{{ modelVisionSupport[defaultModel] ? '🟢 支持图像理解' : '🔴 不支持图像理解' }}
					</div>
				</div>
				<div v-if="defaultModel" class="text-sm text-zinc-500">点击模型列表中的"设为默认"切换</div>
			</div>
		</section>

		<!-- 服务器设置 -->
		<section class="card mb-6">
			<h3 class="text-lg font-medium mb-4 flex items-center gap-2">
				<span>🖥️</span>
				服务器
			</h3>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="block text-sm text-zinc-400 mb-1">地址</label>
					<input v-model="config.server.host" class="input" disabled />
				</div>
				<div>
					<label class="block text-sm text-zinc-400 mb-1">端口</label>
					<input v-model="config.server.port" class="input" disabled />
				</div>
			</div>
		</section>

		<!-- 沙盒设置 -->
		<section class="card">
			<h3 class="text-lg font-medium mb-4 flex items-center gap-2">
				<span>🔒</span>
				安全沙盒
			</h3>

			<div class="sandbox-setting">
				<div class="sandbox-header">
					<div>
						<div class="font-medium">沙盒模式</div>
						<div class="text-sm text-muted">控制 AI 执行危险操作的权限</div>
					</div>
					<select v-model="sandboxMode" class="input w-40" @change="saveSandboxMode">
						<option value="off">关闭</option>
						<option value="permissive">宽松</option>
						<option value="strict">严格</option>
					</select>
				</div>

				<!-- 沙盒模式详细说明 -->
				<div class="sandbox-explanation">
					<div class="sandbox-mode-info" :class="{ active: sandboxMode === 'off' }">
						<div class="mode-badge danger">关闭</div>
						<div class="mode-desc">
							<strong>完全信任模式</strong> - AI 可以执行任何操作，包括：
							<ul>
								<li>删除文件和文件夹</li>
								<li>修改系统设置</li>
								<li>执行任意命令</li>
								<li>访问敏感数据</li>
							</ul>
							<span class="mode-warning">⚠️ 仅在完全信任 AI 时使用</span>
						</div>
					</div>

					<div class="sandbox-mode-info" :class="{ active: sandboxMode === 'permissive' }">
						<div class="mode-badge warning">宽松</div>
						<div class="mode-desc">
							<strong>平衡模式（推荐）</strong> - AI 会在执行以下操作前请求确认：
							<ul>
								<li>删除重要文件</li>
								<li>执行系统级命令 (如 sudo、rm -rf)</li>
								<li>修改配置文件</li>
								<li>发送敏感信息</li>
							</ul>
							<span class="mode-tip">💡 适合日常使用，兼顾效率和安全</span>
						</div>
					</div>

					<div class="sandbox-mode-info" :class="{ active: sandboxMode === 'strict' }">
						<div class="mode-badge success">严格</div>
						<div class="mode-desc">
							<strong>最高安全模式</strong> - AI 的所有写入操作都需要确认：
							<ul>
								<li>创建、修改、删除任何文件</li>
								<li>执行任何命令</li>
								<li>发送网络请求</li>
								<li>鼠标键盘操作</li>
							</ul>
							<span class="mode-tip">🔒 每一步操作都需要你的批准</span>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- 个人设置 -->
		<section class="card mb-6">
			<h3 class="text-lg font-medium mb-4 flex items-center gap-2">
				<span>👤</span>
				个人设置
			</h3>
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="block text-sm text-muted mb-1">昵称</label>
						<input
							v-model="userSettings.name"
							placeholder="AI 会用这个名字称呼你"
							class="input"
							@blur="saveUserSettings"
						/>
					</div>
					<div>
						<label class="block text-sm text-muted mb-1">位置</label>
						<input
							v-model="userSettings.location"
							placeholder="城市，如：上海"
							class="input"
							@blur="saveUserSettings"
						/>
					</div>
				</div>
				<div>
					<label class="block text-sm text-muted mb-1">偏好语言</label>
					<select v-model="userSettings.language" class="input" @change="saveUserSettings">
						<option value="">自动</option>
						<option value="中文">中文</option>
						<option value="English">English</option>
						<option value="日本語">日本語</option>
					</select>
				</div>
				<div>
					<label class="block text-sm text-muted mb-1">自定义 Prompt</label>
					<textarea
						v-model="userSettings.customPrompt"
						placeholder="添加自定义指令，AI 会在每次对话时遵循（如：回复时更简洁、使用特定格式等）"
						class="input h-24 resize-none"
						@blur="saveUserSettings"
					></textarea>
					<div class="text-xs text-muted mt-1">这些指令会添加到 AI 的系统提示中</div>
				</div>
			</div>
		</section>

		<!-- 记忆管理 -->
		<section class="card">
			<h3 class="text-lg font-medium mb-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<span>🧠</span>
					AI 记忆
				</div>
				<button @click="showAddMemory = true" class="btn btn-secondary text-sm">+ 添加记忆</button>
			</h3>
			<p class="text-sm text-muted mb-4">
				AI 会记住这些信息，在对话中使用。你也可以在聊天中告诉 AI"记住这个"来添加新记忆。
			</p>

			<!-- 记忆列表 -->
			<div v-if="memories.length" class="space-y-2">
				<div v-for="memory in memories" :key="memory.id" class="memory-item">
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-1">
							<span class="memory-category" :class="memory.category">
								{{ categoryLabels[memory.category] || memory.category }}
							</span>
							<span class="text-xs text-muted">{{ formatDate(memory.createdAt) }}</span>
						</div>
						<div v-if="editingMemory === memory.id" class="flex gap-2">
							<input
								v-model="editMemoryContent"
								class="input flex-1 text-sm"
								@keyup.enter="saveMemoryEdit(memory.id)"
							/>
							<button @click="saveMemoryEdit(memory.id)" class="btn btn-primary text-sm">保存</button>
							<button @click="editingMemory = null" class="btn btn-secondary text-sm">取消</button>
						</div>
						<div v-else class="text-sm">{{ memory.content }}</div>
					</div>
					<div v-if="editingMemory !== memory.id" class="flex items-center gap-1 ml-2">
						<button @click="startEditMemory(memory)" class="btn-icon" title="编辑">✏️</button>
						<button @click="deleteMemory(memory.id)" class="btn-icon text-red-400" title="删除">🗑️</button>
					</div>
				</div>
			</div>
			<div v-else class="text-center text-muted py-8">
				还没有记忆。在聊天中告诉 AI"记住这个"，或点击上方按钮手动添加。
			</div>

			<!-- 添加记忆弹窗 -->
			<div v-if="showAddMemory" class="modal-overlay" @click.self="showAddMemory = false">
				<div class="modal-content">
					<h4 class="text-lg font-medium mb-4">添加记忆</h4>
					<div class="space-y-3">
						<div>
							<label class="block text-sm text-muted mb-1">类型</label>
							<select v-model="newMemory.category" class="input">
								<option value="preference">偏好</option>
								<option value="habit">习惯</option>
								<option value="fact">事实</option>
								<option value="instruction">指令</option>
								<option value="other">其他</option>
							</select>
						</div>
						<div>
							<label class="block text-sm text-muted mb-1">内容</label>
							<textarea
								v-model="newMemory.content"
								placeholder="如：喜欢用英文交流、是一名程序员、每天早上9点提醒我开会..."
								class="input h-24 resize-none"
							></textarea>
						</div>
					</div>
					<div class="flex justify-end gap-2 mt-4">
						<button @click="showAddMemory = false" class="btn btn-secondary">取消</button>
						<button @click="addMemory" class="btn btn-primary" :disabled="!newMemory.content.trim()">
							添加
						</button>
					</div>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';

const store = useAppStore();

// 表单状态
const providerForm = reactive({
	id: '',
	name: '',
	type: 'openai',
	baseUrl: '',
	apiKey: '',
});
const editingProvider = ref(null);
const modelSearchQuery = reactive({}); // 用于搜索和添加模型

// 加载状态（统一管理）
const loadingStates = reactive({});

// 模型 Vision 支持状态
const modelVisionSupport = reactive({});

// 配置
const defaultModel = ref('');
const sandboxMode = ref('permissive');
const config = reactive({
	server: { host: '127.0.0.1', port: 18800 },
});

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
			// 编辑
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
			// 添加
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
		// 添加 refresh=true 强制从 API 获取
		const result = await api.get(`/api/providers/${provider.id}/models?refresh=true`);
		if (result.models?.length) {
			// 合并现有模型和新获取的模型
			const existingModels = provider.models || [];
			const newModels = [...new Set([...existingModels, ...result.models])];
			await api.put(`/api/providers/${provider.id}/models`, { models: newModels });
			await store.loadProviders();
		} else {
			alert('未获取到模型列表，请手动添加');
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
	} else {
		alert('模型已存在');
	}
};

// 过滤模型列表（搜索功能）
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
		alert(result.success ? `✅ 模型 ${model} 连接成功！` : `❌ 连接失败: ${result.message}`);
	} catch (error) {
		alert('❌ 测试失败: ' + error.message);
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
			// 保存到配置（模型级别）
			await api.patch(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, {
				supportsVision: true,
			});
			await store.loadProviders();
			alert(`✅ 模型 ${model} 支持图像理解！已保存。`);
		} else {
			modelVisionSupport[modelKey] = false;
			// 保存不支持状态
			await api.patch(`/api/providers/${providerId}/models/${encodeURIComponent(model)}`, {
				supportsVision: false,
			});
			await store.loadProviders();
			alert(`❌ 模型 ${model} 不支持图像理解\n\n${result.message}`);
		}
	} catch (error) {
		alert('❌ 测试失败: ' + error.message);
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

const isVisionModel = (providerId, model) => {
	return !!modelVisionSupport[`${providerId}/${model}`];
};

// ========== 其他设置 ==========

const saveSandboxMode = async () => {
	try {
		await api.put('/api/config', { 'sandbox.mode': sandboxMode.value });
	} catch (error) {
		console.error('Save failed:', error);
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
	if (!confirm('确定删除这条记忆？')) return;
	try {
		await api.del(`/api/memories/${id}`);
		await loadMemories();
	} catch (error) {
		alert('删除失败: ' + error.message);
	}
};

const formatDate = (dateStr) => {
	const date = new Date(dateStr);
	return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

// ========== 初始化 ==========

onMounted(async () => {
	await store.loadProviders();
	await store.loadConfig();
	await loadUserSettings();
	await loadMemories();

	defaultModel.value = store.config.agent?.defaultModel || '';
	sandboxMode.value = store.config.sandbox?.mode || 'permissive';
	Object.assign(config.server, store.config.server || {});

	// 加载已保存的 Vision 支持状态（从 visionModels）
	for (const provider of store.providers) {
		const visionModels = provider.visionModels || [];
		for (const model of visionModels) {
			modelVisionSupport[`${provider.id}/${model}`] = true;
		}
	}
});
</script>

<style scoped>
.settings-container {
	@apply flex-1 overflow-y-auto p-6;
	background-color: var(--bg-primary);
}

.settings-title {
	@apply text-2xl font-bold mb-6;
	color: var(--text-primary);
}

.text-muted {
	color: var(--text-muted);
}

.provider-card {
	@apply p-4 rounded-lg;
	background-color: var(--bg-tertiary);
}

/* 模型列表容器（限高+滚动） */
.model-list-container {
	@apply max-h-80 overflow-y-auto space-y-1 pr-1;
	scrollbar-width: thin;
	scrollbar-color: #52525b transparent;
}

.model-list-container::-webkit-scrollbar {
	width: 6px;
}

.model-list-container::-webkit-scrollbar-track {
	background: transparent;
}

.model-list-container::-webkit-scrollbar-thumb {
	background-color: #52525b;
	border-radius: 3px;
}

.model-item {
	@apply flex items-center justify-between p-2 px-3 bg-zinc-600/30 rounded-lg gap-2;
}

.model-item:hover {
	@apply bg-zinc-600/50;
}

.model-item.is-default {
	@apply bg-blue-900/30 border border-blue-500/30;
}

/* 模型操作按钮组 */
.model-actions {
	@apply flex items-center gap-1 flex-shrink-0;
}

.badge {
	@apply text-xs px-1.5 py-0.5 rounded flex-shrink-0;
}

.badge-primary {
	@apply bg-blue-500/30 text-blue-300;
}

.badge-green {
	@apply bg-green-500/30 text-green-300;
}

/* 文字按钮 */
.btn-text {
	@apply text-xs px-2 py-1 rounded hover:bg-zinc-600 transition-colors text-zinc-400 hover:text-zinc-200 whitespace-nowrap;
}

.btn-text.loading {
	@apply pointer-events-none opacity-70;
}

.btn-text.btn-blue {
	color: #60a5fa;
}
.btn-text.btn-blue:hover {
	color: #93c5fd;
}

.btn-text.btn-red {
	color: #f87171;
}
.btn-text.btn-red:hover {
	color: #fca5a5;
}

/* 按钮加载状态 */
.btn-loading {
	@apply relative;
}

.btn-loading.loading {
	@apply pointer-events-none opacity-70;
}

.spinner {
	@apply inline-block w-3 h-3 mr-1 border-2 border-white/30 border-t-white rounded-full animate-spin;
}

/* 沙盒设置样式 */
.sandbox-setting {
	@apply space-y-4;
}

.sandbox-header {
	@apply flex items-center justify-between;
}

.sandbox-explanation {
	@apply space-y-3 pt-4;
	border-top: 1px solid var(--border-color);
}

.sandbox-mode-info {
	@apply p-4 rounded-lg transition-all;
	background-color: var(--bg-tertiary);
	border: 1px solid transparent;
	opacity: 0.6;
}

.sandbox-mode-info.active {
	opacity: 1;
	border-color: var(--accent);
	background-color: var(--accent-subtle);
}

.mode-badge {
	@apply inline-block px-2 py-0.5 rounded text-xs font-medium mb-2;
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

.mode-desc {
	@apply text-sm;
	color: var(--text-secondary);
}

.mode-desc strong {
	color: var(--text-primary);
}

.mode-desc ul {
	@apply mt-2 ml-4 space-y-1;
	list-style-type: disc;
}

.mode-desc li {
	color: var(--text-muted);
}

.mode-warning {
	@apply block mt-2 text-xs;
	color: var(--error);
}

.mode-tip {
	@apply block mt-2 text-xs;
	color: var(--text-muted);
}

/* 记忆管理样式 */
.memory-item {
	@apply flex items-start p-3 rounded-lg;
	background-color: var(--bg-tertiary);
}

.memory-category {
	@apply text-xs px-2 py-0.5 rounded;
	background-color: var(--bg-secondary);
	color: var(--text-muted);
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

.btn-icon {
	@apply p-1 rounded hover:bg-white/10 transition-colors;
	font-size: 14px;
}

/* 弹窗样式 */
.modal-overlay {
	@apply fixed inset-0 z-50 flex items-center justify-center;
	background-color: rgba(0, 0, 0, 0.6);
}

.modal-content {
	@apply p-6 rounded-xl shadow-xl w-full max-w-md mx-4;
	background-color: var(--bg-secondary);
}
</style>
