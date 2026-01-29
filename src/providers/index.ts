/**
 * Provider 管理器
 */

import { logger } from '../utils/logger.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { BaseProvider, ProviderConfig } from './base.js';
import type { ChatMessage, ChatOptions, ChatChunk, ProviderInfo } from '../types/index.js';
import type { ConfigManager } from '../utils/config.js';

// Provider 类型映射
const PROVIDER_TYPES: Record<string, typeof BaseProvider> = {
	openai: OpenAIProvider as unknown as typeof BaseProvider,
	anthropic: AnthropicProvider as unknown as typeof BaseProvider,
};

export class ProviderManager {
	private config: ConfigManager;
	private providers: Map<string, BaseProvider> = new Map();
	private defaultProviderId: string | null = null;
	private logger = logger.child('ProviderManager');

	constructor(config: ConfigManager) {
		this.config = config;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		const providers = this.config.get<Record<string, ProviderConfig>>('providers', {});

		this.logger.info(`从配置加载 providers: ${Object.keys(providers).join(', ') || '无'}`);

		for (const [id, providerConfig] of Object.entries(providers)) {
			try {
				this.addProvider(id, providerConfig, false);
				this.logger.debug(`已加载 provider: ${id}`);
			} catch (error) {
				this.logger.warn(`加载 provider ${id} 失败:`, (error as Error).message);
			}
		}

		// 设置默认 Provider
		const defaultModel = this.config.get<string>('agent.defaultModel');
		if (defaultModel) {
			const [providerId] = defaultModel.split('/');
			if (this.providers.has(providerId)) {
				this.defaultProviderId = providerId;
			}
		}

		this.logger.info(`已加载 ${this.providers.size} 个 provider`);
	}

	/**
	 * 添加 Provider
	 */
	addProvider(id: string, config: ProviderConfig, save = true): BaseProvider {
		const type = config.type || 'openai';
		const ProviderClass = PROVIDER_TYPES[type] || OpenAIProvider;

		const provider = new (ProviderClass as new (config: ProviderConfig) => BaseProvider)({
			id,
			...config,
		});

		this.providers.set(id, provider);
		this.logger.info(`已添加 provider: ${id} (${type})`);

		if (save) {
			this.config.addProvider(id, config);
		}

		return provider;
	}

	/**
	 * 移除 Provider
	 */
	removeProvider(id: string): void {
		if (!this.providers.has(id)) {
			throw new Error(`Provider not found: ${id}`);
		}

		this.providers.delete(id);
		this.config.removeProvider(id);

		if (this.defaultProviderId === id) {
			this.defaultProviderId = null;
		}

		this.logger.info(`已移除 provider: ${id}`);
	}

	/**
	 * 获取 Provider
	 */
	getProvider(id: string): BaseProvider | undefined {
		return this.providers.get(id);
	}

	/**
	 * 获取默认 Provider
	 */
	getDefaultProvider(): BaseProvider | null {
		if (this.defaultProviderId) {
			return this.providers.get(this.defaultProviderId) || null;
		}

		// 返回第一个可用的 Provider
		for (const provider of this.providers.values()) {
			if (provider.enabled) {
				return provider;
			}
		}

		return null;
	}

	/**
	 * 解析模型引用
	 */
	resolveModel(modelRef?: string): { provider: BaseProvider; model: string } {
		if (!modelRef) {
			const provider = this.getDefaultProvider();
			if (!provider) {
				throw new Error('No provider available');
			}
			return {
				provider,
				model: provider.defaultModel || '',
			};
		}

		const parts = modelRef.split('/');

		if (parts.length === 2) {
			const [providerId, modelName] = parts;
			const provider = this.providers.get(providerId);

			if (!provider) {
				throw new Error(`Provider not found: ${providerId}`);
			}

			return { provider, model: modelName };
		} else {
			const provider = this.getDefaultProvider();
			if (!provider) {
				throw new Error('No default provider available');
			}
			return { provider, model: modelRef };
		}
	}

	/**
	 * 执行聊天
	 */
	async *chat(
		modelRef: string | undefined,
		messages: ChatMessage[],
		options: ChatOptions = {}
	): AsyncGenerator<ChatChunk> {
		const { provider, model } = this.resolveModel(modelRef);

		this.logger.debug(`对话使用: ${provider.id}/${model}`);

		yield* provider.chat(messages, { ...options, model });
	}

	/**
	 * 测试 Provider 连接
	 */
	async testProvider(id: string, model?: string): Promise<{ success: boolean; model?: string; message: string }> {
		const provider = this.providers.get(id);
		if (!provider) {
			throw new Error(`Provider not found: ${id}`);
		}

		return await provider.testConnection(model);
	}

	/**
	 * 测试 Provider 是否支持 Vision（图像理解）
	 */
	async testVisionSupport(id: string, model?: string): Promise<{ supported: boolean; message: string }> {
		const provider = this.providers.get(id);
		if (!provider) {
			throw new Error(`Provider not found: ${id}`);
		}

		const result = await provider.testVisionSupport(model);

		// 如果测试成功，自动更新配置
		if (result.supported && !provider.supportsVision) {
			this.updateProvider(id, { supportsVision: true });
			this.logger.info(`Provider ${id} Vision 支持已自动启用`);
		}

		return result;
	}

	/**
	 * 更新 Provider 配置
	 */
	updateProvider(id: string, updates: Partial<ProviderConfig>): void {
		const provider = this.providers.get(id);
		if (!provider) {
			throw new Error(`Provider not found: ${id}`);
		}

		// 更新内存中的 provider
		if (updates.supportsVision !== undefined) {
			provider.supportsVision = updates.supportsVision;
		}

		// 更新配置文件
		const providers = this.config.get<Record<string, ProviderConfig>>('providers', {});
		if (providers[id]) {
			providers[id] = { ...providers[id], ...updates };
			this.config.set('providers', providers);
		}

		this.logger.info(`已更新 provider ${id}:`, updates);
	}

	/**
	 * 更新模型的 Vision 支持状态
	 */
	updateModelVisionSupport(providerId: string, model: string, supportsVision: boolean): void {
		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new Error(`Provider not found: ${providerId}`);
		}

		// 更新配置文件
		const providers = this.config.get<Record<string, ProviderConfig & { visionModels?: string[] }>>(
			'providers',
			{}
		);
		if (providers[providerId]) {
			const visionModels = new Set(providers[providerId].visionModels || []);

			if (supportsVision) {
				visionModels.add(model);
			} else {
				visionModels.delete(model);
			}

			providers[providerId].visionModels = Array.from(visionModels);
			this.config.set('providers', providers);
			this.config.save(); // 保存到文件

			this.logger.info(`已更新模型 ${providerId}/${model} Vision 支持: ${supportsVision}`);
		}
	}

	/**
	 * 检查指定模型是否支持 Vision
	 */
	checkModelVisionSupport(providerId: string, model: string): boolean {
		const providers = this.config.get<Record<string, ProviderConfig & { visionModels?: string[] }>>(
			'providers',
			{}
		);
		const visionModels = providers[providerId]?.visionModels || [];
		return visionModels.includes(model);
	}

	/**
	 * 列出所有 Provider
	 */
	listProviders(): ProviderInfo[] {
		// 获取配置中的 visionModels 信息
		const providersConfig = this.config.get<Record<string, ProviderConfig & { visionModels?: string[] }>>(
			'providers',
			{}
		);

		return Array.from(this.providers.values()).map((p) => {
			const info = p.getInfo();
			// 添加 visionModels 到返回信息
			return {
				...info,
				visionModels: providersConfig[p.id]?.visionModels || [],
			};
		});
	}

	/**
	 * 检查当前模型是否支持 Vision
	 */
	checkVisionSupport(modelRef?: string): boolean {
		try {
			const { provider, model } = this.resolveModel(modelRef);
			// 优先检查模型级别的配置
			return this.checkModelVisionSupport(provider.id, model);
		} catch {
			return false;
		}
	}

	/**
	 * 获取状态
	 */
	getStatus(): {
		count: number;
		default: string | null;
		providers: Array<{ id: string; name: string; type: string; enabled: boolean }>;
	} {
		return {
			count: this.providers.size,
			default: this.defaultProviderId,
			providers: this.listProviders().map((p) => ({
				id: p.id,
				name: p.name,
				type: p.type,
				enabled: p.enabled,
			})),
		};
	}

	/**
	 * 设置默认 Provider
	 */
	setDefaultProvider(id: string): void {
		if (!this.providers.has(id)) {
			throw new Error(`Provider not found: ${id}`);
		}
		this.defaultProviderId = id;
	}
}

export { BaseProvider, OpenAIProvider, AnthropicProvider };
export default ProviderManager;
