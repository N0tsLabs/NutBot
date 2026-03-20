<template>
	<div class="app-container" :data-theme="theme">
		<!-- Toast 通知 -->
		<Toast />

		<!-- 移动端顶部导航栏 -->
		<header class="mobile-header md:hidden">
			<button @click="sidebarOpen = !sidebarOpen" class="menu-btn">
				<span v-if="!sidebarOpen">☰</span>
				<span v-else>✕</span>
			</button>
			<h1 class="mobile-title">
				<span class="logo">🥜</span>
				<span>NutBot</span>
			</h1>
			<button @click="toggleTheme" class="theme-btn">
				{{ theme === 'dark' ? '🌙' : '☀️' }}
			</button>
		</header>

		<!-- 侧边栏遮罩（移动端） -->
		<div v-if="sidebarOpen" class="sidebar-overlay md:hidden" @click="sidebarOpen = false"></div>

		<!-- 侧边栏 -->
		<aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
			<!-- Logo -->
			<div class="sidebar-header">
				<h1 class="logo-text">
					<span class="logo">🥜</span>
					<span class="brand">NutBot</span>
				</h1>
				<p class="subtitle">AI 桌面自动化助手</p>
			</div>

			<!-- 导航 -->
			<nav class="sidebar-nav">
				<router-link
					v-for="item in navItems"
					:key="item.path"
					:to="item.path"
					class="nav-item"
					:class="{ active: $route.path === item.path }"
					@click="sidebarOpen = false"
				>
					<span class="nav-icon">{{ item.icon }}</span>
					<span class="nav-text">{{ item.name }}</span>
				</router-link>
			</nav>

			<!-- 底部 -->
			<div class="sidebar-footer">
				<!-- 主题切换（桌面端） -->
				<button @click="toggleTheme" class="theme-toggle hidden md:flex">
					<span>{{ theme === 'dark' ? '🌙' : '☀️' }}</span>
					<span>{{ theme === 'dark' ? '深色' : '浅色' }}</span>
				</button>

			<!-- 打开独立浏览器按钮 -->
					<button
						@click="openBrowser"
						:disabled="browserLoading"
						class="browser-btn"
					>
						<span v-if="browserLoading" class="loading-spinner"></span>
						<span v-else>🌐</span>
						<span>{{ browserLoading ? '打开中...' : '打开独立浏览器' }}</span>
					</button>
			</div>
		</aside>

		<!-- 主内容 -->
		<main class="main-content">
			<router-view />
		</main>
	</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAppStore } from './stores/app';
import { getBaseUrl } from './utils/api';
import { toast } from './utils/toast';
import Toast from './components/Toast.vue';

const store = useAppStore();
const connected = ref(false);
const sidebarOpen = ref(false);
const theme = ref('dark');
const browserLoading = ref(false);

// 打开独立浏览器
const openBrowser = async () => {
	if (browserLoading.value) return;

	browserLoading.value = true;
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/browser/open`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		});

		const data = await response.json();

		if (response.ok && data.success) {
			toast.success(data.message || '浏览器已打开');
		} else {
			toast.error(data.message || data.error || '打开浏览器失败');
		}
	} catch (error) {
		console.error('打开浏览器失败:', error);
		toast.error('打开浏览器失败，请检查服务是否正常');
	} finally {
		browserLoading.value = false;
	}
};

// 导航项
const navItems = [
	{ path: '/', name: '对话', icon: '💬' },
	{ path: '/agents', name: 'Agent', icon: '🎯' },
	{ path: '/providers', name: 'Provider', icon: '🤖' },
	{ path: '/mcp', name: 'MCP', icon: '🔌' },
	{ path: '/skills', name: 'Skills', icon: '📚' },
	{ path: '/cron', name: '定时任务', icon: '⏰' },
	{ path: '/logs', name: '日志', icon: '📋' },
	{ path: '/settings', name: '设置', icon: '⚙️' },
];

// 应用主题到 document
const applyTheme = (themeValue) => {
	document.documentElement.setAttribute('data-theme', themeValue);
	document.documentElement.style.colorScheme = themeValue;
};

// 主题切换
const toggleTheme = () => {
	theme.value = theme.value === 'dark' ? 'light' : 'dark';
	localStorage.setItem('nutbot-theme', theme.value);
	applyTheme(theme.value);
};

// 初始化主题
const initTheme = () => {
	const savedTheme = localStorage.getItem('nutbot-theme');
	if (savedTheme) {
		theme.value = savedTheme;
	} else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
		theme.value = 'light';
	}
	// 应用主题
	applyTheme(theme.value);
};

// 监听主题变化
watch(theme, (newTheme) => {
	applyTheme(newTheme);
});

// WebSocket 连接
let ws = null;

const connect = () => {
	const baseUrl = getBaseUrl();
	const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

	console.log('Connecting to WebSocket:', wsUrl);
	ws = new WebSocket(wsUrl);

	ws.onopen = () => {
		connected.value = true;
		store.setConnected(true);
	};

	ws.onclose = () => {
		connected.value = false;
		store.setConnected(false);
		setTimeout(connect, 3000);
	};

	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		store.handleMessage(message);
	};

	ws.onerror = (error) => {
		console.error('WebSocket error:', error);
	};

	store.setWebSocket(ws);
};

// 响应式侧边栏（窗口大小变化时自动关闭）
const handleResize = () => {
	if (window.innerWidth >= 768) {
		sidebarOpen.value = false;
	}
};

onMounted(() => {
	initTheme();
	connect();
	window.addEventListener('resize', handleResize);
	// 启动心跳检测
	store.startHeartbeat();
	// 加载会话列表和历史记录
	store.loadSessions();
});

onUnmounted(() => {
	ws?.close();
	window.removeEventListener('resize', handleResize);
	// 停止心跳检测
	store.stopHeartbeat();
});
</script>

<style scoped>
.app-container {
	@apply h-screen flex overflow-hidden;
	background-color: var(--bg-primary);
}

/* 移动端顶部导航 */
.mobile-header {
	@apply fixed top-0 left-0 right-0 h-14 items-center justify-between px-4 z-40;
	@apply flex md:hidden;
	background-color: var(--bg-secondary);
	border-bottom: 1px solid var(--border-color);
}

.menu-btn {
	@apply w-10 h-10 flex items-center justify-center rounded text-lg;
	color: var(--text-primary);
}

.mobile-title {
	@apply flex items-center gap-2 font-semibold;
	color: var(--text-primary);
}

.theme-btn {
	@apply w-10 h-10 flex items-center justify-center rounded text-lg;
}

/* 侧边栏遮罩 */
.sidebar-overlay {
	@apply fixed inset-0 z-40 md:hidden;
	background-color: rgba(0, 0, 0, 0.5);
}

/* 侧边栏 */
.sidebar {
	@apply fixed md:relative w-64 h-screen flex flex-col z-50;
	background-color: var(--bg-secondary);
	border-right: 1px solid var(--border-color);
	transform: translateX(-100%);
	transition: transform 0.3s ease;
}

.sidebar-open {
	transform: translateX(0);
}

@media (min-width: 768px) {
	.sidebar {
		transform: translateX(0);
	}
}

.sidebar-header {
	@apply p-4;
	border-bottom: 1px solid var(--border-color);
}

.logo-text {
	@apply flex items-center gap-2 text-lg font-semibold;
	color: var(--text-primary);
}

.logo {
	@apply text-2xl;
}

.brand {
	color: var(--accent);
}

.subtitle {
	@apply text-xs mt-1;
	color: var(--text-muted);
}

/* 导航 */
.sidebar-nav {
	@apply flex-1 p-3 space-y-1 overflow-y-auto;
}

.nav-item {
	@apply flex items-center gap-3 px-3 py-2.5 rounded transition-colors;
	color: var(--text-secondary);
}

.nav-item:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

.nav-item.active {
	background-color: var(--accent-subtle);
	color: var(--accent);
}

.nav-icon {
	@apply text-base;
}

.nav-text {
	@apply text-sm font-medium;
}

/* 侧边栏底部 */
.sidebar-footer {
	@apply p-4 space-y-3;
	border-top: 1px solid var(--border-color);
}

.theme-toggle {
	@apply w-full items-center gap-2 px-3 py-2 rounded text-sm transition-colors;
	color: var(--text-secondary);
}

.theme-toggle:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

/* 连接状态 */
.connection-status {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 12px;
}

.connection-status .status-item {
	color: var(--text-muted);
}

.connection-status .separator {
	opacity: 0.5;
}

.connection-status .status-green {
	color: #4ade80;
	font-weight: 600;
}

.connection-status .status-red {
	color: #f87171;
	font-weight: 600;
}

/* 打开浏览器按钮 */
.browser-btn {
	@apply flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors;
	color: var(--text-secondary);
	background-color: transparent;
	border: 1px solid var(--border-color);
	cursor: pointer;
}

.browser-btn:hover:not(:disabled) {
	background-color: var(--bg-hover);
	color: var(--text-primary);
	border-color: var(--accent);
}

.browser-btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.browser-btn .loading-spinner {
	@apply w-4 h-4 border-2 border-t-transparent rounded-full animate-spin;
	border-color: var(--accent);
	border-top-color: transparent;
}

/* 主内容 */
.main-content {
	@apply flex-1 flex flex-col;
	padding-top: 0;
	overflow: hidden; /* 防止全局滚动，让子组件自己滚动 */
}

@media (max-width: 767px) {
	.main-content {
		padding-top: 56px; /* mobile header height */
	}
}
</style>
