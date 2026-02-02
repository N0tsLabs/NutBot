/**
 * Agent Profile 管理器
 * 负责 Agent 配置的 CRUD、导入导出
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import type { AgentProfile, AgentExportData } from '../types/index.js';

const AGENTS_FILE = path.join(os.homedir(), '.nutbot', 'agents.json');

// 内置默认 Agent
const DEFAULT_AGENT: AgentProfile = {
	id: 'default',
	name: '通用助手',
	icon: '🤖',
	description: '全能型 AI 助手，可执行各类任务',
	maxIterations: 30,
	timeout: 300000,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	isBuiltin: true,
};

interface AgentsData {
	agents: AgentProfile[];
	currentId: string;
}

export class AgentProfileManager {
	private agents: Map<string, AgentProfile> = new Map();
	private currentId: string = 'default';
	private logger = logger.child('AgentProfiles');

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		await this.load();
		this.logger.info(`已加载 ${this.agents.size} 个 Agent 配置`);
	}

	/**
	 * 从文件加载 Agent 配置
	 */
	private async load(): Promise<void> {
		try {
			// 确保目录存在
			await fs.ensureDir(path.dirname(AGENTS_FILE));

			if (await fs.pathExists(AGENTS_FILE)) {
				const data: AgentsData = await fs.readJson(AGENTS_FILE);
				this.agents.clear();

				// 查找已保存的默认 Agent
				const savedDefault = (data.agents || []).find(a => a.id === 'default');
				
				if (savedDefault) {
					// 合并默认 Agent 的基础属性和用户修改的属性
					this.agents.set(DEFAULT_AGENT.id, {
						...DEFAULT_AGENT,
						...savedDefault,
						// 确保这些字段不被覆盖
						id: DEFAULT_AGENT.id,
						name: DEFAULT_AGENT.name,
						icon: DEFAULT_AGENT.icon,
						description: DEFAULT_AGENT.description,
						isBuiltin: true,
					});
				} else {
					this.agents.set(DEFAULT_AGENT.id, DEFAULT_AGENT);
				}

				// 加载其他 Agent
				for (const agent of data.agents || []) {
					if (agent.id !== 'default') {
						this.agents.set(agent.id, agent);
					}
				}

				this.currentId = data.currentId || 'default';
			} else {
				// 首次运行，创建默认配置
				this.agents.set(DEFAULT_AGENT.id, DEFAULT_AGENT);
				this.currentId = 'default';
				await this.save();
			}
		} catch (error) {
			this.logger.error('加载 Agent 配置失败:', error);
			// 使用默认配置
			this.agents.set(DEFAULT_AGENT.id, DEFAULT_AGENT);
			this.currentId = 'default';
		}
	}

	/**
	 * 保存 Agent 配置到文件
	 */
	private async save(): Promise<void> {
		const data: AgentsData = {
			agents: Array.from(this.agents.values()),
			currentId: this.currentId,
		};

		await fs.ensureDir(path.dirname(AGENTS_FILE));
		await fs.writeJson(AGENTS_FILE, data, { spaces: 2 });
	}

	/**
	 * 获取所有 Agent 列表
	 */
	list(): AgentProfile[] {
		return Array.from(this.agents.values());
	}

	/**
	 * 获取单个 Agent
	 */
	get(id: string): AgentProfile | undefined {
		return this.agents.get(id);
	}

	/**
	 * 获取当前选中的 Agent
	 */
	getCurrent(): AgentProfile {
		return this.agents.get(this.currentId) || DEFAULT_AGENT;
	}

	/**
	 * 获取当前选中的 Agent ID
	 */
	getCurrentId(): string {
		return this.currentId;
	}

	/**
	 * 设置当前 Agent
	 */
	async setCurrent(id: string): Promise<void> {
		if (!this.agents.has(id)) {
			throw new Error(`Agent 不存在: ${id}`);
		}
		this.currentId = id;
		await this.save();
	}

	/**
	 * 创建新 Agent
	 */
	async create(data: Partial<AgentProfile>): Promise<AgentProfile> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		const agent: AgentProfile = {
			id,
			name: data.name || '新建 Agent',
			description: data.description,
			icon: data.icon || '🤖',
			model: data.model,
			temperature: data.temperature,
			maxTokens: data.maxTokens,
			systemPrompt: data.systemPrompt,
			maxIterations: data.maxIterations ?? 30,
			timeout: data.timeout ?? 300000,
			tools: data.tools,
			createdAt: now,
			updatedAt: now,
			isBuiltin: false,
		};

		this.agents.set(id, agent);
		await this.save();

		this.logger.info(`创建 Agent: ${agent.name} (${id})`);
		return agent;
	}

	/**
	 * 更新 Agent
	 */
	async update(id: string, data: Partial<AgentProfile>): Promise<AgentProfile> {
		const existing = this.agents.get(id);
		if (!existing) {
			throw new Error(`Agent 不存在: ${id}`);
		}

		// 内置 Agent 只能修改部分属性
		if (existing.isBuiltin) {
			const allowed = ['model', 'temperature', 'maxTokens', 'systemPrompt', 'maxIterations', 'timeout', 'tools'];
			const filtered: Partial<AgentProfile> = {};
			for (const key of allowed) {
				if (key in data) {
					(filtered as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
				}
			}
			data = filtered;
		}

		const updated: AgentProfile = {
			...existing,
			...data,
			id, // ID 不可修改
			isBuiltin: existing.isBuiltin, // 内置标记不可修改
			createdAt: existing.createdAt, // 创建时间不可修改
			updatedAt: new Date().toISOString(),
		};

		this.agents.set(id, updated);
		await this.save();

		this.logger.info(`更新 Agent: ${updated.name} (${id})`);
		return updated;
	}

	/**
	 * 删除 Agent
	 */
	async delete(id: string): Promise<void> {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent 不存在: ${id}`);
		}

		if (agent.isBuiltin) {
			throw new Error('不能删除内置 Agent');
		}

		this.agents.delete(id);

		// 如果删除的是当前选中的，切换到默认
		if (this.currentId === id) {
			this.currentId = 'default';
		}

		await this.save();
		this.logger.info(`删除 Agent: ${agent.name} (${id})`);
	}

	/**
	 * 复制 Agent
	 */
	async duplicate(id: string): Promise<AgentProfile> {
		const source = this.agents.get(id);
		if (!source) {
			throw new Error(`Agent 不存在: ${id}`);
		}

		const newAgent = await this.create({
			...source,
			name: `${source.name} (副本)`,
		});

		this.logger.info(`复制 Agent: ${source.name} -> ${newAgent.name}`);
		return newAgent;
	}

	/**
	 * 导出 Agent
	 */
	export(id: string): AgentExportData {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Agent 不存在: ${id}`);
		}

		// 移除不需要导出的字段
		const { id: _id, createdAt: _c, updatedAt: _u, isBuiltin: _b, ...exportData } = agent;

		return {
			version: 1,
			agent: exportData,
		};
	}

	/**
	 * 导入 Agent
	 */
	async import(data: AgentExportData): Promise<AgentProfile> {
		if (!data.version || !data.agent) {
			throw new Error('无效的 Agent 配置文件');
		}

		if (data.version !== 1) {
			throw new Error(`不支持的版本: ${data.version}`);
		}

		const agent = await this.create({
			...data.agent,
			name: data.agent.name || '导入的 Agent',
		});

		this.logger.info(`导入 Agent: ${agent.name}`);
		return agent;
	}

	/**
	 * 获取 Agent 配置用于运行
	 */
	getRunConfig(id?: string): {
		model?: string;
		systemPrompt?: string;
		maxIterations: number;
		timeout: number;
		temperature?: number;
		maxTokens?: number;
		tools?: { enabled?: string[]; disabled?: string[] };
	} {
		const agent = id ? this.agents.get(id) : this.getCurrent();
		if (!agent) {
			return {
				maxIterations: 30,
				timeout: 300000,
			};
		}

		return {
			model: agent.model,
			systemPrompt: agent.systemPrompt,
			maxIterations: agent.maxIterations,
			timeout: agent.timeout,
			temperature: agent.temperature,
			maxTokens: agent.maxTokens,
			tools: agent.tools,
		};
	}
}

export default AgentProfileManager;
