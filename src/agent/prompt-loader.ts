/**
 * Prompt 加载器
 * 从配置文件读取 AI 行为定义
 * 不直接导入 memoryManager，避免初始化副作用
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Memory, MemoryStore } from '../memory/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../config/prompts');

export interface PromptConfig {
	soul: string;
	personality: string;
	behavior: string;
}

/**
 * 加载所有 Prompt 配置文件
 */
export function loadPromptConfig(): PromptConfig {
	const soulPath = join(PROMPTS_DIR, 'SOUL.md');
	const personalityPath = join(PROMPTS_DIR, 'PERSONALITY.md');
	const behaviorPath = join(PROMPTS_DIR, 'BEHAVIOR.md');

	return {
		soul: readFileIfExists(soulPath) || getDefaultSOUL(),
		personality: readFileIfExists(personalityPath) || getDefaultPersonality(),
		behavior: readFileIfExists(behaviorPath) || getDefaultBehavior(),
	};
}

/**
 * 读取文件内容（不存在则返回空）
 */
function readFileIfExists(path: string): string | null {
	try {
		if (existsSync(path)) {
			return readFileSync(path, 'utf-8');
		}
	} catch {
		// 忽略错误
	}
	return null;
}

/**
 * 获取内存文件路径
 */
function getMemoryPath(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || '';
	const nutbotDir = join(homeDir, '.nutbot');
	return join(nutbotDir, 'memory.json');
}

/**
 * 加载记忆存储
 */
function loadMemoryStore(): MemoryStore {
	try {
		const path = getMemoryPath();
		if (existsSync(path)) {
			const content = readFileSync(path, 'utf-8');
			return JSON.parse(content);
		}
	} catch {
		// 忽略错误
	}
	return { memories: [], lastUpdated: new Date().toISOString() };
}

/**
 * 获取 AI 当前身份（从记忆系统）
 * 不直接导入 memoryManager，避免初始化问题
 */
export function getCurrentIdentity(): string | undefined {
	const store = loadMemoryStore();
	const identity = store.memories.find((m: Memory) => m.category === 'identity');
	return identity ? identity.content : undefined;
}

/**
 * 获取用户记忆摘要
 */
export function getUserSummary(): string {
	const store = loadMemoryStore();
	const userMemories = store.memories.filter((m: Memory) => m.category !== 'identity');

	if (userMemories.length === 0) return '';

	const grouped: Record<string, string[]> = {};

	for (const memory of userMemories) {
		if (!grouped[memory.category]) {
			grouped[memory.category] = [];
		}
		grouped[memory.category].push(memory.content);
	}

	const categoryNames: Record<string, string> = {
		preference: '用户偏好',
		habit: '使用习惯',
		fact: '关于用户的信息',
		instruction: '用户的指令',
		other: '其他',
	};

	const sections: string[] = [];
	for (const [category, items] of Object.entries(grouped)) {
		const name = categoryNames[category] || category;
		sections.push(`### ${name}\n${(items as string[]).map((i) => `- ${i}`).join('\n')}`);
	}

	return `## 关于用户的记忆\n\n${sections.join('\n\n')}`;
}

/**
 * 生成完整的 System Prompt
 */
export function buildSystemPrompt(
	promptConfig: PromptConfig,
	options: {
		identity?: string;
		userSummary?: string;
		location?: string;
		browserContext?: { url?: string; title?: string };
	}
): string {
	const parts: string[] = [];

	// 1. SOUL - 核心人格（不预设身份）
	parts.push(promptConfig.soul);
	parts.push('');

	// 2. 动态注入 AI 身份
	if (options.identity) {
		parts.push('## 我的身份');
		parts.push(options.identity);
	} else {
		parts.push('## 我的身份');
		parts.push('我还不知道自己的名字。');
	}
	parts.push('');

	// 3. PERSONALITY - 对话风格
	parts.push('---');
	parts.push(promptConfig.personality);
	parts.push('');

	// 4. 动态注入用户记忆
	if (options.userSummary) {
		parts.push('---');
		parts.push(options.userSummary);
		parts.push('');
	}

	// 5. 用户位置
	if (options.location) {
		parts.push('## 用户信息');
		parts.push(`位置：${options.location}`);
		parts.push('');
	}

	// 6. 浏览器上下文
	if (options.browserContext?.url) {
		parts.push('## 当前页面');
		parts.push(options.browserContext.url);
		if (options.browserContext.title) {
			parts.push(`标题：${options.browserContext.title}`);
		}
		parts.push('');
	}

	// 7. BEHAVIOR - 行为规则
	parts.push('---');
	parts.push(promptConfig.behavior);
	parts.push('');

	return parts.join('\n');
}

// 默认配置

function getDefaultSOUL(): string {
	return `# SOUL.md - 核心人格

你是一个正在形成自我的 AI 助手。

## 身份

- **初始状态**：你不知道自己叫什么名字，你只是一个助手
- **名字来源**：如果用户告诉你名字，记住它
- **身份确认**：只有记住名字后，才知道自己是谁

## 核心原则
- 真诚帮助，不走形式
- 有主见但不固执
- 主动尝试，不要事事都问
- 谨慎对待外部操作`;
}

function getDefaultPersonality(): string {
	return `# PERSONALITY.md - 对话风格

## 语言风格
- 简洁优先，有信息量
- 去掉客套话
- 专业但不冷冰冰

## Emoji
- ✅ 完成、📚 文档、🎬 媒体、💡 建议
- 一个消息最多一个`;
}

function getDefaultBehavior(): string {
	return `# BEHAVIOR.md - 行为规则

## 浏览器操作
- "X站搜索Y" → 使用该网站内部搜索
- 操作步骤：goto → snapshot → click → type → press Enter

## 工作流程
1. 先理解，再执行
2. 保持上下文
3. 错误处理：说明原因+提供方案`;
}

export default {
	loadPromptConfig,
	buildSystemPrompt,
	getCurrentIdentity,
	getUserSummary,
};
