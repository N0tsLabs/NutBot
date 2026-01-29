/**
 * Tool 注册表
 * 管理所有可用工具的注册和查找
 */

import { logger } from '../utils/logger.js';
import type { Gateway } from '../gateway/index.js';
import type { ToolSchema, ToolExecuteResult } from '../types/index.js';

interface ParameterSchema {
	type: string;
	description?: string;
	required?: boolean;
	enum?: string[];
	default?: unknown;
	items?: { type: string }; // 用于 array 类型
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
				items?: { type: string };
			}
		> = {};

		for (const [key, schema] of Object.entries(this.parameters)) {
			properties[key] = {
				type: schema.type,
				...(schema.description && { description: schema.description }),
				...(schema.enum && { enum: schema.enum }),
				...(schema.default !== undefined && { default: schema.default }),
				...(schema.items && { items: schema.items }), // 支持 array 类型的 items
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

	constructor(gateway: Gateway) {
		this.gateway = gateway;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		// 注册内置工具
		await this.registerBuiltinTools();

		this.logger.info(`已注册 ${this.tools.size} 个工具`);
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
