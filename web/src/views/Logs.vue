<template>
	<div class="flex-1 overflow-y-auto p-6">
		<div class="flex items-center justify-between mb-6">
			<h2 class="text-2xl font-bold">日志</h2>
			<div class="flex items-center gap-3">
				<select v-model="level" class="input w-32" @change="loadLogs">
					<option value="">全部级别</option>
					<option value="debug">Debug</option>
					<option value="info">Info</option>
					<option value="warn">Warn</option>
					<option value="error">Error</option>
				</select>
				<button @click="loadLogs" class="btn btn-secondary">刷新</button>
			</div>
		</div>

		<div class="card">
			<div class="font-mono text-sm space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
				<div
					v-for="(log, index) in logs"
					:key="index"
					class="flex items-start gap-3 py-1 border-b border-zinc-800 last:border-0"
				>
					<span class="text-zinc-500 text-xs whitespace-nowrap">
						{{ formatTime(log.timestamp) }}
					</span>
					<span class="text-xs px-1.5 py-0.5 rounded whitespace-nowrap" :class="levelClass(log.level)">
						{{ log.level?.toUpperCase() }}
					</span>
					<span class="flex-1 break-all">{{ log.message }}</span>
				</div>

				<div v-if="logs.length === 0" class="text-zinc-500 text-center py-8">暂无日志</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const logs = ref([]);
const level = ref('');
let refreshInterval = null;

const loadLogs = async () => {
	try {
		const params = new URLSearchParams();
		params.set('limit', '100');
		if (level.value) params.set('level', level.value);

		const response = await fetch(`/api/logs?${params}`);
		logs.value = await response.json();
	} catch (error) {
		console.error('Failed to load logs:', error);
	}
};

const formatTime = (time) => {
	if (!time) return '';
	return new Date(time).toLocaleTimeString();
};

const levelClass = (lvl) => {
	switch (lvl) {
		case 'debug':
			return 'bg-zinc-600 text-zinc-300';
		case 'info':
			return 'bg-blue-500/20 text-blue-400';
		case 'warn':
			return 'bg-yellow-500/20 text-yellow-400';
		case 'error':
			return 'bg-red-500/20 text-red-400';
		default:
			return 'bg-zinc-600 text-zinc-300';
	}
};

onMounted(() => {
	loadLogs();
	// 自动刷新
	refreshInterval = setInterval(loadLogs, 5000);
});

onUnmounted(() => {
	if (refreshInterval) {
		clearInterval(refreshInterval);
	}
});
</script>
