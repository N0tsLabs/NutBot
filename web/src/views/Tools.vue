<template>
	<div class="flex-1 overflow-y-auto p-6">
		<h2 class="text-2xl font-bold mb-6">工具</h2>

		<div class="grid gap-4">
			<div v-for="tool in store.tools" :key="tool.name" class="card">
				<div class="flex items-start justify-between mb-3">
					<div>
						<h3 class="font-medium text-lg">{{ tool.name }}</h3>
						<p class="text-sm text-zinc-400">{{ tool.description }}</p>
					</div>
					<span
						class="px-2 py-1 text-xs rounded"
						:class="tool.enabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-600 text-zinc-400'"
					>
						{{ tool.enabled ? '启用' : '禁用' }}
					</span>
				</div>

				<!-- 参数 -->
				<div v-if="Object.keys(tool.parameters || {}).length > 0" class="mt-4">
					<h4 class="text-sm font-medium text-zinc-400 mb-2">参数</h4>
					<div class="space-y-2">
						<div v-for="(param, key) in tool.parameters" :key="key" class="flex items-center text-sm">
							<span class="text-amber-400 font-mono w-24">{{ key }}</span>
							<span class="text-zinc-500 w-20">{{ param.type }}</span>
							<span class="text-zinc-400 flex-1">{{ param.description }}</span>
							<span v-if="param.required" class="text-red-400 text-xs">必填</span>
						</div>
					</div>
				</div>

				<!-- 快速执行 -->
				<div class="mt-4 pt-4 border-t border-zinc-700">
					<button @click="openExecute(tool)" class="btn btn-secondary text-sm">执行</button>
				</div>
			</div>

			<div v-if="store.tools.length === 0" class="text-zinc-500 text-center py-8">暂无可用工具</div>
		</div>

		<!-- 执行对话框 -->
		<div
			v-if="executingTool"
			class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
			@click.self="executingTool = null"
		>
			<div class="bg-zinc-800 rounded-xl p-6 w-full max-w-lg">
				<h3 class="text-lg font-bold mb-4">执行: {{ executingTool.name }}</h3>

				<form @submit.prevent="executeTool" class="space-y-4">
					<div v-for="(param, key) in executingTool.parameters" :key="key">
						<label class="block text-sm text-zinc-400 mb-1">
							{{ key }}
							<span v-if="param.required" class="text-red-400">*</span>
						</label>
						<input v-model="executeParams[key]" :placeholder="param.description" class="input" />
					</div>

					<div class="flex justify-end gap-3">
						<button type="button" @click="executingTool = null" class="btn btn-secondary">取消</button>
						<button type="submit" class="btn btn-primary" :disabled="executing">
							{{ executing ? '执行中...' : '执行' }}
						</button>
					</div>
				</form>

				<!-- 执行结果 -->
				<div v-if="executeResult" class="mt-4 p-3 bg-zinc-900 rounded-lg">
					<h4 class="text-sm font-medium mb-2">结果:</h4>
					<pre class="text-sm text-zinc-300 overflow-auto max-h-64">{{
						JSON.stringify(executeResult, null, 2)
					}}</pre>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();

const executingTool = ref(null);
const executeParams = reactive({});
const executing = ref(false);
const executeResult = ref(null);

const openExecute = (tool) => {
	executingTool.value = tool;
	Object.keys(executeParams).forEach((key) => delete executeParams[key]);
	executeResult.value = null;
};

const executeTool = async () => {
	if (!executingTool.value) return;

	executing.value = true;
	executeResult.value = null;

	try {
		const response = await fetch(`/api/tools/${executingTool.value.name}/execute`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(executeParams),
		});

		// 处理 SSE 响应
		const reader = response.body.getReader();
		const decoder = new TextDecoder();

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const text = decoder.decode(value);
			const lines = text.split('\n');

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const data = JSON.parse(line.slice(6));
					if (data.type === 'result') {
						executeResult.value = data;
					}
				}
			}
		}
	} catch (error) {
		executeResult.value = { error: error.message };
	} finally {
		executing.value = false;
	}
};

onMounted(() => {
	store.loadTools();
});
</script>
