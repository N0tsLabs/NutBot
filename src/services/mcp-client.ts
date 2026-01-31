/**
 * MCP 客户端管理
 * 连接配置中的 MCP 服务端，列出并调用工具
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '../types/index.js';

export interface McpConfigLike {
	get<T>(key: string, defaultValue?: T): T;
}

export interface McpToolInfo {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

interface ServerConnection {
	client: Client;
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	tools: McpToolInfo[];
}

export class McpClientManager {
	private config: McpConfigLike;
	private servers = new Map<string, ServerConnection>();
	private logger: { info: (s: string) => void; warn: (s: string) => void } = console;

	constructor(config: McpConfigLike, logger?: { info: (s: string) => void; warn: (s: string) => void }) {
		this.config = config;
		if (logger) this.logger = logger as unknown as Console;
	}

	async init(): Promise<McpToolInfo[]> {
		const enabled = this.config.get<boolean>('mcp.enabled', false);
		const serverList = this.config.get<McpServerConfig[]>('mcp.servers', []);
		if (!enabled || !Array.isArray(serverList) || serverList.length === 0) {
			return [];
		}

		const allTools: McpToolInfo[] = [];

		for (const server of serverList) {
			const name = server.name || 'default';
			try {
				const transport = this.createTransport(server);
				const client = new Client(
					{ name: 'nutbot', version: '0.1.0' },
					{ capabilities: {} }
				);
				await client.connect(transport);
				const res = await client.listTools();
				const tools: McpToolInfo[] = (res.tools || []).map((t: { name: string; description?: string; inputSchema?: McpToolInfo['inputSchema'] }) => ({
					serverName: name,
					name: t.name,
					description: t.description,
					inputSchema: t.inputSchema || { type: 'object', properties: {} },
				}));
				this.servers.set(name, { client, transport, tools });
				allTools.push(...tools);
				this.logger.info(`MCP 已连接: ${name}，${tools.length} 个工具`);
			} catch (e) {
				this.logger.warn(`MCP 连接失败 ${name}: ${(e as Error).message}`);
			}
		}

		return allTools;
	}

	private createTransport(server: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport {
		if (server.url) {
			return new StreamableHTTPClientTransport(new URL(server.url));
		}
		if (server.command) {
			return new StdioClientTransport({
				command: server.command,
				args: server.args || [],
				env: server.env,
			});
		}
		throw new Error(`MCP 配置无效: ${server.name}，需提供 command 或 url`);
	}

	async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
		const conn = this.servers.get(serverName);
		if (!conn) throw new Error(`MCP 服务未连接: ${serverName}`);
		const result = await conn.client.callTool({ name: toolName, arguments: args });
		const content = result.content;
		if (Array.isArray(content) && content.length > 0) {
			const first = content[0];
			if (first && typeof first === 'object' && 'text' in first) return (first as { text: string }).text;
			if (result.structuredContent !== undefined) return result.structuredContent;
		}
		return result;
	}

	getAllTools(): McpToolInfo[] {
		const out: McpToolInfo[] = [];
		for (const conn of this.servers.values()) out.push(...conn.tools);
		return out;
	}

	async close(): Promise<void> {
		for (const [name, conn] of this.servers) {
			try {
				await (conn.transport as { close?: () => Promise<void> }).close?.();
			} catch {
				// ignore
			}
			this.servers.delete(name);
		}
	}
}
