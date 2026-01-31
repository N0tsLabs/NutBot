/**
 * MCP 工具适配器
 * 将 MCP 服务端的单个工具包装为 NutBot BaseTool，供 Agent 调用
 */

import { BaseTool } from './registry.js';
import type { McpClientManager } from '../services/mcp-client.js';
import type { McpToolInfo } from '../services/mcp-client.js';
import type { Gateway } from '../gateway/index.js';

function jsonSchemaToParams(schema: McpToolInfo['inputSchema']): Record<string, { type: string; description?: string; required?: boolean }> {
	const props = schema.properties || {};
	const required = new Set(schema.required || []);
	const out: Record<string, { type: string; description?: string; required?: boolean }> = {};
	for (const [k, v] of Object.entries(props)) {
		const prop = v as { type?: string; description?: string };
		out[k] = {
			type: prop.type || 'string',
			description: prop.description,
			required: required.has(k),
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
