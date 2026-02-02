<template>
	<div class="page-container">
		<header class="page-header">
			<div class="header-left">
				<h1 class="page-title">🎯 Agent 管理</h1>
				<p class="page-desc">配置多个 Agent，每个 Agent 有独立的模型、提示词和工具设置</p>
			</div>
			<div class="header-actions">
				<button class="btn-sm" @click="importAgentFile">
					<span>📥</span> 导入
				</button>
				<button class="btn-sm btn-primary" @click="openAgentEditor(null)">
					<span>➕</span> 新建 Agent
				</button>
			</div>
		</header>

		<main class="page-content">
			<!-- 当前选中的 Agent -->
			<section class="current-agent-section" v-if="currentAgent">
				<h3 class="section-label">当前使用</h3>
				<div class="current-agent-card">
					<div class="agent-icon large">{{ currentAgent.icon || '🤖' }}</div>
					<div class="agent-info">
						<div class="agent-name">{{ currentAgent.name }}</div>
						<div class="agent-desc">{{ currentAgent.description || '无描述' }}</div>
						<div class="agent-meta">
							<span v-if="currentAgent.model">{{ currentAgent.model }}</span>
							<span>最大迭代 {{ currentAgent.maxIterations || 30 }}</span>
							<span>超时 {{ Math.round((currentAgent.timeout || 300000) / 1000) }}s</span>
						</div>
					</div>
					<button class="btn-sm" @click="openAgentEditor(currentAgent)">编辑</button>
				</div>
			</section>

			<!-- Agent 列表 -->
			<section class="agent-list-section">
				<h3 class="section-label">所有 Agent ({{ store.agents.length }})</h3>
				<div class="agent-grid">
					<div
						v-for="agent in store.agents"
						:key="agent.id"
						class="agent-card"
						:class="{ active: store.currentAgentId === agent.id }"
						@click="selectAgent(agent.id)"
					>
						<div class="agent-card-header">
							<div class="agent-icon">{{ agent.icon || '🤖' }}</div>
							<div class="agent-badges">
								<span v-if="agent.isBuiltin" class="badge builtin">内置</span>
								<span v-if="store.currentAgentId === agent.id" class="badge current">当前</span>
							</div>
						</div>
						<div class="agent-card-body">
							<div class="agent-name">{{ agent.name }}</div>
							<div class="agent-desc">{{ agent.description || '无描述' }}</div>
						</div>
						<div class="agent-card-footer">
							<div class="agent-meta">
								<span>迭代 {{ agent.maxIterations || 30 }}</span>
							</div>
							<div class="agent-actions" @click.stop>
								<button class="btn-icon" @click="openAgentEditor(agent)" title="编辑">✏️</button>
								<button class="btn-icon" @click="duplicateAgent(agent.id)" title="复制">📋</button>
								<button class="btn-icon" @click="exportAgent(agent.id)" title="导出">📤</button>
								<button
									v-if="!agent.isBuiltin"
									class="btn-icon danger"
									@click="deleteAgent(agent.id)"
									title="删除"
								>🗑️</button>
							</div>
						</div>
					</div>

					<!-- 新建卡片 -->
					<div class="agent-card add-card" @click="openAgentEditor(null)">
						<div class="add-icon">➕</div>
						<div class="add-text">新建 Agent</div>
					</div>
				</div>
			</section>

			<!-- 全局设置 -->
			<section class="global-settings-section">
				<h3 class="section-label">全局设置</h3>
				<div class="settings-row">
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
				</div>
			</section>
		</main>

		<!-- Agent 编辑器弹窗 -->
		<AgentEditor
			v-if="showAgentEditor"
			:agent="editingAgent"
			@close="showAgentEditor = false"
			@saved="onAgentSaved"
		/>

		<!-- 隐藏的文件输入 -->
		<input
			ref="importFileInput"
			type="file"
			accept=".json,.nutbot-agent.json"
			style="display: none"
			@change="handleImportFile"
		/>
	</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';
import AgentEditor from '../components/AgentEditor.vue';

const store = useAppStore();

// 状态
const showAgentEditor = ref(false);
const editingAgent = ref(null);
const importFileInput = ref(null);
const debugMode = ref(false);

// 当前 Agent
const currentAgent = computed(() => {
	return store.agents.find(a => a.id === store.currentAgentId);
});

// 初始化
onMounted(async () => {
	await store.loadAgents();
	await loadDebugMode();
});

// 加载调试模式
const loadDebugMode = async () => {
	try {
		const data = await api.get('/api/agent');
		debugMode.value = data.debugMode || false;
	} catch (e) {
		console.error('Load debug mode failed:', e);
	}
};

// 保存调试模式
const saveDebugMode = async () => {
	try {
		await api.put('/api/agent', { debugMode: debugMode.value });
	} catch (e) {
		console.error('Save debug mode failed:', e);
	}
};

// Agent 操作
const openAgentEditor = (agent) => {
	editingAgent.value = agent;
	showAgentEditor.value = true;
};

const onAgentSaved = async () => {
	await store.loadAgents();
};

const selectAgent = async (id) => {
	try {
		await store.setCurrentAgent(id);
	} catch (error) {
		toast.error('切换失败: ' + error.message);
	}
};

const duplicateAgent = async (id) => {
	try {
		await store.duplicateAgent(id);
		toast.success('Agent 已复制');
	} catch (error) {
		toast.error('复制失败: ' + error.message);
	}
};

const deleteAgent = async (id) => {
	if (!confirm('确定删除这个 Agent？')) return;
	try {
		await store.deleteAgent(id);
		toast.success('Agent 已删除');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

const exportAgent = async (id) => {
	try {
		const data = await store.exportAgent(id);
		const agent = store.getAgent(id);
		const filename = `${agent?.name || 'agent'}.nutbot-agent.json`;
		
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		toast.success('导出成功');
	} catch (error) {
		toast.error('导出失败: ' + error.message);
	}
};

const importAgentFile = () => {
	importFileInput.value?.click();
};

const handleImportFile = async (event) => {
	const file = event.target.files?.[0];
	if (!file) return;

	try {
		const text = await file.text();
		const data = JSON.parse(text);
		await store.importAgent(data);
		toast.success('导入成功！');
	} catch (error) {
		toast.error('导入失败: ' + error.message);
	}

	event.target.value = '';
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

.header-actions {
	display: flex;
	gap: 8px;
}

.page-content {
	flex: 1;
	overflow-y: auto;
	padding: 24px 32px;
}

.section-label {
	font-size: 12px;
	font-weight: 600;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	margin-bottom: 12px;
}

/* 当前 Agent */
.current-agent-section {
	margin-bottom: 32px;
}

.current-agent-card {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 20px;
	background: linear-gradient(135deg, var(--accent-subtle), transparent);
	border: 1px solid var(--accent);
	border-radius: 12px;
}

.agent-icon {
	width: 48px;
	height: 48px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 24px;
	background-color: var(--bg-secondary);
	border-radius: 12px;
}

.agent-icon.large {
	width: 56px;
	height: 56px;
	font-size: 28px;
}

.agent-info {
	flex: 1;
}

.agent-name {
	font-size: 15px;
	font-weight: 600;
	color: var(--text-primary);
}

.agent-desc {
	font-size: 13px;
	color: var(--text-muted);
	margin-top: 2px;
}

.agent-meta {
	display: flex;
	gap: 12px;
	margin-top: 8px;
	font-size: 11px;
	color: var(--text-muted);
}

.agent-meta span {
	padding: 2px 8px;
	background-color: var(--bg-tertiary);
	border-radius: 4px;
}

/* Agent 网格 */
.agent-list-section {
	margin-bottom: 32px;
}

.agent-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 16px;
}

.agent-card {
	display: flex;
	flex-direction: column;
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 12px;
	cursor: pointer;
	transition: all 0.15s;
}

.agent-card:hover {
	border-color: var(--accent);
	transform: translateY(-2px);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.agent-card.active {
	border-color: var(--accent);
	background: linear-gradient(135deg, var(--accent-subtle), transparent);
}

.agent-card-header {
	display: flex;
	justify-content: space-between;
	margin-bottom: 12px;
}

.agent-badges {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
}

.badge {
	font-size: 10px;
	padding: 2px 8px;
	border-radius: 4px;
	font-weight: 500;
	white-space: nowrap;
}

.badge.builtin {
	background-color: rgba(156, 163, 175, 0.2);
	color: var(--text-muted);
}

.badge.current {
	background-color: rgba(16, 185, 129, 0.2);
	color: #10b981;
}

.agent-card-body {
	flex: 1;
	margin-bottom: 12px;
}

.agent-card-body .agent-desc {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.agent-card-footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.agent-actions {
	display: flex;
	gap: 4px;
	opacity: 0;
	transition: opacity 0.15s;
}

.agent-card:hover .agent-actions {
	opacity: 1;
}

/* 新建卡片 */
.add-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 160px;
	border-style: dashed;
	background: none;
}

.add-card:hover {
	background-color: var(--bg-secondary);
}

.add-icon {
	font-size: 32px;
	margin-bottom: 8px;
}

.add-text {
	font-size: 13px;
	color: var(--text-muted);
}

/* 全局设置 */
.global-settings-section {
	padding-top: 24px;
	border-top: 1px solid var(--border-color);
}

.settings-row {
	display: flex;
	gap: 16px;
}

.setting-item {
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	min-width: 300px;
}

.setting-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.setting-label {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
}

.setting-desc {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 8px;
}

/* 按钮 */
.btn-sm {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 8px 14px;
	font-size: 13px;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	color: var(--text-primary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-sm:hover {
	background-color: var(--bg-hover);
	border-color: var(--text-muted);
}

.btn-sm.btn-primary {
	background-color: var(--accent);
	border-color: var(--accent);
	color: white;
}

.btn-sm.btn-primary:hover {
	background-color: var(--accent-hover);
}

.btn-icon {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 14px;
	background: none;
	border: none;
	border-radius: 6px;
	cursor: pointer;
	transition: background 0.15s;
}

.btn-icon:hover {
	background-color: var(--bg-hover);
}

.btn-icon.danger:hover {
	background-color: rgba(239, 68, 68, 0.1);
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

/* 响应式 */
@media (max-width: 768px) {
	.page-header {
		flex-direction: column;
		gap: 16px;
		padding: 16px;
	}

	.header-actions {
		width: 100%;
	}

	.header-actions .btn-sm {
		flex: 1;
		justify-content: center;
	}

	.page-content {
		padding: 16px;
	}

	.agent-grid {
		grid-template-columns: 1fr;
	}

	.current-agent-card {
		flex-direction: column;
		text-align: center;
	}
}
</style>
