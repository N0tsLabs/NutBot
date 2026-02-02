/**
 * Prompt JSON 解析器
 * 解析 AI 以 JSON 格式返回的工具调用
 */

import { logger } from '../utils/logger.js';

const log = logger.child('PromptParser');

export interface ParsedToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

export interface ParsedResponse {
	thinking: string;
	toolCalls: ParsedToolCall[];
	response: string | null;
	raw: string;
}

/**
 * 从 AI 响应中提取 JSON
 */
function extractJSON(text: string): string | null {
	// 尝试多种方式提取 JSON

	// 1. 尝试直接解析整个文本
	try {
		JSON.parse(text.trim());
		return text.trim();
	} catch {
		// 继续尝试其他方式
	}

	// 2. 查找 ```json ... ``` 代码块
	const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (jsonBlockMatch) {
		return jsonBlockMatch[1].trim();
	}

	// 3. 查找 { ... } 块（贪婪匹配最外层）
	const braceMatch = text.match(/\{[\s\S]*\}/);
	if (braceMatch) {
		// 验证是否为有效 JSON
		try {
			JSON.parse(braceMatch[0]);
			return braceMatch[0];
		} catch {
			// 尝试修复常见问题
			let fixed = braceMatch[0];
			// 移除尾部多余的逗号
			fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
			try {
				JSON.parse(fixed);
				return fixed;
			} catch {
				// 继续
			}
		}
	}

	return null;
}

/**
 * 解析 AI 响应
 */
export function parsePromptResponse(text: string): ParsedResponse {
	const result: ParsedResponse = {
		thinking: '',
		toolCalls: [],
		response: null,
		raw: text,
	};

	if (!text || !text.trim()) {
		return result;
	}

	// 尝试提取 JSON
	const jsonStr = extractJSON(text);

	if (!jsonStr) {
		// 没有找到 JSON，整个文本作为响应
		log.debug('未找到 JSON，作为纯文本响应处理');
		result.response = text.trim();
		return result;
	}

	try {
		const parsed = JSON.parse(jsonStr);

		// 提取 thinking
		if (parsed.thinking) {
			result.thinking = String(parsed.thinking);
		}

		// 提取 tool_calls
		if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
			for (const tc of parsed.tool_calls) {
				if (tc.name) {
					result.toolCalls.push({
						name: String(tc.name),
						arguments: tc.arguments || tc.args || tc.params || {},
					});
				}
			}
		}
		// 兼容单个工具调用
		else if (parsed.tool_call && parsed.tool_call.name) {
			result.toolCalls.push({
				name: String(parsed.tool_call.name),
				arguments: parsed.tool_call.arguments || parsed.tool_call.args || {},
			});
		}
		// 兼容简化格式
		else if (parsed.tool && parsed.tool.name) {
			result.toolCalls.push({
				name: String(parsed.tool.name),
				arguments: parsed.tool.arguments || parsed.tool.args || {},
			});
		}

		// 提取 response
		if (parsed.response) {
			result.response = String(parsed.response);
		} else if (parsed.message) {
			result.response = String(parsed.message);
		} else if (parsed.content) {
			result.response = String(parsed.content);
		} else if (parsed.answer) {
			result.response = String(parsed.answer);
		}

		log.debug(`解析成功: thinking=${result.thinking.length}字, tools=${result.toolCalls.length}, response=${result.response?.length || 0}字`);

	} catch (e) {
		log.warn(`JSON 解析失败: ${e}`);
		// 解析失败，整个文本作为响应
		result.response = text.trim();
	}

	return result;
}

/**
 * 生成工具调用格式的 System Prompt 部分
 */
export function generateToolCallFormatPrompt(tools: Array<{ name: string; description: string; parameters: unknown }>): string {
	const toolList = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');
	
	const toolSchemas = tools.map(t => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	}));

	return `
## 工具调用格式

你可以使用以下工具来完成任务。当需要调用工具时，**必须**按照指定的 JSON 格式输出。

### 可用工具
${toolList}

### 工具 Schema
\`\`\`json
${JSON.stringify(toolSchemas, null, 2)}
\`\`\`

### 输出格式要求

**重要**：你的每次响应都必须是一个有效的 JSON 对象，格式如下：

#### 需要调用工具时：
\`\`\`json
{
  "thinking": "简短描述你的思考过程，为什么要执行这个操作",
  "tool_calls": [
    {
      "name": "工具名称",
      "arguments": {
        "参数名": "参数值"
      }
    }
  ]
}
\`\`\`

#### 直接回复用户时（不需要工具）：
\`\`\`json
{
  "thinking": "简短描述你的思考过程",
  "response": "你要回复给用户的内容"
}
\`\`\`

### 注意事项
1. **必须**输出有效的 JSON 格式
2. **每次响应只能选择一种**：要么调用工具（tool_calls），要么直接回复（response）
3. thinking 字段**必填**，用于展示你的思考过程
4. 可以一次调用多个工具，按顺序执行
5. 工具参数必须符合 Schema 定义的类型
6. 不要在 JSON 外添加任何其他文字
`;
}
