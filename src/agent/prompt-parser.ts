/**
 * Prompt JSON 解析器 - 增强版
 * 
 * 核心改进：
 * 1. 更强的 JSON 容错能力
 * 2. 多种提取方式
 * 3. 工具名验证
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
 * 提取 JSON 内容
 */
function extractJSON(text: string): string | null {
	// 1. 尝试直接解析
	try {
		const parsed = JSON.parse(text.trim());
		return text.trim();
	} catch { /* continue */ }

	// 2. 查找 ```json ... ``` 代码块
	const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (jsonBlockMatch) {
		const content = jsonBlockMatch[1].trim();
		try {
			JSON.parse(content);
			return content;
		} catch { /* continue */ }
	}

	// 3. 查找第一个 { ... } 块
	const braceMatch = text.match(/\{[\s\S]*\}/);
	if (braceMatch) {
		let content = braceMatch[0];
		
		// 修复常见问题
		content = content.replace(/,\s*([}\]])/g, '$1'); // 移除尾部逗号
		content = content.replace(/([{,]\s*)(\w+)\s*:\s*"/g, '$1"$2":"'); // 修复属性名引号
		content = content.replace(/:\s*"([^"]*)"\s*"/g, ': "$1", "'); // 修复值引号
		
		try {
			JSON.parse(content);
			return content;
		} catch { /* continue */ }
	}

	return null;
}

/**
 * 从纯文本提取工具调用
 */
function extractFromPlainText(text: string, availableTools: any[]): ParsedToolCall[] {
	const toolCalls: ParsedToolCall[] = [];

	// 工具名列表
	const toolNames = availableTools.map(t => t.name);

	// 查找 "使用 xxx 工具" 模式
	for (const name of toolNames) {
		const patterns = [
			new RegExp(`(?:使用|调用|执行|运行)\\s*[：:]*\\s*${name}\\s*(?:工具)?`, 'i'),
			new RegExp(`${name}\\s*[：:]*\\s*({[^}]*})`, 'i'),
			new RegExp(`(?:工具[：:]*)?${name}\\s*[：:]*\\s*({[^}]*})`, 'i'),
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match) {
				// 尝试提取参数
				let args = {};
				const argMatch = text.match(new RegExp(`${name}[^]*?({[^}]*})`));
				if (argMatch) {
					try {
						args = JSON.parse(argMatch[1]);
					} catch { /* ignore */ }
				}

				toolCalls.push({ name, arguments: args });
				log.debug(`从文本提取工具: ${name}`);
				break;
			}
		}
	}

	return toolCalls;
}

/**
 * 解析 AI 响应
 */
export function parsePromptResponse(
	text: string,
	availableTools: ParsedToolCall[] | any[] = []
): ParsedResponse {
	const result: ParsedResponse = {
		thinking: '',
		toolCalls: [],
		response: null,
		raw: text,
	};

	if (!text || !text.trim()) {
		return result;
	}

	// 1. 尝试提取 JSON
	const jsonStr = extractJSON(text);

	if (jsonStr) {
		try {
			const parsed = JSON.parse(jsonStr);

			// 提取 thinking
			if (parsed.thinking || parsed.thought || parsed.reasoning) {
				result.thinking = parsed.thinking || parsed.thought || parsed.reasoning || '';
			}

			// 提取工具调用（多种格式）
			const rawToolCalls = parsed.tool_calls || parsed.toolCalls || 
				parsed.tools || parsed.tool || parsed.actions || [];

			if (Array.isArray(rawToolCalls)) {
				for (const tc of rawToolCalls) {
					if (tc.name) {
						result.toolCalls.push({
							name: String(tc.name),
							arguments: tc.arguments || tc.args || tc.params || tc.input || {},
						});
					}
				}
			} else if (typeof rawToolCalls === 'object' && rawToolCalls !== null) {
				// 单个工具调用
				if (rawToolCalls.name) {
					result.toolCalls.push({
						name: String(rawToolCalls.name),
						arguments: rawToolCalls.arguments || {},
					});
				}
			}

			// 提取响应
			if (parsed.response || parsed.reply || parsed.message || 
				parsed.answer || parsed.result || parsed.content) {
				result.response = String(
					parsed.response || parsed.reply || parsed.message || 
					parsed.answer || parsed.result || parsed.content
				);
			}

			log.debug(`JSON解析成功: tools=${result.toolCalls.length}, response=${result.response?.length || 0}`);
			return result;
		} catch (e) {
			log.debug(`JSON解析失败: ${e}，尝试其他方式`);
		}
	}

	// 2. 从纯文本提取工具调用
	if (availableTools.length > 0) {
		const plainTextTools = extractFromPlainText(text, availableTools);
		if (plainTextTools.length > 0) {
			result.toolCalls = plainTextTools;
			log.debug(`从文本提取工具: ${plainTextTools.length}个`);
			return result;
		}
	}

	// 3. 没有找到工具调用，整个文本作为响应
	result.response = text.trim();
	log.debug('无工具调用，作为纯文本处理');
	return result;
}

/**
 * 生成工具调用格式的 System Prompt 部分
 */
export function generateToolCallFormatPrompt(
	tools: Array<{ name: string; description: string; parameters: any }>
): string {
	const toolList = tools.map(t => {
		const params = t.parameters;
		let paramsStr = '';

		if (params && typeof params === 'object' && Object.keys(params).length > 0) {
			const paramList = [];
			for (const [key, value] of Object.entries(params)) {
				const paramInfo = value as { type?: string; description?: string; required?: boolean; enum?: string[] };
				let desc = paramInfo?.description || '';
				if (paramInfo?.required) desc = `(必填) ${desc}`;
				if (paramInfo?.enum) desc = `${desc} 可选值: ${paramInfo.enum.join(', ')}`;
				paramList.push(`    - ${key}: ${desc}`);
			}
			if (paramList.length > 0) paramsStr = `\n${paramList.join('\n')}`;
		}

		return `- **${t.name}**: ${t.description}${paramsStr}`;
	}).join('\n');

	return `
## 工具调用格式

【调用工具时】（必须包含 thinking）：
\`\`\`json
{
  "thinking": "为什么这样做",
  "tool_calls": [
    {"name": "工具名", "arguments": {"参数": "值"}}
  ]
}
\`\`\`

【直接回复时】：
\`\`\`json
{
  "thinking": "思考过程",
  "response": "回复内容"
}
\`\`\`

【重要规则】：
1. 必须用工具名称（英文），不要用中文描述
2. 必须用 JSON 格式输出
3. 不要在 JSON 外写任何文字
4. 工具参数必须完整填写

### 可用工具
${toolList}
`;
}

export { extractJSON, extractFromPlainText };
