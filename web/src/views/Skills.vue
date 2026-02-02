<template>
	<div class="page-container">
		<header class="page-header">
			<div class="header-left">
				<h1 class="page-title">📚 Skills 技能库</h1>
				<p class="page-desc">从目录加载 .md/.json 技能文件，并可注入到 Agent 系统提示</p>
			</div>
			<div class="header-actions">
				<label class="switch-label">
					<span>启用 Skills</span>
					<label class="switch">
						<input type="checkbox" v-model="skillsConfig.enabled" @change="saveSkillsConfig" />
						<span class="slider"></span>
					</label>
				</label>
			</div>
		</header>

		<main class="page-content">
			<!-- 配置 -->
			<section class="config-section">
				<h3 class="section-label">配置</h3>
				<div class="config-grid">
					<div class="config-item">
						<label class="config-label">技能目录</label>
						<div class="config-input-row">
							<input
								v-model="skillsConfig.directory"
								placeholder="./skills"
								class="input-sm flex-1"
								@blur="saveSkillsConfig"
							/>
							<button class="btn-sm" @click="refreshSkills">
								🔄 刷新
							</button>
						</div>
						<p class="config-hint">相对配置目录的路径，如 ./skills</p>
					</div>

					<div class="config-item">
						<div class="config-header">
							<span class="config-label">注入到 Prompt</span>
							<label class="switch">
								<input type="checkbox" v-model="skillsConfig.includeInPrompt" @change="saveSkillsConfig" />
								<span class="slider"></span>
							</label>
						</div>
						<p class="config-hint">开启后，技能内容会自动添加到 Agent 的系统提示中</p>
					</div>
				</div>
			</section>

			<!-- 已加载的技能 -->
			<section class="skills-section">
				<div class="section-header">
					<h3 class="section-label">已加载的技能 ({{ filteredSkills.length }})</h3>
					<input
						v-model="skillSearch"
						type="text"
						placeholder="搜索技能..."
						class="input-sm search-input"
					/>
				</div>

				<div v-if="loading" class="loading-state">
					<span class="loading-spinner">⏳</span>
					<span>加载中...</span>
				</div>

				<div v-else-if="filteredSkills.length === 0" class="empty-state">
					<div class="empty-icon">📚</div>
					<p class="empty-text">{{ skillSearch ? '未找到匹配的技能' : '还没有加载任何技能' }}</p>
					<p class="empty-hint">{{ skillSearch ? '尝试其他关键词' : '在技能目录中添加 .md 或 .json 文件' }}</p>
				</div>

				<div v-else class="skills-grid">
					<div
						v-for="skill in filteredSkills"
						:key="skill.name"
						class="skill-card"
						:class="{ expanded: expandedSkill === skill.name }"
						@click="toggleSkill(skill.name)"
					>
						<div class="skill-header">
							<div class="skill-icon">📄</div>
							<div class="skill-info">
								<div class="skill-name" v-html="highlightText(skill.name)"></div>
								<div class="skill-desc" v-html="highlightText(skill.description || '无描述')"></div>
							</div>
							<div class="skill-toggle">{{ expandedSkill === skill.name ? '▲' : '▼' }}</div>
						</div>

						<div v-if="expandedSkill === skill.name" class="skill-content" @click.stop>
							<pre class="skill-prompt">{{ skill.prompt || '（无内容）' }}</pre>
						</div>
					</div>
				</div>
			</section>

			<!-- 使用说明 -->
			<section class="help-section">
				<h3 class="section-label">使用说明</h3>
				<div class="help-content">
					<div class="help-item">
						<h4>📝 Markdown 格式 (.md)</h4>
						<pre class="help-code"># 技能名称

技能描述（可选）

---

技能的提示内容...</pre>
					</div>
					<div class="help-item">
						<h4>📋 JSON 格式 (.json)</h4>
						<pre class="help-code">{
  "name": "技能名称",
  "description": "技能描述",
  "prompt": "技能的提示内容..."
}</pre>
					</div>
				</div>
			</section>
		</main>
	</div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import api from '../utils/api';

// 状态
const skillsConfig = reactive({
	enabled: true,
	directory: './skills',
	autoload: true,
	includeInPrompt: true,
});
const skillsLoaded = ref([]);
const loading = ref(false);
const expandedSkill = ref(null);
const skillSearch = ref('');

// 搜索过滤
const filteredSkills = computed(() => {
	if (!skillSearch.value) return skillsLoaded.value;
	const query = skillSearch.value.toLowerCase();
	return skillsLoaded.value.filter(skill => 
		skill.name?.toLowerCase().includes(query) ||
		skill.description?.toLowerCase().includes(query)
	);
});

// 高亮搜索关键字
const highlightText = (text) => {
	if (!text || !skillSearch.value) return text;
	const query = skillSearch.value.trim();
	if (!query) return text;
	
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escaped})`, 'gi');
	return text.replace(regex, '<mark class="highlight">$1</mark>');
};

// 初始化
onMounted(async () => {
	await loadSkillsConfig();
});

// 加载配置
const loadSkillsConfig = async () => {
	loading.value = true;
	try {
		const data = await api.get('/api/skills');
		skillsConfig.enabled = data.enabled ?? true;
		skillsConfig.directory = data.directory || './skills';
		skillsConfig.autoload = data.autoload ?? true;
		skillsConfig.includeInPrompt = data.includeInPrompt ?? true;
		skillsLoaded.value = data.loaded || [];
	} catch (e) {
		console.error('Load skills config failed:', e);
	} finally {
		loading.value = false;
	}
};

// 保存配置
const saveSkillsConfig = async () => {
	try {
		await api.put('/api/skills', {
			enabled: skillsConfig.enabled,
			directory: skillsConfig.directory,
			autoload: skillsConfig.autoload,
			includeInPrompt: skillsConfig.includeInPrompt,
		});
	} catch (e) {
		console.error('Save skills config failed:', e);
	}
};

// 刷新技能
const refreshSkills = async () => {
	await loadSkillsConfig();
};

// 展开/折叠技能
const toggleSkill = (name) => {
	if (expandedSkill.value === name) {
		expandedSkill.value = null;
	} else {
		expandedSkill.value = name;
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

/* 配置 */
.config-section {
	margin-bottom: 32px;
}

.config-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 16px;
	margin-top: 12px;
}

.config-item {
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
}

.config-label {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
	margin-bottom: 8px;
	display: block;
}

.config-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}

.config-input-row {
	display: flex;
	gap: 8px;
}

.config-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 8px;
}

/* 加载状态 */
.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 48px;
	color: var(--text-muted);
}

.loading-spinner {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
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

/* 技能网格 */
.skills-section {
	margin-bottom: 32px;
}

.skills-grid {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-top: 12px;
}

.skill-card {
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	cursor: pointer;
	transition: all 0.15s;
}

.skill-card:hover {
	border-color: var(--text-muted);
}

.skill-card.expanded {
	border-color: var(--accent);
}

.skill-header {
	display: flex;
	align-items: center;
	gap: 12px;
}

.skill-icon {
	width: 40px;
	height: 40px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	background-color: var(--bg-tertiary);
	border-radius: 10px;
}

.skill-info {
	flex: 1;
}

.skill-name {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}

.skill-desc {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 2px;
}

.skill-toggle {
	font-size: 10px;
	color: var(--text-muted);
}

.skill-content {
	margin-top: 16px;
	padding-top: 16px;
	border-top: 1px solid var(--border-color);
}

.skill-prompt {
	padding: 12px;
	background-color: var(--bg-tertiary);
	border-radius: 8px;
	font-size: 12px;
	font-family: ui-monospace, monospace;
	line-height: 1.5;
	color: var(--text-secondary);
	white-space: pre-wrap;
	word-break: break-word;
	max-height: 300px;
	overflow-y: auto;
	margin: 0;
}

/* 使用说明 */
.help-section {
	padding-top: 24px;
	border-top: 1px solid var(--border-color);
}

.help-content {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 16px;
	margin-top: 12px;
}

.help-item {
	padding: 16px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
}

.help-item h4 {
	font-size: 13px;
	font-weight: 600;
	color: var(--text-primary);
	margin-bottom: 12px;
}

.help-code {
	padding: 12px;
	background-color: var(--bg-tertiary);
	border-radius: 6px;
	font-size: 11px;
	font-family: ui-monospace, monospace;
	line-height: 1.5;
	color: var(--text-secondary);
	white-space: pre-wrap;
	margin: 0;
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

.input-sm {
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

.flex-1 {
	flex: 1;
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

/* 搜索框 */
.search-input {
	width: 200px;
}

/* 搜索高亮 */
:deep(.highlight) {
	background-color: rgba(245, 158, 11, 0.3);
	color: #fbbf24;
	padding: 0 2px;
	border-radius: 2px;
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

	.section-header {
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.search-input {
		width: 100%;
	}
}
</style>
