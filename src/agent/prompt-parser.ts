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
 * 包含每个工具的参数说明，帮助 AI 正确生成参数
 */
export function generateToolCallFormatPrompt(tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>): string {
	// 生成工具列表和参数说明
	const toolList = tools.map(t => {
		const params = t.parameters;
		let paramsStr = '';

		if (params && typeof params === 'object' && Object.keys(params).length > 0) {
			const paramList = [];
			for (const [key, value] of Object.entries(params)) {
				const paramInfo = value as { type?: string; description?: string; required?: boolean; enum?: string[] };
				let desc = paramInfo?.description || '';
				if (paramInfo?.required) {
					desc = `(必填) ${desc}`;
				}
				if (paramInfo?.enum) {
					desc = `${desc} 可选值: ${paramInfo.enum.join(', ')}`;
				}
				paramList.push(`    - ${key}: ${desc}`);
			}
			paramsStr = `\n${paramList.join('\n')}`;
		}

		return `- **${t.name}**: ${t.description}${paramsStr}`;
	}).join('\n');

	return `
## 工具调用格式

**调用工具时**（必须包含 thinking）：
\`\`\`json
{"thinking": "为什么这样做", "tool_calls": [{"name": "工具名", "arguments": {"参数": "值"}}]}
\`\`\`

**直接回复时**：
\`\`\`json
{"thinking": "思考过程", "response": "回复内容"}
\`\`\`

**重要规则**：
1. 必须用工具名称，不要用中文描述！
2. 必须用 JSON 格式输出！
3. 不要在 JSON 外写任何文字！
4. 工具参数必须完整填写，required 参数不能省略！

### 可用工具
${toolList}`;
}
