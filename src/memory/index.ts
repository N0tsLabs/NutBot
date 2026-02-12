/**
 * 记忆系统
 * 管理 AI 的长期记忆（参考 OpenClaw 设计）
 *
 * 记忆类型：
 * - identity: AI 自己的身份（名字等）
 * - preference: 用户偏好
 * - habit: 使用习惯
 * - fact: 关于用户的事实信息
 * - instruction: 用户的指令/要求
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';

export type MemoryCategory = 'identity' | 'preference' | 'habit' | 'fact' | 'instruction' | 'other';

export interface Memory {
	id: string;
	content: string;
	category: MemoryCategory;
	tags?: string[];
	createdAt: string;
	updatedAt: string;
}

export interface MemoryStore {
	memories: Memory[];
	lastUpdated: string;
}

class MemoryManager {
	private memoryPath: string;
	private store: MemoryStore;
	private log = logger.child('Memory');

	constructor() {
		const homeDir = process.env.HOME || process.env.USERPROFILE || '';
		const nutbotDir = join(homeDir, '.nutbot');

		if (!existsSync(nutbotDir)) {
			mkdirSync(nutbotDir, { recursive: true });
		}

		this.memoryPath = join(nutbotDir, 'memory.json');
		this.store = this.load();
	}

	/**
	 * 加载记忆
	 */
	private load(): MemoryStore {
		try {
			if (existsSync(this.memoryPath)) {
				const content = readFileSync(this.memoryPath, 'utf-8');
				return JSON.parse(content);
			}
		} catch (error) {
			this.log.error('加载记忆失败:', error);
		}
		return { memories: [], lastUpdated: new Date().toISOString() };
	}

	/**
	 * 保存记忆
	 */
	private save(): void {
		try {
			this.store.lastUpdated = new Date().toISOString();
			writeFileSync(this.memoryPath, JSON.stringify(this.store, null, 2), 'utf-8');
			this.log.debug('记忆已保存');
		} catch (error) {
			this.log.error('保存记忆失败:', error);
		}
	}

	/**
	 * 获取所有记忆
	 */
	list(): Memory[] {
		return this.store.memories;
	}

	/**
	 * 按类别获取记忆
	 */
	listByCategory(category: Memory['category']): Memory[] {
		return this.store.memories.filter((m) => m.category === category);
	}

	/**
	 * 获取单条记忆
	 */
	get(id: string): Memory | undefined {
		return this.store.memories.find((m) => m.id === id);
	}

	/**
	 * 添加记忆
	 */
	add(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Memory {
		const now = new Date().toISOString();
		const memory: Memory = {
			id: generateId('mem'),
			...data,
			createdAt: now,
			updatedAt: now,
		};
		this.store.memories.push(memory);
		this.save();
		this.log.info(`添加记忆: [${memory.category}] ${memory.content.substring(0, 50)}...`);
		return memory;
	}

	/**
	 * 更新记忆
	 */
	update(id: string, data: Partial<Omit<Memory, 'id' | 'createdAt'>>): Memory | null {
		const index = this.store.memories.findIndex((m) => m.id === id);
		if (index === -1) return null;

		this.store.memories[index] = {
			...this.store.memories[index],
			...data,
			updatedAt: new Date().toISOString(),
		};
		this.save();
		return this.store.memories[index];
	}

	/**
	 * 删除记忆
	 */
	delete(id: string): boolean {
		const index = this.store.memories.findIndex((m) => m.id === id);
		if (index === -1) return false;

		this.store.memories.splice(index, 1);
		this.save();
		this.log.info(`删除记忆: ${id}`);
		return true;
	}

	/**
	 * 清空所有记忆
	 */
	clear(): void {
		this.store.memories = [];
		this.save();
		this.log.info('已清空所有记忆');
	}

	/**
	 * 搜索记忆
	 */
	search(query: string): Memory[] {
		const lowerQuery = query.toLowerCase();
		return this.store.memories.filter(
			(m) =>
				m.content.toLowerCase().includes(lowerQuery) ||
				m.tags?.some((t) => t.toLowerCase().includes(lowerQuery))
		);
	}

	/**
	 * 获取 AI 自己的身份记忆（名字等）
	 */
	getIdentity(): Memory | undefined {
		return this.store.memories.find((m) => m.category === 'identity');
	}

	/**
	 * 设置/更新 AI 身份
	 */
	setIdentity(name: string): Memory {
		// 删除旧的身份记忆
		const existing = this.getIdentity();
		if (existing) {
			this.delete(existing.id);
		}

		// 添加新的身份记忆
		return this.add({
			content: `我叫 ${name}`,
			category: 'identity',
			tags: ['名字', '身份'],
		});
	}

	/**
	 * 获取用户相关的记忆（不包括 AI 自己的身份）
	 */
	getUserMemories(): Memory[] {
		return this.store.memories.filter((m) => m.category !== 'identity');
	}

	/**
	 * 生成用户记忆摘要（用于 AI prompt）
	 */
	getUserSummary(): string {
		const userMemories = this.getUserMemories();
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
			sections.push(`### ${name}\n${items.map((i) => `- ${i}`).join('\n')}`);
		}

		return `## 关于用户的记忆\n\n${sections.join('\n\n')}`;
	}

	/**
	 * 生成 AI 身份摘要（用于 AI prompt）
	 */
	getIdentitySummary(): string {
		const identity = this.getIdentity();
		if (identity) {
			return `## 我的身份\n${identity.content}`;
		}
		return '';
	}
}

export const memoryManager = new MemoryManager();
export default memoryManager;
