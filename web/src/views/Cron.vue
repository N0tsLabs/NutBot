<template>
	<div class="flex-1 overflow-y-auto p-6">
		<div class="flex items-center justify-between mb-6">
			<h2 class="text-2xl font-bold">定时任务</h2>
			<button @click="showAddDialog = true" class="btn btn-primary">添加任务</button>
		</div>

		<div class="space-y-4">
			<div v-for="job in jobs" :key="job.id" class="card">
				<div class="flex items-start justify-between">
					<div>
						<h3 class="font-medium">{{ job.name || job.task }}</h3>
						<p class="text-sm text-zinc-400 font-mono">{{ job.schedule }}</p>
					</div>
					<div class="flex items-center gap-2">
						<span
							class="px-2 py-1 text-xs rounded"
							:class="job.enabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-600 text-zinc-400'"
						>
							{{ job.enabled ? '启用' : '禁用' }}
						</span>
					</div>
				</div>

				<div class="mt-3 text-sm text-zinc-400 space-y-1">
					<div v-if="job.lastRun">上次运行: {{ formatTime(job.lastRun) }}</div>
					<div v-if="job.nextRun">下次运行: {{ formatTime(job.nextRun) }}</div>
					<div>已运行: {{ job.runCount || 0 }} 次</div>
				</div>

				<div class="mt-4 flex gap-2">
					<button @click="runJob(job.id)" class="btn btn-secondary text-sm">立即执行</button>
					<button @click="toggleJob(job)" class="btn btn-secondary text-sm">
						{{ job.enabled ? '禁用' : '启用' }}
					</button>
					<button @click="deleteJob(job.id)" class="text-red-400 hover:text-red-300 text-sm px-2">
						删除
					</button>
				</div>
			</div>

			<div v-if="jobs.length === 0" class="text-zinc-500 text-center py-8">还没有定时任务</div>
		</div>

		<!-- 添加对话框 -->
		<div
			v-if="showAddDialog"
			class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
			@click.self="showAddDialog = false"
		>
			<div class="bg-zinc-800 rounded-xl p-6 w-full max-w-lg">
				<h3 class="text-lg font-bold mb-4">添加定时任务</h3>

				<form @submit.prevent="addJob" class="space-y-4">
					<div>
						<label class="block text-sm text-zinc-400 mb-1">任务名称</label>
						<input v-model="newJob.name" placeholder="如: 每日报告" class="input" />
					</div>

					<div>
						<label class="block text-sm text-zinc-400 mb-1">Cron 表达式 *</label>
						<input v-model="newJob.schedule" placeholder="如: 0 9 * * *" class="input" />
						<p class="text-xs text-zinc-500 mt-1">格式: 分 时 日 月 周（如 0 9 * * * 表示每天9点）</p>
					</div>

					<div>
						<label class="block text-sm text-zinc-400 mb-1">任务内容 *</label>
						<input v-model="newJob.task" placeholder="如: chat:帮我查看今日新闻" class="input" />
						<p class="text-xs text-zinc-500 mt-1">格式: chat:消息 / tool:工具名 参数 / webhook:URL</p>
					</div>

					<div class="flex justify-end gap-3">
						<button type="button" @click="showAddDialog = false" class="btn btn-secondary">取消</button>
						<button type="submit" class="btn btn-primary">添加</button>
					</div>
				</form>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import toast from '../utils/toast';

const jobs = ref([]);
const showAddDialog = ref(false);
const newJob = reactive({
	name: '',
	schedule: '',
	task: '',
});

const loadJobs = async () => {
	try {
		const response = await fetch('/api/cron');
		jobs.value = await response.json();
	} catch (error) {
		console.error('Failed to load jobs:', error);
	}
};

const addJob = async () => {
	if (!newJob.schedule || !newJob.task) {
		toast.warning('请填写 Cron 表达式和任务内容');
		return;
	}

	try {
		await fetch('/api/cron', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(newJob),
		});

		await loadJobs();
		showAddDialog.value = false;
		Object.assign(newJob, { name: '', schedule: '', task: '' });
		toast.success('添加成功');
	} catch (error) {
		toast.error('添加失败: ' + error.message);
	}
};

const runJob = async (id) => {
	try {
		await fetch(`/api/cron/${id}/run`, { method: 'POST' });
		await loadJobs();
		toast.success('任务已执行');
	} catch (error) {
		toast.error('执行失败: ' + error.message);
	}
};

const toggleJob = async (job) => {
	try {
		await fetch(`/api/cron/${job.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !job.enabled }),
		});
		await loadJobs();
	} catch (error) {
		toast.error('操作失败: ' + error.message);
	}
};

const deleteJob = async (id) => {
	if (!confirm('确定删除这个任务?')) return;

	try {
		await fetch(`/api/cron/${id}`, { method: 'DELETE' });
		await loadJobs();
		toast.success('删除成功');
	} catch (error) {
		toast.error('删除失败: ' + error.message);
	}
};

const formatTime = (time) => {
	return new Date(time).toLocaleString();
};

onMounted(loadJobs);
</script>
