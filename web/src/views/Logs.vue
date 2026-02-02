<template>
	<div class="logs-container">
		<!-- 头部工具栏 -->
		<header class="logs-header">
			<div class="header-left">
				<h2 class="title">
					<span class="title-icon">📋</span>
					<span>控制台</span>
				</h2>
				<span class="log-count">{{ filteredLogs.length }} 条日志</span>
			</div>
			<div class="header-right">
				<!-- 搜索 -->
				<div class="search-box">
					<span class="search-icon">🔍</span>
					<input
						v-model="searchText"
						type="text"
						placeholder="搜索日志..."
						class="search-input"
					/>
				</div>
				<!-- 级别过滤 -->
				<select v-model="levelFilter" class="level-select">
					<option value="">全部级别</option>
					<option value="debug">Debug</option>
					<option value="info">Info</option>
					<option value="success">Success</option>
					<option value="warn">Warn</option>
					<option value="error">Error</option>
				</select>
				<!-- 自动滚动 -->
				<button
					@click="autoScroll = !autoScroll"
					class="action-btn"
					:class="{ active: autoScroll }"
					title="自动滚动"
				>
					{{ autoScroll ? '⏸' : '▶' }}
				</button>
				<!-- 清空 -->
				<button @click="store.clearLogs()" class="action-btn danger" title="清空日志">
					🗑
				</button>
			</div>
		</header>

		<!-- 日志列表 -->
		<div ref="logsContainer" class="logs-list">
			<div v-if="filteredLogs.length === 0" class="empty-state">
				<span class="empty-icon">📭</span>
				<p>暂无日志</p>
				<p class="empty-hint">日志将在服务运行时实时显示</p>
			</div>

			<div
				v-for="(log, index) in filteredLogs"
				:key="index"
				class="log-item"
				:class="['log-' + log.level]"
			>
				<span class="log-time">{{ formatTime(log.timestamp) }}</span>
				<span class="log-level" :class="'level-' + log.level">
					{{ log.icon || getLevelIcon(log.level) }}
				</span>
				<span class="log-prefix" v-if="log.prefix" v-html="highlightText(log.prefix)"></span>
				<span class="log-message" v-html="highlightText(log.message)"></span>
			</div>
		</div>

		<!-- 底部状态栏 -->
		<footer class="logs-footer">
			<div class="footer-left">
				<span class="status-dot" :class="store.connected ? 'online' : 'offline'"></span>
				<span>{{ store.connected ? '已连接' : '未连接' }}</span>
			</div>
			<div class="footer-right">
				<span v-if="searchText || levelFilter">
					显示 {{ filteredLogs.length }} / {{ store.logs.length }}
				</span>
			</div>
		</footer>
	</div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();
const logsContainer = ref(null);
const searchText = ref('');
const levelFilter = ref('');
const autoScroll = ref(true);

// 过滤日志
const filteredLogs = computed(() => {
	let result = store.logs;

	// 级别过滤
	if (levelFilter.value) {
		result = result.filter((log) => log.level === levelFilter.value);
	}

	// 搜索过滤
	if (searchText.value) {
		const search = searchText.value.toLowerCase();
		result = result.filter(
			(log) =>
				log.message?.toLowerCase().includes(search) ||
				log.prefix?.toLowerCase().includes(search)
		);
	}

	return result;
});

// 格式化时间
const formatTime = (time) => {
	if (!time) return '';
	const date = new Date(time);
	return date.toLocaleTimeString('zh-CN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
	});
};

// 高亮搜索关键字
const highlightText = (text) => {
	if (!text || !searchText.value) return text;
	const query = searchText.value.trim();
	if (!query) return text;
	
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escaped})`, 'gi');
	return text.replace(regex, '<mark class="highlight">$1</mark>');
};

// 获取级别图标
const getLevelIcon = (level) => {
	const icons = {
		debug: '🔍',
		info: 'ℹ️',
		success: '✅',
		warn: '⚠️',
		error: '❌',
	};
	return icons[level] || 'ℹ️';
};

// 监听日志变化，自动滚动
watch(
	() => store.logs.length,
	() => {
		if (autoScroll.value) {
			nextTick(() => {
				if (logsContainer.value) {
					logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
				}
			});
		}
	}
);

// 初始化时滚动到底部
onMounted(() => {
	nextTick(() => {
		if (logsContainer.value && autoScroll.value) {
			logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
		}
	});
});
</script>

<style scoped>
.logs-container {
	@apply h-full flex flex-col;
	background-color: var(--bg-primary);
}

/* 头部 */
.logs-header {
	@apply flex items-center justify-between px-4 py-3;
	background-color: var(--bg-secondary);
	border-bottom: 1px solid var(--border-color);
}

.header-left {
	@apply flex items-center gap-3;
}

.title {
	@apply flex items-center gap-2 text-lg font-semibold;
	color: var(--text-primary);
}

.title-icon {
	@apply text-xl;
}

.log-count {
	@apply text-sm px-2 py-0.5 rounded;
	background-color: var(--bg-hover);
	color: var(--text-muted);
}

.header-right {
	@apply flex items-center gap-2;
}

.search-box {
	@apply flex items-center gap-2 px-3 py-1.5 rounded;
	background-color: var(--bg-primary);
	border: 1px solid var(--border-color);
}

.search-icon {
	@apply text-sm;
	color: var(--text-muted);
}

.search-input {
	@apply bg-transparent border-none outline-none text-sm w-40;
	color: var(--text-primary);
}

.search-input::placeholder {
	color: var(--text-muted);
}

.level-select {
	@apply px-3 py-1.5 rounded text-sm;
	background-color: var(--bg-primary);
	border: 1px solid var(--border-color);
	color: var(--text-primary);
}

.action-btn {
	@apply w-8 h-8 flex items-center justify-center rounded text-sm transition-colors;
	background-color: var(--bg-primary);
	border: 1px solid var(--border-color);
	color: var(--text-secondary);
}

.action-btn:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.action-btn.active {
	background-color: var(--accent-subtle);
	border-color: var(--accent);
	color: var(--accent);
}

.action-btn.danger:hover {
	background-color: rgba(239, 68, 68, 0.1);
	border-color: var(--error);
	color: var(--error);
}

/* 日志列表 */
.logs-list {
	@apply flex-1 overflow-y-auto font-mono text-sm p-2;
	background-color: #0d1117;
}

.empty-state {
	@apply flex flex-col items-center justify-center h-full;
	color: var(--text-muted);
}

.empty-icon {
	@apply text-4xl mb-3;
}

.empty-hint {
	@apply text-xs mt-1;
	color: var(--text-muted);
}

.log-item {
	@apply flex items-start gap-2 px-2 py-1 rounded;
	line-height: 1.4;
}

.log-item:hover {
	background-color: rgba(255, 255, 255, 0.03);
}

.log-time {
	@apply flex-shrink-0 text-xs;
	color: #6e7681;
	font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.log-level {
	@apply flex-shrink-0 w-5 text-center;
}

.log-prefix {
	@apply flex-shrink-0 text-xs px-1 rounded;
	background-color: rgba(136, 136, 136, 0.2);
	color: #8b949e;
}

.log-message {
	@apply flex-1;
	color: #c9d1d9;
	word-break: break-word;
}

/* 日志级别颜色 */
.log-debug .log-message {
	color: #8b949e;
}

.log-info .log-message {
	color: #58a6ff;
}

.log-success .log-message {
	color: #3fb950;
}

.log-warn .log-message {
	color: #d29922;
}

.log-error .log-message {
	color: #f85149;
}

/* 底部状态栏 */
.logs-footer {
	@apply flex items-center justify-between px-4 py-2 text-xs;
	background-color: var(--bg-secondary);
	border-top: 1px solid var(--border-color);
	color: var(--text-muted);
}

.footer-left {
	@apply flex items-center gap-2;
}

.status-dot {
	@apply w-2 h-2 rounded-full;
}

.status-dot.online {
	background-color: var(--success);
}

.status-dot.offline {
	background-color: var(--error);
}

/* 搜索高亮 */
:deep(.highlight) {
	background-color: rgba(245, 158, 11, 0.3);
	color: #fbbf24;
	padding: 0 2px;
	border-radius: 2px;
}
</style>
