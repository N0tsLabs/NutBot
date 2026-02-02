/**
 * 配置管理器
 * 负责加载、验证、保存配置
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deepMerge } from './helpers.js';
import type { AppConfig, ProviderConfig } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 默认配置路径
const DEFAULT_CONFIG_PATH = join(__dirname, '../../config/default.json');

class ConfigManager {
	private config: AppConfig | null = null;
	private configPath: string | null = null;
	private defaultConfig: AppConfig | null = null;

	/**
	 * 初始化配置
	 */
	init(configPath: string | null = null): AppConfig {
		// 加载默认配置（深拷贝以避免引用污染）
		const loadedDefault = this.loadJSON(DEFAULT_CONFIG_PATH);
		this.defaultConfig = JSON.parse(JSON.stringify(loadedDefault)) as AppConfig;

		// 确定用户配置路径
		this.configPath = configPath || this.getDefaultUserConfigPath();
		console.log(`[Config] 用户配置路径: ${this.configPath}`);

		// 加载用户配置并合并
		let userConfig: Partial<AppConfig> = {};
		if (existsSync(this.configPath)) {
			userConfig = this.loadJSON(this.configPath) as Partial<AppConfig>;
			console.log(
				`[Config] 已加载用户配置，providers: ${Object.keys(userConfig.providers || {}).join(', ') || '无'}`
			);
		} else {
			console.log('[Config] 用户配置文件不存在，使用默认配置');
		}

		// 合并配置：默认 + 用户
		this.config = deepMerge(this.defaultConfig, userConfig) as AppConfig;

		// 确保数据目录存在
		this.ensureDirectories();

		return this.config;
	}

	/**
	 * 获取默认用户配置路径
	 */
	private getDefaultUserConfigPath(): string {
		const homeDir = process.env.HOME || process.env.USERPROFILE || '';
		const nutbotDir = join(homeDir, '.nutbot');

		if (!existsSync(nutbotDir)) {
			mkdirSync(nutbotDir, { recursive: true });
		}

		return join(nutbotDir, 'config.json');
	}

	/**
	 * 确保必要目录存在
	 */
	private ensureDirectories(): void {
		if (!this.config) return;

		const dirs = [
			this.config.data.directory,
			this.config.data.sessions,
			this.config.data.logs,
			this.config.skills.directory,
		];

		for (const dir of dirs) {
			const fullPath = this.resolvePath(dir);
			if (!existsSync(fullPath)) {
				mkdirSync(fullPath, { recursive: true });
			}
		}
	}

	/**
	 * 解析路径（支持相对路径）
	 */
	resolvePath(p: string): string {
		if (p.startsWith('./') || p.startsWith('../')) {
			const baseDir = dirname(this.configPath || '');
			return join(baseDir, p);
		}
		return p;
	}

	/**
	 * 加载 JSON 文件
	 */
	private loadJSON(filePath: string): unknown {
		try {
			const content = readFileSync(filePath, 'utf-8');
			return JSON.parse(content);
		} catch (error) {
			throw new Error(`Failed to load config from ${filePath}: ${(error as Error).message}`);
		}
	}

	/**
	 * 获取配置值
	 */
	get<T = unknown>(key: string, defaultValue?: T): T {
		const keys = key.split('.');
		let value: unknown = this.config;

		for (const k of keys) {
			if (value === null || value === undefined || typeof value !== 'object') {
				return defaultValue as T;
			}
			value = (value as Record<string, unknown>)[k];
		}

		return (value !== undefined ? value : defaultValue) as T;
	}

	/**
	 * 设置配置值
	 */
	set(key: string, value: unknown): void {
		if (!this.config) return;

		const keys = key.split('.');
		let obj: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

		for (let i = 0; i < keys.length - 1; i++) {
			const k = keys[i];
			if (!(k in obj) || typeof obj[k] !== 'object' || obj[k] === null) {
				obj[k] = {};
			}
			obj = obj[k] as Record<string, unknown>;
		}

		const lastKey = keys[keys.length - 1];
		const oldValue = obj[lastKey];
		obj[lastKey] = value;
		console.log(`[Config] 设置 ${key}: ${JSON.stringify(oldValue)} -> ${JSON.stringify(value)}`);
	}

	/**
	 * 保存配置到文件（保存所有与默认不同的配置）
	 */
	save(): void {
		if (!this.config || !this.configPath || !this.defaultConfig) {
			console.warn('[Config] 无法保存配置: 配置未初始化');
			return;
		}

		// 递归比较并保存所有与默认配置不同的部分
		const userConfig = this.getChangedConfig(
			this.defaultConfig as unknown as Record<string, unknown>,
			this.config as unknown as Record<string, unknown>
		);

		console.log('[Config] 将保存的配置:', JSON.stringify(userConfig, null, 2));

		const dir = dirname(this.configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		try {
			writeFileSync(this.configPath, JSON.stringify(userConfig, null, 2), 'utf-8');
			console.log('[Config] 已保存配置到:', this.configPath);
		} catch (error) {
			console.error('[Config] 保存配置失败:', (error as Error).message);
		}
	}

	/**
	 * 获取与默认配置不同的部分（递归比较）
	 */
	private getChangedConfig(
		defaultObj: Record<string, unknown>,
		currentObj: Record<string, unknown>
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		// 遍历当前配置的所有 key
		for (const key of Object.keys(currentObj)) {
			const defaultVal = defaultObj[key];
			const currentVal = currentObj[key];

			// 跳过 $schema
			if (key === '$schema') continue;

			// 如果默认配置中没有这个 key，直接保存
			if (defaultVal === undefined) {
				result[key] = currentVal;
				continue;
			}

			// 如果当前值是 null 或 undefined，跳过
			if (currentVal === null || currentVal === undefined) {
				continue;
			}

			// 如果是数组，比较是否相同
			if (Array.isArray(currentVal)) {
				if (JSON.stringify(currentVal) !== JSON.stringify(defaultVal)) {
					result[key] = currentVal;
				}
				continue;
			}

			// 如果是对象，递归比较
			if (typeof currentVal === 'object') {
				const nested = this.getChangedConfig(
					(defaultVal as Record<string, unknown>) || {},
					currentVal as Record<string, unknown>
				);
				// 只有当有差异时才保存
				if (Object.keys(nested).length > 0) {
					result[key] = nested;
				}
				continue;
			}

			// 基本类型，直接比较
			if (currentVal !== defaultVal) {
				result[key] = currentVal;
			}
		}

		return result;
	}

	/**
	 * 获取配置差异（用户修改的部分）
	 */
	private getDiff(defaultObj: Record<string, unknown>, currentObj: Record<string, unknown>): Record<string, unknown> {
		const diff: Record<string, unknown> = {};

		for (const key of Object.keys(currentObj)) {
			const defaultVal = defaultObj[key];
			const currentVal = currentObj[key];

			if (typeof currentVal === 'object' && currentVal !== null && !Array.isArray(currentVal)) {
				if (typeof defaultVal === 'object' && defaultVal !== null) {
					const nested = this.getDiff(
						defaultVal as Record<string, unknown>,
						currentVal as Record<string, unknown>
					);
					if (Object.keys(nested).length > 0) {
						diff[key] = nested;
					}
				} else {
					diff[key] = currentVal;
				}
			} else if (JSON.stringify(defaultVal) !== JSON.stringify(currentVal)) {
				diff[key] = currentVal;
			}
		}

		return diff;
	}

	/**
	 * 获取完整配置
	 */
	getAll(): AppConfig {
		return { ...this.config } as AppConfig;
	}

	/**
	 * 重置为默认配置
	 */
	reset(): void {
		if (this.defaultConfig) {
			this.config = deepMerge({} as AppConfig, this.defaultConfig);
		}
	}

	/**
	 * 重新加载配置（热重载）
	 */
	reload(): AppConfig {
		if (!this.configPath || !this.defaultConfig) {
			throw new Error('配置未初始化');
		}

		// 重新加载用户配置
		let userConfig: Partial<AppConfig> = {};
		if (existsSync(this.configPath)) {
			userConfig = this.loadJSON(this.configPath) as Partial<AppConfig>;
			console.log('[Config] 重新加载用户配置');
		}

		// 合并配置
		this.config = deepMerge(
			JSON.parse(JSON.stringify(this.defaultConfig)),
			userConfig
		) as AppConfig;

		return this.config;
	}

	/**
	 * 添加 AI Provider
	 */
	addProvider(id: string, providerConfig: ProviderConfig): void {
		if (!this.config) return;

		if (!this.config.providers) {
			this.config.providers = {};
		}
		this.config.providers[id] = providerConfig;
		this.save();
		console.log(`[Config] Provider "${id}" 已添加并保存到: ${this.configPath}`);
	}

	/**
	 * 删除 AI Provider
	 */
	removeProvider(id: string): void {
		if (this.config?.providers?.[id]) {
			delete this.config.providers[id];
			this.save();
		}
	}

	/**
	 * 更新 AI Provider 配置（如果不存在则创建）
	 */
	updateProvider(id: string, updates: Partial<ProviderConfig>): void {
		if (!this.config) return;

		if (!this.config.providers) {
			this.config.providers = {};
		}

		// 合并更新（如果存在则合并，不存在则直接设置）
		this.config.providers[id] = {
			...this.config.providers[id],
			...updates,
		};
		this.save();
		console.log(`[Config] Provider "${id}" 已保存到: ${this.configPath}`);
	}

	/**
	 * 获取所有 Provider
	 */
	getProviders(): Record<string, ProviderConfig> {
		return this.config?.providers || {};
	}
}

// 单例导出
export const configManager = new ConfigManager();
export { ConfigManager };
export default configManager;
