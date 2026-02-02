/**
 * MCP 工具适配器
 * 将 MCP 服务端的单个工具包装为 NutBot BaseTool，供 Agent 调用
 */

import { BaseTool } from './registry.js';
import type { McpClientManager } from '../services/mcp-client.js';
import type { McpToolInfo } from '../services/mcp-client.js';
import type { Gateway } from '../gateway/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaObject = Record<string, any>;

/**
 * 递归修复 JSON Schema，确保所有 array 类型都有 items 定义
 * 这是为了兼容 OpenAI 函数调用的严格 schema 要求
 */
function fixArraySchema(schema: SchemaObject): SchemaObject {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}

	const fixed = { ...schema };

	// 如果是数组类型但缺少 items，添加默认的 items
	if (fixed.type === 'array' && !fixed.items) {
		fixed.items = { type: 'string' }; // 默认为字符串数组
	}

	// 递归处理 items
	if (fixed.items) {
		fixed.items = fixArraySchema(fixed.items);
	}

	// 递归处理 properties
	if (fixed.properties && typeof fixed.properties === 'object') {
		const fixedProps: SchemaObject = {};
		for (const [key, value] of Object.entries(fixed.properties)) {
			fixedProps[key] = fixArraySchema(value as SchemaObject);
		}
		fixed.properties = fixedProps;
	}

	// 递归处理 additionalProperties
	if (fixed.additionalProperties && typeof fixed.additionalProperties === 'object') {
		fixed.additionalProperties = fixArraySchema(fixed.additionalProperties);
	}

	// 递归处理 anyOf, oneOf, allOf
	for (const key of ['anyOf', 'oneOf', 'allOf']) {
		if (Array.isArray(fixed[key])) {
			fixed[key] = fixed[key].map((item: SchemaObject) => fixArraySchema(item));
		}
	}

	return fixed;
}

function jsonSchemaToParams(schema: McpToolInfo['inputSchema']): Record<string, { type: string; description?: string; required?: boolean; items?: SchemaObject }> {
	const props = schema.properties || {};
	const required = new Set(schema.required || []);
	const out: Record<string, { type: string; description?: string; required?: boolean; items?: SchemaObject }> = {};
	
	for (const [k, v] of Object.entries(props)) {
		const prop = fixArraySchema(v as SchemaObject);
		out[k] = {
			type: prop.type || 'string',
			description: prop.description,
			required: required.has(k),
			...(prop.items && { items: prop.items }),
			...(prop.enum && { enum: prop.enum }),
		};
	}
	return out;
}

export class McpToolAdapter extends BaseTool {
	constructor(
		private mcpManager: McpClientManager,
		info: McpToolInfo,
		gateway?: Gateway
	) {
		const toolName = `mcp_${info.serverName}_${info.name}`;
		const params = jsonSchemaToParams(info.inputSchema);
		super({
			name: toolName,
			description: info.description || `MCP[${info.serverName}] ${info.name}`,
			parameters: { ...params },
			gateway,
		});
		this.mcpManager = mcpManager;
		this.serverName = info.serverName;
		this.toolName = info.name;
	}

	private serverName: string;
	private toolName: string;

	async execute(params: Record<string, unknown>, _context: Record<string, unknown> = {}): Promise<unknown> {
		return this.mcpManager.callTool(this.serverName, this.toolName, params);
	}
}
