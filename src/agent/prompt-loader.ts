/**
 * Prompt 加载器
 * 从配置文件读取 AI 行为定义
 * 架构：SYSTEM.md + 动态工具描述 + 动态身份配置
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Memory, MemoryStore } from '../memory/index.js';
import type { ToolSchema } from '../types/index.js';
import { generateToolsDescription, generateMethodsCheatSheet } from '../tools/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../config/prompts');

// ============================================================================
// 接口定义
// ============================================================================

/**
 * Agent 提示词上下文
 * 用于构建运行时动态提示词
 */
export interface PromptContext {
	/** 用户任务描述 */
	task: string;
	/** 当前页面状态（从 state() 获取的元素列表） */
	currentState: string;
	/** 操作历史记录 */
	actionHistory: string;
	/** 搜索任务指引（可选，用于特定搜索场景） */
	searchGuidance?: string;
	/** 工具 schemas（用于动态生成工具描述） */
	toolSchemas?: ToolSchema[];
}

/**
 * 自定义身份配置
 */
export interface CustomIdentity {
	name: string;
	personality: string;
	style: string;
	enabled: boolean;
}

// ============================================================================
// 文件读取工具函数
// ============================================================================

/**
 * 读取文件内容（不存在则返回 null）
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
 * 获取 NutBot 配置目录
 */
function getNutBotDir(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || '';
	return join(homeDir, '.nutbot');
}

/**
 * 获取 persona.json 路径
 */
function getPersonaPath(): string {
	return join(getNutBotDir(), 'persona.json');
}

// ============================================================================
// 身份管理
// ============================================================================

/**
 * 加载自定义身份配置
 */
export function loadCustomIdentity(): CustomIdentity | null {
	try {
		const path = getPersonaPath();
		if (existsSync(path)) {
			const content = readFileSync(path, 'utf-8');
			return JSON.parse(content);
		}
	} catch {
		// 忽略错误
	}
	return null;
}

/**
 * 保存自定义身份配置
 */
export function saveCustomIdentity(identity: CustomIdentity): void {
	const nutbotDir = getNutBotDir();
	if (!existsSync(nutbotDir)) {
		mkdirSync(nutbotDir, { recursive: true });
	}
	const path = getPersonaPath();
	writeFileSync(path, JSON.stringify(identity, null, 2), 'utf-8');
}

/**
 * 重置自定义身份为默认
 */
export function resetCustomIdentity(): void {
	const path = getPersonaPath();
	if (existsSync(path)) {
		// 保留文件但标记为禁用
		const identity: CustomIdentity = {
			name: 'NutBot',
			personality: '简洁高效的浏览器自动化助手',
			style: '直接、专业、简洁',
			enabled: false,
		};
		saveCustomIdentity(identity);
	}
}

/**
 * 获取当前身份描述
 * 优先使用自定义身份，无自定义身份时返回 null
 */
export function getCurrentIdentityDescription(): string | null {
	const custom = loadCustomIdentity();

	if (custom && custom.enabled) {
		return `你是 ${custom.name}，${custom.personality}。风格特点：${custom.style}`;
	}

	// 无自定义身份时返回 null，不预设身份
	return null;
}

/**
 * 检查是否是首次对话（没有 persona.json）
 */
export function isFirstConversation(): boolean {
	return !existsSync(getPersonaPath());
}

// ============================================================================
// 加载函数
// ============================================================================

/**
 * 加载系统提示词
 * 读取 SYSTEM.md
 */
export function loadSystemPrompt(): string {
	const systemPath = join(PROMPTS_DIR, 'SYSTEM.md');
	return readFileIfExists(systemPath) || getDefaultSystem();
}

/**
 * 构建 Agent 提示词（主入口）
 * 组合 SYSTEM + 动态身份 + 动态工具描述，并注入运行时上下文
 */
export function buildAgentPrompt(context: PromptContext): string {
	const parts: string[] = [];

	// 1. SYSTEM.md - 系统提示词（核心规范）
	parts.push(loadSystemPrompt());
	parts.push('');

	// 2. 动态身份配置（如果存在）
	const identityDescription = getCurrentIdentityDescription();
	if (identityDescription) {
		parts.push('---');
		parts.push('## 当前身份');
		parts.push(identityDescription);
		parts.push('');
	}

	// 3. 动态工具描述（从 schemas 生成）
	if (context.toolSchemas && context.toolSchemas.length > 0) {
		parts.push('---');
		parts.push(generateToolsDescription(context.toolSchemas));

		// 添加方法速查表
		const methodsSheet = generateMethodsCheatSheet(context.toolSchemas);
		if (methodsSheet) {
			parts.push('\n## 预定义方法速查');
			parts.push(methodsSheet);
		}

		parts.push('');
	}

	// 4. 运行时上下文 - 用户任务
	parts.push('---');
	parts.push('## 当前任务');
	parts.push(context.task);
	parts.push('');

	// 5. 运行时上下文 - 当前页面状态
	if (context.currentState) {
		parts.push('## 当前页面状态');
		parts.push(context.currentState);
		parts.push('');
	}

	// 6. 运行时上下文 - 操作历史
	if (context.actionHistory) {
		parts.push('## 操作历史');
		parts.push(context.actionHistory);
		parts.push('');
	}

	// 7. 搜索任务指引（可选）
	if (context.searchGuidance) {
		parts.push('## 搜索指引');
		parts.push(context.searchGuidance);
		parts.push('');
	}

	return parts.join('\n');
}

// ============================================================================
// 记忆系统相关函数
// ============================================================================

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
 * @deprecated 使用 loadCustomIdentity 替代
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

// ============================================================================
// 默认配置
// ============================================================================

function getDefaultSystem(): string {
	return `# 系统约束

## 输出格式
所有响应必须是 JSON：
\`\`\`json
{
  "action": "操作名称",
  "tool": "工具名",
  "method": "方法名",
  "params": {},
  "reason": "原因",
  "done": false,
  "result": ""
}
\`\`\`

## 完成标准
done: true 时，result 必须包含具体信息，禁止"任务已完成"等废话。

## 可用方法
[由代码动态生成]
`;
}

// ============================================================================
// 导出
// ============================================================================

export default {
	buildAgentPrompt,
	loadSystemPrompt,
	getCurrentIdentity,
	getUserSummary,
	loadCustomIdentity,
	saveCustomIdentity,
	resetCustomIdentity,
	getCurrentIdentityDescription,
	isFirstConversation,
};
