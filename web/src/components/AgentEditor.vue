<template>
	<div class="modal-overlay" @click.self="$emit('close')">
		<div class="agent-editor">
			<div class="editor-header">
				<h3>{{ isNew ? '新建 Agent' : '编辑 Agent' }}</h3>
				<button class="btn-close" @click="$emit('close')">×</button>
			</div>

			<div class="editor-body">
				<!-- 左侧：配置 -->
				<div class="editor-left">
					<!-- 基本信息 -->
					<section class="config-section">
						<h4>基本信息</h4>
						<div class="form-row">
							<div class="form-group icon-picker">
								<label>图标</label>
								<button class="icon-btn" @click="showIconPicker = !showIconPicker">
									{{ form.icon || '🤖' }}
								</button>
								<div v-if="showIconPicker" class="icon-dropdown">
									<button
										v-for="icon in availableIcons"
										:key="icon"
										class="icon-option"
										@click="form.icon = icon; showIconPicker = false"
									>
										{{ icon }}
									</button>
								</div>
							</div>
							<div class="form-group flex-1">
								<label>名称 <span class="required">*</span></label>
								<input v-model="form.name" placeholder="如：代码助手" class="input-sm" />
							</div>
						</div>
						<div class="form-group">
							<label>描述</label>
							<input v-model="form.description" placeholder="Agent 的用途说明" class="input-sm" />
						</div>
					</section>

					<!-- 模型配置 -->
					<section class="config-section">
						<h4>模型配置</h4>
						<div class="form-group">
							<label>模型 <span v-if="enabledModels.length === 0" class="hint">(请先在 Provider 页面启用模型)</span></label>
							<select v-model="form.model" class="input-sm">
								<option v-if="enabledModels.length === 0" value="" disabled>暂无可用模型</option>
								<option v-for="model in enabledModels" :key="model" :value="model">
									{{ model }}{{ model === defaultModel ? ' (默认)' : '' }}
								</option>
							</select>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label>Temperature</label>
								<input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" placeholder="默认" class="input-sm" />
							</div>
							<div class="form-group">
								<label>Max Tokens</label>
								<input v-model.number="form.maxTokens" type="number" min="100" placeholder="默认" class="input-sm" />
							</div>
						</div>
					</section>

					<!-- 行为配置 -->
					<section class="config-section">
						<h4>行为配置</h4>
						<div class="form-row">
							<div class="form-group">
								<label>最大迭代</label>
								<input v-model.number="form.maxIterations" type="number" min="1" max="100" class="input-sm" />
							</div>
							<div class="form-group">
								<label>超时 (ms)</label>
								<input v-model.number="form.timeout" type="number" min="60000" step="60000" class="input-sm" />
							</div>
						</div>
					</section>

					<!-- 系统提示词 -->
					<section class="config-section prompt-section">
						<h4>
							系统提示词
							<span class="hint">(可选，留空使用内置)</span>
						</h4>
						<textarea
							ref="promptTextarea"
							v-model="form.systemPrompt"
							placeholder="自定义系统提示词...&#10;&#10;可点击右侧工具快速插入"
							class="prompt-input"
						></textarea>
					</section>
				</div>

				<!-- 右侧：工具面板 -->
				<div class="editor-right">
					<section class="config-section tools-section">
						<h4>添加工具 <span class="hint">(点击插入到提示词)</span></h4>
						<input
							v-model="toolSearch"
							type="text"
							placeholder="搜索工具..."
							class="input-sm tool-search"
						/>
						
						<div class="tools-list">
							<!-- 内置工具组 -->
							<div v-if="filteredBuiltinTools.length" class="tool-group">
								<div class="tool-group-header" @click="toggleGroup('builtin')">
									<span class="tool-group-title">内置工具</span>
									<span class="tool-group-badge builtin">{{ filteredBuiltinTools.length }}</span>
									<span class="tool-group-arrow">{{ expandedGroup === 'builtin' ? '▾' : '▸' }}</span>
								</div>
								<div v-if="expandedGroup === 'builtin'" class="tool-group-items">
									<div
										v-for="tool in filteredBuiltinTools"
										:key="tool.name"
										class="tool-item"
										@click="insertToolName(tool)"
									>
										<div class="tool-name" v-html="highlightText(tool.name)"></div>
										<div class="tool-desc" v-html="highlightText(truncate(tool.description, 60))"></div>
									</div>
								</div>
							</div>

							<!-- MCP 工具组 -->
							<div v-if="filteredMcpTools.length" class="tool-group">
								<div class="tool-group-header" @click="toggleGroup('mcp')">
									<span class="tool-group-title">MCP 工具</span>
									<span class="tool-group-badge mcp">{{ filteredMcpTools.length }}</span>
									<span class="tool-group-arrow">{{ expandedGroup === 'mcp' ? '▾' : '▸' }}</span>
								</div>
								<div v-if="expandedGroup === 'mcp'" class="tool-group-items">
									<div
										v-for="tool in filteredMcpTools"
										:key="tool.name"
										class="tool-item"
										@click="insertToolName(tool)"
									>
										<div class="tool-name" v-html="highlightText(tool.name)"></div>
										<div class="tool-desc" v-html="highlightText(truncate(tool.description, 60))"></div>
									</div>
								</div>
							</div>

							<div v-if="!filteredBuiltinTools.length && !filteredMcpTools.length" class="tools-empty">
								{{ toolSearch ? '未找到匹配的工具' : '加载中...' }}
							</div>
						</div>
					</section>
				</div>
			</div>

			<div class="editor-footer">
				<button class="btn-sm" @click="$emit('close')">取消</button>
				<button class="btn-sm btn-primary" @click="save" :disabled="!form.name || saving">
					{{ saving ? '保存中...' : '保存' }}
				</button>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { useAppStore } from '../stores/app';
import toast from '../utils/toast';

const props = defineProps({
	agent: {
		type: Object,
		default: null,
	},
});

const emit = defineEmits(['close', 'saved']);

const store = useAppStore();
const promptTextarea = ref(null);
const showIconPicker = ref(false);
const saving = ref(false);
const toolSearch = ref('');
const expandedGroup = ref('builtin');

const isNew = computed(() => !props.agent?.id);

const form = reactive({
	name: '',
	description: '',
	icon: '🤖',
	model: '',
	temperature: null,
	maxTokens: null,
	systemPrompt: '',
	maxIterations: 30,
	timeout: 300000,
});

// 可选图标
const availableIcons = [
	'🤖', '💻', '📝', '🔧', '🎯', '🚀', '💡', '🔍',
	'📊', '🎨', '🌐', '📱', '🛠️', '⚡', '🧠', '🎮',
	'📚', '✨', '🔒', '📈', '🎵', '🏠', '💼', '🎓',
];

// 启用的模型列表
const enabledModels = computed(() => {
	return store.config?.agent?.enabledModels || [];
});

// 默认模型
const defaultModel = computed(() => {
	return store.config?.agent?.defaultModel || '';
});

// 工具列表（分组）
const toolsGrouped = computed(() => store.toolsGrouped);

// 搜索过滤后的工具
const filteredBuiltinTools = computed(() => {
	const tools = toolsGrouped.value?.builtin || [];
	if (!toolSearch.value) return tools;
	const query = toolSearch.value.toLowerCase();
	return tools.filter(t => 
		t.name.toLowerCase().includes(query) || 
		(t.description || '').toLowerCase().includes(query)
	);
});

const filteredMcpTools = computed(() => {
	const tools = toolsGrouped.value?.mcp || [];
	if (!toolSearch.value) return tools;
	const query = toolSearch.value.toLowerCase();
	return tools.filter(t => 
		t.name.toLowerCase().includes(query) || 
		(t.description || '').toLowerCase().includes(query)
	);
});

// 切换工具组展开状态
const toggleGroup = (group) => {
	expandedGroup.value = expandedGroup.value === group ? null : group;
};

// 初始化表单
onMounted(async () => {
	if (props.agent) {
		// 编辑模式
		Object.assign(form, {
			name: props.agent.name || '',
			description: props.agent.description || '',
			icon: props.agent.icon || '🤖',
			model: props.agent.model || '',
			temperature: props.agent.temperature ?? null,
			maxTokens: props.agent.maxTokens ?? null,
			systemPrompt: props.agent.systemPrompt || '',
			maxIterations: props.agent.maxIterations ?? 30,
			timeout: props.agent.timeout ?? 300000,
		});
	} else {
		// 新建模式：使用默认模型
		form.model = defaultModel.value;
	}

	// 加载工具列表
	await store.loadTools(true);
});

// 截断文本
const truncate = (text, maxLength) => {
	if (!text) return '';
	return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
};

// 高亮搜索关键字
const highlightText = (text) => {
	if (!text || !toolSearch.value) return text;
	const query = toolSearch.value.trim();
	if (!query) return text;
	
	// 转义正则特殊字符
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escaped})`, 'gi');
	return text.replace(regex, '<mark class="highlight">$1</mark>');
};

// 插入工具名称到提示词
const insertToolName = (tool) => {
	const text = tool.name;
	insertTextAtCursor(text);
};

// 插入完整工具描述到提示词
const insertToolFull = (tool) => {
	const text = `- ${tool.name}: ${tool.description}\n`;
	insertTextAtCursor(text);
};

// 在光标位置插入文本
const insertTextAtCursor = (text) => {
	if (promptTextarea.value) {
		const textarea = promptTextarea.value;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const before = form.systemPrompt.slice(0, start);
		const after = form.systemPrompt.slice(end);
		
		form.systemPrompt = before + text + after;
		
		// 移动光标
		nextTick(() => {
			textarea.selectionStart = textarea.selectionEnd = start + text.length;
			textarea.focus();
		});
	} else {
		form.systemPrompt += text;
	}
};

// 保存
const save = async () => {
	if (!form.name) return;

	saving.value = true;
	try {
		const data = {
			name: form.name,
			description: form.description || undefined,
			icon: form.icon || '🤖',
			model: form.model || undefined,
			temperature: form.temperature ?? undefined,
			maxTokens: form.maxTokens ?? undefined,
			systemPrompt: form.systemPrompt || undefined,
			maxIterations: form.maxIterations,
			timeout: form.timeout,
		};

		let result;
		if (isNew.value) {
			result = await store.createAgent(data);
		} else {
			result = await store.updateAgent(props.agent.id, data);
		}

		emit('saved', result);
		emit('close');
	} catch (error) {
		toast.error('保存失败: ' + error.message);
	} finally {
		saving.value = false;
	}
};
</script>

<style scoped>
.modal-overlay {
	position: fixed;
	inset: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.6);
}

.agent-editor {
	width: 90%;
	max-width: 1000px;
	max-height: 90vh;
	display: flex;
	flex-direction: column;
	background-color: var(--bg-secondary);
	border-radius: 12px;
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
	overflow: hidden;
}

.editor-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 20px;
	border-bottom: 1px solid var(--border-color);
}

.editor-header h3 {
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
	transition: all 0.15s;
}

.btn-close:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.editor-body {
	flex: 1;
	display: flex;
	overflow: hidden;
}

.editor-left {
	flex: 1;
	padding: 16px 20px;
	overflow-y: auto;
}

.editor-right {
	width: 280px;
	padding: 16px 20px;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	border-left: 1px solid var(--border-color);
}

.config-section {
	margin-bottom: 20px;
}

.config-section h4 {
	font-size: 13px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 12px;
}

.config-section h4 .hint {
	font-weight: 400;
	color: var(--text-muted);
	font-size: 11px;
	margin-left: 4px;
}

.form-row {
	display: flex;
	gap: 12px;
}

.form-group {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-bottom: 12px;
}

.form-group.flex-1 {
	flex: 1;
}

.form-group label {
	font-size: 12px;
	color: var(--text-secondary);
}

.form-group label .required {
	color: var(--error);
}

.input-sm {
	padding: 8px 10px;
	font-size: 13px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	outline: none;
}

.input-sm:focus {
	border-color: var(--accent);
}

.icon-picker {
	position: relative;
	width: 60px;
}

.icon-btn {
	width: 100%;
	height: 36px;
	font-size: 20px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	cursor: pointer;
	transition: all 0.15s;
}

.icon-btn:hover {
	border-color: var(--accent);
}

.icon-dropdown {
	position: absolute;
	top: 100%;
	left: 0;
	z-index: 10;
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 4px;
	padding: 8px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.icon-option {
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 16px;
	background: none;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	transition: background 0.15s;
}

.icon-option:hover {
	background-color: var(--bg-hover);
}

.prompt-section {
	flex: 1;
	display: flex;
	flex-direction: column;
}

.prompt-input {
	flex: 1;
	min-height: 150px;
	padding: 10px;
	font-size: 13px;
	font-family: ui-monospace, monospace;
	line-height: 1.5;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	resize: vertical;
	outline: none;
}

.prompt-input:focus {
	border-color: var(--accent);
}

/* 右侧工具面板 */
.tools-section {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.tools-section h4 {
	margin-bottom: 8px;
}

.tool-search {
	margin-bottom: 12px;
}

.tools-list {
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.tool-group {
	border: 1px solid var(--border-color);
	border-radius: 6px;
	overflow: hidden;
}

.tool-group-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	background-color: var(--bg-tertiary);
	cursor: pointer;
	transition: background 0.15s;
}

.tool-group-header:hover {
	background-color: var(--bg-hover);
}

.tool-group-title {
	font-size: 12px;
	font-weight: 500;
	color: var(--text-primary);
}

.tool-group-badge {
	font-size: 10px;
	padding: 1px 6px;
	border-radius: 10px;
	margin-left: auto;
}

.tool-group-badge.builtin {
	background-color: rgba(59, 130, 246, 0.15);
	color: #3b82f6;
}

.tool-group-badge.mcp {
	background-color: rgba(16, 185, 129, 0.15);
	color: #10b981;
}

.tool-group-arrow {
	font-size: 11px;
	color: var(--text-muted);
}

.tool-group-items {
	max-height: calc(100vh - 450px);
	min-height: 200px;
	overflow-y: auto;
}

.tool-item {
	padding: 8px 10px;
	cursor: pointer;
	border-bottom: 1px solid var(--border-color);
	transition: background 0.15s;
}

.tool-item:last-child {
	border-bottom: none;
}

.tool-item:hover {
	background-color: var(--accent-subtle);
}

.tool-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--accent);
	font-family: ui-monospace, monospace;
	margin-bottom: 2px;
}

.tool-desc {
	font-size: 11px;
	color: var(--text-muted);
	line-height: 1.4;
}

.tools-empty {
	padding: 16px;
	text-align: center;
	color: var(--text-muted);
	font-size: 12px;
}

/* 搜索高亮 */
:deep(.highlight) {
	background-color: rgba(245, 158, 11, 0.3);
	color: #fbbf24;
	padding: 0 2px;
	border-radius: 2px;
}

.editor-footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 12px 20px;
	border-top: 1px solid var(--border-color);
}

.btn-sm {
	padding: 8px 16px;
	font-size: 13px;
	background-color: var(--bg-input);
	border: 1px solid var(--border-color);
	border-radius: 6px;
	color: var(--text-primary);
	cursor: pointer;
	transition: all 0.15s;
}

.btn-sm:hover {
	background-color: var(--bg-hover);
}

.btn-sm:disabled {
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

/* 响应式 */
@media (max-width: 768px) {
	.agent-editor {
		width: 95%;
		max-height: 95vh;
	}

	.editor-body {
		flex-direction: column;
	}

	.editor-left {
		border-right: none;
		border-bottom: 1px solid var(--border-color);
	}

	.editor-right {
		width: 100%;
		max-height: 200px;
	}
}
</style>
