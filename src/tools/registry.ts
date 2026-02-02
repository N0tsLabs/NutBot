/**
 * Tool 注册表
 * 管理所有可用工具的注册和查找
 */

import { logger } from '../utils/logger.js';
import type { Gateway } from '../gateway/index.js';
import type { ToolSchema, ToolExecuteResult } from '../types/index.js';

interface ArrayItemSchema {
	type: string;
	items?: ArrayItemSchema; // 支持嵌套数组
}

interface ParameterSchema {
	type: string;
	description?: string;
	required?: boolean;
	enum?: string[];
	default?: unknown;
	items?: ArrayItemSchema; // 用于 array 类型，支持嵌套
}

interface ToolConfig {
	name?: string;
	description?: string;
	parameters?: Record<string, ParameterSchema>;
	enabled?: boolean;
	gateway?: Gateway;
}

/**
 * Tool 基类
 */
export class BaseTool {
	name: string;
	description: string;
	parameters: Record<string, ParameterSchema>;
	enabled: boolean;
	protected logger: ReturnType<typeof logger.child>;

	constructor(config: ToolConfig = {}) {
		this.name = config.name || this.constructor.name;
		this.description = config.description || '';
		this.parameters = config.parameters || {};
		this.enabled = config.enabled !== false;
		this.logger = logger.child(`Tool:${this.name}`);
	}

	/**
	 * 递归修复 schema，确保所有 array 类型都有 items
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private fixSchemaItems(schema: any): any {
		if (!schema || typeof schema !== 'object') return schema;

		const fixed = { ...schema };

		// 数组类型必须有 items
		if (fixed.type === 'array' && !fixed.items) {
			fixed.items = { type: 'string' };
		}

		// 递归处理 items
		if (fixed.items) {
			fixed.items = this.fixSchemaItems(fixed.items);
		}

		// 递归处理 properties
		if (fixed.properties && typeof fixed.properties === 'object') {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const fixedProps: Record<string, any> = {};
			for (const [k, v] of Object.entries(fixed.properties)) {
				fixedProps[k] = this.fixSchemaItems(v);
			}
			fixed.properties = fixedProps;
		}

		return fixed;
	}

	/**
	 * 获取工具 Schema（用于 AI 调用）
	 */
	getSchema(): ToolSchema {
		// 清理 properties，移除非标准的 required 字段
		const properties: Record<
			string,
			{
				type: string;
				description?: string;
				enum?: string[];
				default?: unknown;
				items?: ArrayItemSchema;
			}
		> = {};

		for (const [key, schema] of Object.entries(this.parameters)) {
			// 修复可能缺少 items 的数组 schema
			const fixedSchema = this.fixSchemaItems(schema);
			
			properties[key] = {
				type: fixedSchema.type,
				...(fixedSchema.description && { description: fixedSchema.description }),
				...(fixedSchema.enum && { enum: fixedSchema.enum }),
				...(fixedSchema.default !== undefined && { default: fixedSchema.default }),
				...(fixedSchema.items && { items: fixedSchema.items }), // 支持 array 类型的 items（含嵌套）
			};
		}

		// required 字段必须是数组，放在 parameters 级别
		const required = Object.entries(this.parameters)
			.filter(([_, v]) => v.required)
			.map(([k]) => k);

		return {
			name: this.name,
			description: this.description,
			parameters: {
				type: 'object',
				properties,
				...(required.length > 0 && { required }),
			},
		};
	}

	/**
	 * 执行工具
	 */
	async execute(params: Record<string, unknown>, context: Record<string, unknown> = {}): Promise<unknown> {
		throw new Error('Method not implemented: execute');
	}

	/**
	 * 验证参数
	 */
	validateParams(params: Record<string, unknown>): boolean {
		const errors: string[] = [];

		for (const [key, schema] of Object.entries(this.parameters)) {
			const value = params[key];

			// 检查必填
			if (schema.required && (value === undefined || value === null)) {
				errors.push(`Missing required parameter: ${key}`);
				continue;
			}

			// 检查类型
			if (value !== undefined && schema.type) {
				const actualType = Array.isArray(value) ? 'array' : typeof value;
				if (actualType !== schema.type) {
					errors.push(`Invalid type for ${key}: expected ${schema.type}, got ${actualType}`);
				}
			}

			// 检查枚举
			if (value !== undefined && schema.enum && !schema.enum.includes(value as string)) {
				errors.push(`Invalid value for ${key}: must be one of ${schema.enum.join(', ')}`);
			}
		}

		if (errors.length > 0) {
			throw new Error(`Parameter validation failed: ${errors.join('; ')}`);
		}

		return true;
	}

	/**
	 * 获取工具信息
	 */
	getInfo(): {
		name: string;
		description: string;
		enabled: boolean;
		parameters: Record<string, ParameterSchema>;
	} {
		return {
			name: this.name,
			description: this.description,
			enabled: this.enabled,
			parameters: this.parameters,
		};
	}

	/**
	 * 清理资源
	 */
	async cleanup(): Promise<void> {
		// 子类可以重写
	}
}

/**
 * Tool 注册表
 */
export class ToolRegistry {
	private gateway: Gateway;
	private tools: Map<string, BaseTool> = new Map();
	private logger = logger.child('ToolRegistry');
	private mcpManager: import('../services/mcp-client.js').McpClientManager | null = null;

	constructor(gateway: Gateway) {
		this.gateway = gateway;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		// 注册内置工具
		await this.registerBuiltinTools();

		// 注册 MCP 工具（若配置启用且有 servers）
		await this.registerMcpTools();

		this.logger.info(`已注册 ${this.tools.size} 个工具`);
	}

	/**
	 * 注册 MCP 服务端暴露的工具
	 */
	private async registerMcpTools(): Promise<void> {
		const enabled = this.gateway.config.get<boolean>('mcp.enabled', false);
		const servers = this.gateway.config.get<Array<{ name: string; command?: string; args?: string[]; url?: string }>>('mcp.servers', []);
		if (!enabled || !Array.isArray(servers) || servers.length === 0) return;

		try {
			const { McpClientManager } = await import('../services/mcp-client.js');
			const { McpToolAdapter } = await import('./mcp-adapter.js');
			this.mcpManager = new McpClientManager(this.gateway.config, this.logger);
			const tools = await this.mcpManager.init();
			for (const info of tools) {
				const adapter = new McpToolAdapter(this.mcpManager, info, this.gateway);
				this.register(adapter);
			}
		} catch (e) {
			this.logger.warn('MCP 工具注册失败:', (e as Error).message);
		}
	}

	/**
	 * 重新加载 MCP 工具（热重载）
	 */
	async reloadMcpTools(): Promise<{ added: string[]; removed: string[]; total: number }> {
		// 1. 关闭现有 MCP 连接
		if (this.mcpManager) {
			await this.mcpManager.close();
			this.mcpManager = null;
		}

		// 2. 移除所有 MCP 工具
		const removedTools: string[] = [];
		for (const [name, tool] of this.tools) {
			if (name.startsWith('mcp_')) {
				this.tools.delete(name);
				removedTools.push(name);
			}
		}

		// 3. 重新加载 MCP 配置
		this.gateway.config.reload();

		// 4. 重新注册 MCP 工具
		const addedTools: string[] = [];
		const enabled = this.gateway.config.get<boolean>('mcp.enabled', false);
		const servers = this.gateway.config.get<Array<{ name: string; command?: string; args?: string[]; url?: string }>>('mcp.servers', []);

		if (enabled && Array.isArray(servers) && servers.length > 0) {
			try {
				const { McpClientManager } = await import('../services/mcp-client.js');
				const { McpToolAdapter } = await import('./mcp-adapter.js');
				this.mcpManager = new McpClientManager(this.gateway.config, this.logger);
				const tools = await this.mcpManager.init();
				for (const info of tools) {
					const adapter = new McpToolAdapter(this.mcpManager, info, this.gateway);
					this.register(adapter);
					addedTools.push(adapter.name);
				}
			} catch (e) {
				this.logger.warn('MCP 工具重载失败:', (e as Error).message);
			}
		}

		this.logger.info(`MCP 工具已重载: 移除 ${removedTools.length} 个，添加 ${addedTools.length} 个`);

		return {
			added: addedTools,
			removed: removedTools,
			total: addedTools.length,
		};
	}

	/**
	 * 注册内置工具
	 */
	private async registerBuiltinTools(): Promise<void> {
		const config = this.gateway.config;
		const toolsConfig = config.get<Record<string, ToolConfig>>('tools', {});

		// 动态导入内置工具
		const builtinTools = [
			{ name: 'exec', module: './exec.js' }, // 命令执行
			{ name: 'screenshot', module: './screenshot.js' }, // 屏幕截图
			{ name: 'computer', module: './computer.js' }, // 鼠标键盘控制（桌面操作）
			{ name: 'browser', module: './browser.js' }, // Playwright 浏览器控制
			{ name: 'web', module: './web.js' }, // 网页获取
			{ name: 'file', module: './file.js' }, // 文件操作
			{ name: 'office', module: './office.js' }, // Office 文档（Excel/Word/PDF）
			{ name: 'clipboard', module: './clipboard.js' }, // 剪贴板操作
			{ name: 'http', module: './http.js' }, // HTTP 请求
			{ name: 'notify', module: './notify.js' }, // 系统通知
			{ name: 'window', module: './window.js' }, // 窗口管理
			{ name: 'system_info', module: './system-info.js' }, // 系统信息（公网IP等）
		];

		for (const { name, module } of builtinTools) {
			const toolConfig = toolsConfig[name] || {};

			if (toolConfig.enabled === false) {
				this.logger.debug(`工具 ${name} 已禁用`);
				continue;
			}

			try {
				const { default: ToolClass } = await import(module);
				const tool = new ToolClass({
					...toolConfig,
					gateway: this.gateway,
				});
				this.register(tool);
			} catch (error) {
				this.logger.warn(`加载工具 ${name} 失败:`, (error as Error).message);
			}
		}
	}

	/**
	 * 注册工具
	 */
	register(tool: BaseTool): void {
		if (!(tool instanceof BaseTool)) {
			throw new Error('Tool must extend BaseTool');
		}

		this.tools.set(tool.name, tool);
		this.logger.debug(`已注册工具: ${tool.name}`);
	}

	/**
	 * 注销工具
	 */
	unregister(name: string): void {
		this.tools.delete(name);
	}

	/**
	 * 获取工具
	 */
	getTool(name: string): BaseTool | undefined {
		return this.tools.get(name);
	}

	/**
	 * 列出所有工具
	 */
	listTools(): ReturnType<BaseTool['getInfo']>[] {
		return Array.from(this.tools.values())
			.filter((t) => t.enabled)
			.map((t) => t.getInfo());
	}

	/**
	 * 列出所有工具（分类）
	 */
	listToolsGrouped(): {
		builtin: ReturnType<BaseTool['getInfo']>[];
		mcp: ReturnType<BaseTool['getInfo']>[];
	} {
		const builtin: ReturnType<BaseTool['getInfo']>[] = [];
		const mcp: ReturnType<BaseTool['getInfo']>[] = [];

		for (const tool of this.tools.values()) {
			if (!tool.enabled) continue;
			const info = tool.getInfo();

			// MCP 工具名称以 mcp_ 开头
			if (tool.name.startsWith('mcp_')) {
				mcp.push(info);
			} else {
				builtin.push(info);
			}
		}

		return { builtin, mcp };
	}

	/**
	 * 获取所有工具的 Schema（用于 AI）
	 */
	getToolSchemas(): ToolSchema[] {
		return Array.from(this.tools.values())
			.filter((t) => t.enabled)
			.map((t) => t.getSchema());
	}

	/**
	 * 执行工具
	 */
	async execute(
		name: string,
		params: Record<string, unknown>,
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const tool = this.tools.get(name);

		if (!tool) {
			throw new Error(`Tool not found: ${name}`);
		}

		if (!tool.enabled) {
			throw new Error(`Tool is disabled: ${name}`);
		}

		// 验证参数
		tool.validateParams(params);

		// 执行工具
		this.logger.debug(`执行工具: ${name}`, params);
		const result = await tool.execute(params, {
			...context,
			gateway: this.gateway,
		});

		return result;
	}

	/**
	 * 清理资源
	 */
	async cleanup(): Promise<void> {
		if (this.mcpManager) {
			await this.mcpManager.close();
			this.mcpManager = null;
		}
		for (const tool of this.tools.values()) {
			await tool.cleanup();
		}
	}

	/**
	 * 清理指定工具的资源
	 */
	async cleanupTool(name: string): Promise<void> {
		const tool = this.tools.get(name);
		if (tool) {
			await tool.cleanup();
		}
	}
}

export default ToolRegistry;
