<template>
	<div class="page-container">
		<header class="page-header">
			<div class="header-left">
				<h1 class="page-title">🔌 MCP (Model Context Protocol)</h1>
				<p class="page-desc">配置 MCP 服务端后，其工具会以 mcp_&lt;服务名&gt;_&lt;工具名&gt; 形式供 Agent 调用</p>
			</div>
			<div class="header-actions">
				<label class="switch-label">
					<span>启用 MCP</span>
					<label class="switch">
						<input type="checkbox" v-model="mcpConfig.enabled" @change="saveMcpConfig" />
						<span class="slider"></span>
					</label>
				</label>
			</div>
		</header>

		<main class="page-content">
			<!-- MCP 服务端列表 -->
			<section class="servers-section">
				<div class="section-header">
					<h3 class="section-label">MCP 服务端 ({{ serverList.length }})</h3>
					<div class="header-btns">
						<button class="btn-sm" @click="showImportModal = true">
							<span>📋</span> 粘贴导入
						</button>
						<button class="btn-sm btn-primary" @click="addServer">
							<span>➕</span> 添加服务端
						</button>
					</div>
				</div>

				<div v-if="serverList.length === 0" class="empty-state">
					<div class="empty-icon">🔌</div>
					<p class="empty-text">还没有配置 MCP 服务端</p>
					<p class="empty-hint">点击上方按钮添加，或粘贴 JSON 配置快速导入</p>
				</div>

				<div v-else class="server-list">
					<div
						v-for="server in serverList"
						:key="server.name"
						class="server-card"
					>
						<div class="server-header">
							<div class="server-icon">{{ server.url ? '🌐' : '💻' }}</div>
							<div class="server-info">
								<div class="server-name">{{ server.name }}</div>
								<div class="server-type">{{ server.url ? 'HTTP/SSE' : '命令行 (stdio)' }}</div>
							</div>
							<div class="server-badge" v-if="getServerToolCount(server.name) > 0">
								<span class="badge-count">{{ getServerToolCount(server.name) }}</span>
								<span class="badge-label">工具</span>
							</div>
							<div class="server-actions">
								<button class="btn-icon" @click.stop="editServer(server.name)" title="编辑">✏️</button>
								<button class="btn-icon danger" @click.stop="removeServer(server.name)" title="删除">🗑️</button>
							</div>
						</div>
						<div class="server-details">
							<template v-if="server.url">
								<div class="detail-item">
									<span class="detail-label">URL:</span>
									<span class="detail-value">{{ server.url }}</span>
								</div>
							</template>
							<template v-else>
								<div class="detail-item">
									<span class="detail-label">命令:</span>
									<span class="detail-value font-mono">{{ server.command }} {{ (server.args || []).join(' ') }}</span>
								</div>
								<div v-if="server.env && Object.keys(server.env).length" class="detail-item">
									<span class="detail-label">环境变量:</span>
									<span class="detail-value font-mono">{{ Object.keys(server.env).join(', ') }}</span>
								</div>
							</template>
						</div>
						
						<!-- 工具列表 -->
						<div v-if="getServerToolCount(server.name) > 0" class="server-tools">
							<div class="server-tools-header" @click="toggleServerExpand(server.name)">
								<span class="tools-toggle-icon">{{ isServerExpanded(server.name) ? '▾' : '▸' }}</span>
								<span class="tools-toggle-text">
									{{ isServerExpanded(server.name) ? '收起工具列表' : '展开工具列表' }}
									({{ getServerToolCount(server.name) }} 个)
								</span>
							</div>
							<div v-if="isServerExpanded(server.name)" class="server-tools-list">
								<div
									v-for="tool in getServerTools(server.name)"
									:key="tool.name"
									class="server-tool-item"
								>
									<div class="server-tool-name">{{ tool.shortName }}</div>
									<div class="server-tool-desc">{{ tool.description || '无描述' }}</div>
								</div>
							</div>
						</div>
						<div v-else class="server-no-tools">
							<span class="no-tools-icon">⚠️</span>
							<span class="no-tools-text">未加载任何工具（可能服务未启动或配置有误）</span>
						</div>
					</div>
				</div>
			</section>

			<!-- JSON 编辑器 -->
			<section class="json-section">
				<div class="section-header">
					<h3 class="section-label">JSON 配置</h3>
					<div class="json-actions">
						<button class="btn-sm" @click="formatJson">格式化</button>
						<button class="btn-sm btn-primary" @click="saveJsonConfig" :disabled="!!jsonError">保存</button>
					</div>
				</div>
				<div class="editor-wrapper">
					<div ref="editorContainer" class="monaco-container"></div>
				</div>
				<p v-if="jsonError" class="json-error">{{ jsonError }}</p>
				<p class="json-hint">
					格式: <code>{ "mcpServers": { "服务名": { "command": "...", "args": [...] } } }</code>
					或 <code>{ "服务名": { ... } }</code>
				</p>
			</section>

			<!-- MCP 工具总览 -->
			<section class="tools-overview" v-if="mcpTools.length">
				<div class="overview-header">
					<span class="overview-icon">🔧</span>
					<span class="overview-text">已加载 <strong>{{ mcpTools.length }}</strong> 个 MCP 工具</span>
				</div>
			</section>
		</main>

		<!-- 粘贴导入弹窗 -->
		<div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
			<div class="modal-content">
				<div class="modal-header">
					<h3>粘贴导入 MCP 配置</h3>
					<button class="btn-close" @click="showImportModal = false">×</button>
				</div>
				<div class="modal-body">
					<p class="import-hint">支持以下格式：</p>
					<ul class="format-list">
						<li><code>{ "mcpServers": { "name": { ... } } }</code> - Claude Desktop 格式</li>
						<li><code>{ "name": { "command": "...", "args": [...] } }</code> - 简化格式</li>
						<li><code>{ "command": "...", "args": [...] }</code> - 单个服务（需输入名称）</li>
					</ul>
					<textarea
						v-model="importJson"
						placeholder='粘贴 JSON 配置...'
						class="import-textarea"
						spellcheck="false"
					></textarea>
					<div v-if="!hasSingleServerName && isSingleServer" class="server-name-input">
						<label>服务名称:</label>
						<input v-model="singleServerName" placeholder="如: amap-maps" class="input-sm" />
					</div>
					<p v-if="importError" class="import-error">{{ importError }}</p>
				</div>
				<div class="modal-footer">
					<button class="btn-sm" @click="showImportModal = false">取消</button>
					<button class="btn-sm btn-primary" @click="handleImport" :disabled="!importJson.trim()">导入</button>
				</div>
			</div>
		</div>

		<!-- 编辑服务弹窗 -->
		<div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
			<div class="modal-content">
				<div class="modal-header">
					<h3>{{ editingServerName ? '编辑服务端' : '添加服务端' }}</h3>
					<button class="btn-close" @click="showEditModal = false">×</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label>服务名称 <span class="required">*</span></label>
						<input
							v-model="editForm.name"
							placeholder="如: filesystem"
							class="input-sm"
							:disabled="!!editingServerName"
						/>
					</div>
					<div class="form-group">
						<label>类型</label>
						<select v-model="editForm.type" class="input-sm">
							<option value="stdio">命令行 (stdio)</option>
							<option value="http">HTTP/SSE</option>
						</select>
					</div>

					<template v-if="editForm.type === 'stdio'">
						<div class="form-group">
							<label>命令 <span class="required">*</span></label>
							<input v-model="editForm.command" placeholder="如: npx" class="input-sm" />
						</div>
						<div class="form-group">
							<label>参数 (每行一个)</label>
							<textarea
								v-model="editForm.argsText"
								placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
								class="input-sm textarea-args"
							></textarea>
						</div>
						<div class="form-group">
							<label>环境变量 (每行 KEY=VALUE)</label>
							<textarea
								v-model="editForm.envText"
								placeholder="API_KEY=your-key&#10;DEBUG=true"
								class="input-sm textarea-env"
							></textarea>
						</div>
					</template>

					<template v-else>
						<div class="form-group">
							<label>URL <span class="required">*</span></label>
							<input v-model="editForm.url" placeholder="http://localhost:3000/sse" class="input-sm" />
						</div>
					</template>
				</div>
				<div class="modal-footer">
					<button class="btn-sm" @click="showEditModal = false">取消</button>
					<button class="btn-sm btn-primary" @click="saveServerEdit">保存</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAppStore } from '../stores/app';
import api from '../utils/api';
import toast from '../utils/toast';
import loader from '@monaco-editor/loader';

const store = useAppStore();

// Monaco editor 实例
let editor = null;
const editorContainer = ref(null);

// 状态
const mcpConfig = reactive({ enabled: true });
const mcpServers = ref({}); // 对象格式: { "name": { command, args, env } }
const jsonError = ref('');

// 导入弹窗
const showImportModal = ref(false);
const importJson = ref('');
const importError = ref('');
const singleServerName = ref('');

// 编辑弹窗
const showEditModal = ref(false);
const editingServerName = ref('');
const editForm = reactive({
	name: '',
	type: 'stdio',
	command: '',
	argsText: '',
	envText: '',
	url: '',
});

// 计算属性：服务列表
const serverList = computed(() => {
	return Object.entries(mcpServers.value).map(([name, config]) => ({
		name,
		...config,
	}));
});

// 判断是否是单个服务（没有服务名）
const isSingleServer = computed(() => {
	try {
		const parsed = JSON.parse(importJson.value);
		return parsed.command || parsed.url;
	} catch {
		return false;
	}
});

const hasSingleServerName = computed(() => {
	return singleServerName.value.trim().length > 0;
});

// MCP 工具
const mcpTools = computed(() => store.toolsGrouped?.mcp || []);

// 展开的服务端
const expandedServers = ref(new Set());

// 按服务端分组的工具
const toolsByServer = computed(() => {
	const tools = mcpTools.value;
	const grouped = {};
	
	for (const tool of tools) {
		// 工具名格式: mcp_服务名_工具名，例如 mcp_amap-maps_maps_geo
		const match = tool.name.match(/^mcp_([^_]+)_(.+)$/);
		if (match) {
			const serverName = match[1];
			if (!grouped[serverName]) {
				grouped[serverName] = [];
			}
			grouped[serverName].push({
				...tool,
				shortName: match[2], // 工具短名
			});
		}
	}
	
	return grouped;
});

// 获取服务端的工具数量
const getServerToolCount = (serverName) => {
	return toolsByServer.value[serverName]?.length || 0;
};

// 获取服务端的工具列表
const getServerTools = (serverName) => {
	return toolsByServer.value[serverName] || [];
};

// 切换服务端展开状态
const toggleServerExpand = (serverName) => {
	if (expandedServers.value.has(serverName)) {
		expandedServers.value.delete(serverName);
	} else {
		expandedServers.value.add(serverName);
	}
};

// 检查服务端是否展开
const isServerExpanded = (serverName) => {
	return expandedServers.value.has(serverName);
};

// 初始化
onMounted(async () => {
	await loadMcpConfig();
	await store.loadTools(true);
	initMonacoEditor();
});

onUnmounted(() => {
	if (editor) {
		editor.dispose();
	}
});

// 初始化 Monaco Editor
const initMonacoEditor = async () => {
	const monaco = await loader.init();
	
	// 配置 JSON 语言
	monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
		validate: true,
		allowComments: true,
		schemas: [],
	});

	editor = monaco.editor.create(editorContainer.value, {
		value: formatMcpServersToJson(mcpServers.value),
		language: 'json',
		theme: 'vs-dark',
		minimap: { enabled: false },
		fontSize: 13,
		lineNumbers: 'on',
		scrollBeyondLastLine: false,
		automaticLayout: true,
		tabSize: 2,
		wordWrap: 'on',
		folding: true,
		formatOnPaste: true,
	});

	// 监听内容变化
	editor.onDidChangeModelContent(() => {
		validateJson();
	});
};

// 格式化 mcpServers 为 JSON 字符串
const formatMcpServersToJson = (servers) => {
	const config = { mcpServers: servers };
	return JSON.stringify(config, null, 2);
};

// 验证 JSON
const validateJson = () => {
	const content = editor?.getValue() || '';
	jsonError.value = '';
	
	try {
		const parsed = JSON.parse(content);
		// 支持两种格式
		if (parsed.mcpServers) {
			// { mcpServers: { ... } } 格式
			if (typeof parsed.mcpServers !== 'object') {
				jsonError.value = 'mcpServers 必须是对象';
			}
		} else if (typeof parsed === 'object') {
			// { name: { ... } } 简化格式
			// 检查每个值是否是有效的服务配置
			for (const [name, config] of Object.entries(parsed)) {
				if (!config.command && !config.url) {
					jsonError.value = `服务 "${name}" 必须包含 command 或 url`;
					break;
				}
			}
		}
	} catch (e) {
		jsonError.value = 'JSON 格式错误: ' + e.message;
	}
};

// 加载配置
const loadMcpConfig = async () => {
	try {
		const data = await api.get('/api/mcp');
		mcpConfig.enabled = data.enabled ?? true;
		
		// 将数组格式转换为对象格式
		const servers = data.servers || [];
		mcpServers.value = {};
		for (const server of servers) {
			if (server.name) {
				const { name, ...rest } = server;
				mcpServers.value[name] = rest;
			}
		}
	} catch (e) {
		console.error('Load MCP config failed:', e);
	}
};

// 保存启用状态
const saveMcpConfig = async () => {
	try {
		await api.put('/api/mcp', { enabled: mcpConfig.enabled });
	} catch (e) {
		console.error('Save MCP config failed:', e);
	}
};

// 格式化 JSON
const formatJson = () => {
	if (!editor) return;
	
	try {
		const content = editor.getValue();
		const parsed = JSON.parse(content);
		editor.setValue(JSON.stringify(parsed, null, 2));
	} catch (e) {
		// 忽略格式化错误
	}
};

// 保存 JSON 配置
const saveJsonConfig = async () => {
	if (!editor || jsonError.value) return;
	
	try {
		const content = editor.getValue();
		const parsed = JSON.parse(content);
		
		// 提取 mcpServers
		let servers = parsed.mcpServers || parsed;
		
		// 转换为数组格式保存到后端
		const serverArray = Object.entries(servers).map(([name, config]) => ({
			name,
			...config,
		}));
		
		await api.put('/api/mcp', { servers: serverArray });
		mcpServers.value = servers;
		
		// 热重载 MCP
		await reloadMcp();
	} catch (e) {
		toast.error('保存失败: ' + e.message);
	}
};

// 添加服务
const addServer = () => {
	editingServerName.value = '';
	editForm.name = '';
	editForm.type = 'stdio';
	editForm.command = '';
	editForm.argsText = '';
	editForm.envText = '';
	editForm.url = '';
	showEditModal.value = true;
};

// 编辑服务
const editServer = (name) => {
	const server = mcpServers.value[name];
	if (!server) return;
	
	editingServerName.value = name;
	editForm.name = name;
	editForm.type = server.url ? 'http' : 'stdio';
	editForm.command = server.command || '';
	editForm.argsText = (server.args || []).join('\n');
	editForm.envText = server.env
		? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n')
		: '';
	editForm.url = server.url || '';
	showEditModal.value = true;
};

// 保存服务编辑
const saveServerEdit = async () => {
	if (!editForm.name) {
		toast.warning('请输入服务名称');
		return;
	}
	
	const serverConfig = {};
	
	if (editForm.type === 'http') {
		if (!editForm.url) {
			toast.warning('请输入 URL');
			return;
		}
		serverConfig.url = editForm.url;
	} else {
		if (!editForm.command) {
			toast.warning('请输入命令');
			return;
		}
		serverConfig.command = editForm.command;
		
		if (editForm.argsText.trim()) {
			serverConfig.args = editForm.argsText.split('\n').filter(a => a.trim());
		}
		
		if (editForm.envText.trim()) {
			serverConfig.env = {};
			for (const line of editForm.envText.split('\n')) {
				const [key, ...rest] = line.split('=');
				if (key && rest.length > 0) {
					serverConfig.env[key.trim()] = rest.join('=').trim();
				}
			}
		}
	}
	
	// 如果是编辑且名称改变，删除旧的
	if (editingServerName.value && editingServerName.value !== editForm.name) {
		delete mcpServers.value[editingServerName.value];
	}
	
	mcpServers.value[editForm.name] = serverConfig;
	
	// 更新编辑器
	if (editor) {
		editor.setValue(formatMcpServersToJson(mcpServers.value));
	}
	
	// 保存到后端
	await saveServersToBackend();
	showEditModal.value = false;
};

// 删除服务
const removeServer = async (name) => {
	if (!confirm(`确定删除服务 "${name}"？`)) return;
	
	delete mcpServers.value[name];
	
	// 更新编辑器
	if (editor) {
		editor.setValue(formatMcpServersToJson(mcpServers.value));
	}
	
	await saveServersToBackend();
};

// 保存到后端
const saveServersToBackend = async () => {
	try {
		const serverArray = Object.entries(mcpServers.value).map(([name, config]) => ({
			name,
			...config,
		}));
		await api.put('/api/mcp', { servers: serverArray });
	} catch (e) {
		console.error('Save servers failed:', e);
	}
};

// MCP 热重载
const reloadMcp = async () => {
	try {
		const result = await api.post('/api/mcp/reload', {});
		if (result.success) {
			toast.success(`MCP 已重载: ${result.total} 个工具`);
			// 刷新工具列表
			await store.loadTools(true);
		} else {
			toast.warning('MCP 重载完成，但部分服务可能未能连接');
		}
	} catch (e) {
		toast.error('MCP 重载失败: ' + e.message);
	}
};

// 处理导入
const handleImport = async () => {
	importError.value = '';
	
	try {
		const parsed = JSON.parse(importJson.value);
		let newServers = {};
		
		if (parsed.mcpServers) {
			// Claude Desktop 格式: { mcpServers: { name: {...} } }
			newServers = parsed.mcpServers;
		} else if (parsed.command || parsed.url) {
			// 单个服务格式: { command: ..., args: [...] }
			if (!singleServerName.value.trim()) {
				importError.value = '请输入服务名称';
				return;
			}
			newServers[singleServerName.value.trim()] = parsed;
		} else {
			// 简化格式: { name: {...} }
			newServers = parsed;
		}
		
		// 验证每个服务
		for (const [name, config] of Object.entries(newServers)) {
			if (!config.command && !config.url) {
				importError.value = `服务 "${name}" 必须包含 command 或 url`;
				return;
			}
		}
		
		// 合并到现有配置
		mcpServers.value = { ...mcpServers.value, ...newServers };
		
		// 更新编辑器
		if (editor) {
			editor.setValue(formatMcpServersToJson(mcpServers.value));
		}
		
		// 保存到后端并热重载
		await saveServersToBackend();
		await reloadMcp();
		
		// 关闭弹窗
		showImportModal.value = false;
		importJson.value = '';
		singleServerName.value = '';
		
		toast.success(`成功导入 ${Object.keys(newServers).length} 个服务！`);
	} catch (e) {
		importError.value = 'JSON 解析错误: ' + e.message;
	}
};

// 监听 mcpServers 变化更新编辑器
watch(mcpServers, (newVal) => {
	// 不在这里更新编辑器，避免循环
}, { deep: true });
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
	align-items: center;
	gap: 12px;
}

.switch-label {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 13px;
	color: var(--text-secondary);
}

.page-content {
	flex: 1;
	overflow-y: auto;
	padding: 24px 32px;
}

.section-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.section-label {
	font-size: 12px;
	font-weight: 600;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.header-btns {
	display: flex;
	gap: 8px;
}

/* 空状态 */
.empty-state {
	padding: 48px;
	text-align: center;
	background-color: var(--bg-secondary);
	border: 1px dashed var(--border-color);
	border-radius: 12px;
	margin-bottom: 32px;
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

/* 服务端列表 */
.servers-section {
	margin-bottom: 32px;
}

.server-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.server-card {
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	transition: all 0.15s;
}

.server-card:hover {
	border-color: var(--text-muted);
}

.server-header {
	display: flex;
	align-items: center;
	gap: 12px;
}

.server-icon {
	width: 40px;
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	background-color: var(--bg-tertiary);
	border-radius: 10px;
}

.server-info {
	flex: 1;
}

.server-name {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}

.server-type {
	font-size: 12px;
	color: var(--text-muted);
}

.server-actions {
	display: flex;
	gap: 4px;
}

.server-details {
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--border-color);
}

.detail-item {
	display: flex;
	gap: 8px;
	font-size: 12px;
	margin-bottom: 4px;
}

.detail-label {
	color: var(--text-muted);
	flex-shrink: 0;
}

.detail-value {
	color: var(--text-secondary);
	word-break: break-all;
}

/* 服务端工具数量徽章 */
.server-badge {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	background-color: rgba(16, 185, 129, 0.15);
	border-radius: 12px;
	margin-right: 8px;
}

.badge-count {
	font-size: 14px;
	font-weight: 600;
	color: #10b981;
}

.badge-label {
	font-size: 11px;
	color: #10b981;
}

/* 服务端工具列表 */
.server-tools {
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--border-color);
}

.server-tools-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	background-color: var(--bg-tertiary);
	border-radius: 8px;
	cursor: pointer;
	transition: background 0.15s;
}

.server-tools-header:hover {
	background-color: var(--bg-hover);
}

.tools-toggle-icon {
	font-size: 12px;
	color: var(--text-muted);
}

.tools-toggle-text {
	font-size: 12px;
	color: var(--text-secondary);
}

.server-tools-list {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 8px;
	margin-top: 12px;
	max-height: 400px;
	overflow-y: auto;
	padding: 4px;
}

.server-tool-item {
	padding: 10px 12px;
	background-color: var(--bg-tertiary);
	border-radius: 8px;
	transition: all 0.15s;
}

.server-tool-item:hover {
	background-color: var(--bg-hover);
}

.server-tool-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--accent);
	font-family: ui-monospace, monospace;
	margin-bottom: 4px;
}

.server-tool-desc {
	font-size: 11px;
	color: var(--text-muted);
	line-height: 1.4;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

/* 无工具提示 */
.server-no-tools {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 12px;
	padding: 10px 12px;
	background-color: rgba(245, 158, 11, 0.1);
	border-radius: 8px;
}

.no-tools-icon {
	font-size: 14px;
}

.no-tools-text {
	font-size: 12px;
	color: #f59e0b;
}

/* MCP 工具总览 */
.tools-overview {
	margin-bottom: 32px;
}

.overview-header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
	border: 1px solid rgba(16, 185, 129, 0.2);
	border-radius: 10px;
}

.overview-icon {
	font-size: 20px;
}

.overview-text {
	font-size: 14px;
	color: var(--text-secondary);
}

.overview-text strong {
	color: #10b981;
	font-weight: 600;
}

/* JSON 编辑器 */
.json-section {
	margin-bottom: 32px;
}

.json-actions {
	display: flex;
	gap: 8px;
}

.editor-wrapper {
	border: 1px solid var(--border-color);
	border-radius: 8px;
	overflow: hidden;
}

.monaco-container {
	height: 300px;
}

.json-error {
	font-size: 12px;
	color: var(--error);
	margin-top: 8px;
}

.json-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 8px;
}

.json-hint code {
	background-color: var(--bg-tertiary);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 11px;
}

/* 工具列表 */
.tools-section {
	padding-top: 24px;
	border-top: 1px solid var(--border-color);
}

.tools-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
	gap: 12px;
	margin-top: 12px;
}

.tool-card {
	padding: 12px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
}

.tool-name {
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
	margin-bottom: 4px;
	font-family: ui-monospace, monospace;
}

.tool-desc {
	font-size: 12px;
	color: var(--text-muted);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
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
	max-width: 560px;
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

/* 导入相关 */
.import-hint {
	font-size: 13px;
	color: var(--text-secondary);
	margin-bottom: 8px;
}

.format-list {
	font-size: 12px;
	color: var(--text-muted);
	margin-bottom: 16px;
	padding-left: 20px;
}

.format-list li {
	margin-bottom: 4px;
}

.format-list code {
	background-color: var(--bg-tertiary);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 11px;
}

.import-textarea {
	width: 100%;
	height: 200px;
	padding: 12px;
	font-size: 12px;
	font-family: ui-monospace, monospace;
	line-height: 1.5;
	background-color: var(--bg-tertiary);
	border: 1px solid var(--border-color);
	border-radius: 8px;
	color: var(--text-primary);
	resize: vertical;
	outline: none;
}

.import-textarea:focus {
	border-color: var(--accent);
}

.server-name-input {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-top: 12px;
}

.server-name-input label {
	font-size: 13px;
	color: var(--text-secondary);
	white-space: nowrap;
}

.server-name-input .input-sm {
	flex: 1;
}

.import-error {
	font-size: 12px;
	color: var(--error);
	margin-top: 8px;
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

.textarea-args,
.textarea-env {
	height: 80px;
	resize: vertical;
}

/* 通用样式 */
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

.btn-icon {
	width: 32px;
	height: 32px;
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

.font-mono {
	font-family: ui-monospace, monospace;
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

	.page-content {
		padding: 16px;
	}

	.header-btns {
		flex-direction: column;
		width: 100%;
	}

	.header-btns .btn-sm {
		width: 100%;
		justify-content: center;
	}
}
</style>
