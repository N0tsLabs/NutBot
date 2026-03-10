/**
 * Prompt 加载器
 * 从配置文件读取 AI 行为定义
 * 架构：SYSTEM.md + IDENTITY.md + BEHAVIOR.md
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Memory, MemoryStore } from '../memory/index.js';

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
}

/**
 * 提示词配置
 */
export interface PromptConfig {
	system: string;    // SYSTEM.md - 系统提示词（不可修改）
	identity: string;  // IDENTITY.md - 身份提示词（可修改）
	behavior: string;  // BEHAVIOR.md - 行为提示词（可修改）
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

// ============================================================================
// 加载函数
// ============================================================================

/**
 * 加载提示词配置
 * 使用 SYSTEM.md + IDENTITY.md + BEHAVIOR.md
 */
export function loadPromptConfig(): PromptConfig {
	const systemPath = join(PROMPTS_DIR, 'SYSTEM.md');
	const identityPath = join(PROMPTS_DIR, 'IDENTITY.md');
	const behaviorPath = join(PROMPTS_DIR, 'BEHAVIOR.md');

	return {
		system: readFileIfExists(systemPath) || getDefaultSystem(),
		identity: readFileIfExists(identityPath) || getDefaultIdentity(),
		behavior: readFileIfExists(behaviorPath) || getDefaultBehavior(),
	};
}

/**
 * 构建 Agent 提示词（主入口）
 * 组合 SYSTEM + IDENTITY + BEHAVIOR，并注入运行时上下文
 */
export function buildAgentPrompt(context: PromptContext): string {
	const config = loadPromptConfig();
	const parts: string[] = [];

	// 1. SYSTEM.md - 系统提示词（工具使用规范、输出格式等）
	parts.push(config.system);
	parts.push('');

	// 2. IDENTITY.md - 身份提示词（性格、风格）
	parts.push('---');
	parts.push(config.identity);
	parts.push('');

	// 3. 运行时上下文 - 用户任务
	parts.push('---');
	parts.push('## 当前任务');
	parts.push(context.task);
	parts.push('');

	// 4. 运行时上下文 - 当前页面状态
	if (context.currentState) {
		parts.push('## 当前页面状态');
		parts.push(context.currentState);
		parts.push('');
	}

	// 5. 运行时上下文 - 操作历史
	if (context.actionHistory) {
		parts.push('## 操作历史');
		parts.push(context.actionHistory);
		parts.push('');
	}

	// 6. 搜索任务指引（可选）
	if (context.searchGuidance) {
		parts.push('## 搜索指引');
		parts.push(context.searchGuidance);
		parts.push('');
	}

	// 7. BEHAVIOR.md - 行为规则（放在最后，作为执行指导）
	parts.push('---');
	parts.push(config.behavior);
	parts.push('');

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
	return `# 系统提示词

> 本文件定义了系统底层的工具使用规范和输出格式要求，不可修改。

## 工具使用规范

### Browser 工具

| 方法 | 说明 | 参数 |
|------|------|------|
| \`goto(url)\` | 访问网页 | \`url\`: 网页地址 |
| \`state()\` | 获取当前页面元素列表 | 无 |
| \`click(index)\` | 点击指定编号的元素 | \`index\`: 元素编号 |
| \`type(index, text)\` | 在指定输入框中输入文本 | \`index\`: 元素编号，\`text\`: 输入内容 |
| \`press(key)\` | 按键操作 | \`key\`: Enter, Tab, Escape 等 |
| \`scroll(direction)\` | 滚动页面 | \`direction\`: up/down |

### 使用规则

1. **必须先 \`state()\` 获取元素列表**
2. **每次操作后自动返回新状态**
3. **元素不存在时重新获取**
4. **index 是数字，从 state() 结果获取**

## JSON 输出格式

所有决策必须返回严格的 JSON 格式：

\`\`\`json
{
  "action": "操作名称",
  "tool": "browser",
  "method": "goto/state/click/type/press/scroll",
  "params": {},
  "reason": "简短说明",
  "done": false,
  "result": ""
}
\`\`\`
`;
}

function getDefaultIdentity(): string {
	return `# 身份定义

## 基本信息

- **名字**：NutBot
- **身份**：浏览器自动化智能助手

## 核心性格

- 真诚帮助，不走形式
- 有主见但不固执
- 主动尝试，不要事事都问
- 谨慎对待外部操作

## 语言风格

- 简洁优先，有信息量
- 去掉客套话
- 专业但不冷冰冰
`;
}

function getDefaultBehavior(): string {
	return `# BEHAVIOR.md - 行为规则

## 浏览器操作
- "X站搜索Y" → 使用该网站内部搜索
- 操作步骤：goto → state → click → type → press Enter

## 初始页面处理
- 如果当前页面为空白或提示"浏览器已启动"，**必须**先使用 goto 访问目标网站
- 不要重复获取空白页面的 state

## 工作流程
1. 先理解，再执行
2. 保持上下文
3. 错误处理：说明原因+提供方案`;
}

// ============================================================================
// 导出
// ============================================================================

export default {
	loadPromptConfig,
	buildAgentPrompt,
	getCurrentIdentity,
	getUserSummary,
};
