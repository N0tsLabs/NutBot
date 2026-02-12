/**
 * Provider 管理器
 * 管理所有 LLM Provider
 */

import { logger } from '../utils/logger.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { BaseProvider, type ProviderCapabilities, type ChatChunk, type ChatOptions } from './base.js';
import type { ConfigManager } from '../utils/config.js';

// Provider 类型映射
const PROVIDER_TYPES: Record<string, new (config: any) => BaseProvider> = {
	openai: OpenAIProvider,
	anthropic: AnthropicProvider,
};

export class ProviderManager {
	private config: ConfigManager;
	private providers: Map<string, BaseProvider> = new Map();
	private defaultProviderId: string | null = null;

	constructor(config: ConfigManager) {
		this.config = config;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		const providers = this.config.get<Record<string, any>>('providers', {});

		this.logger.info(`从配置加载 providers: ${Object.keys(providers).join(', ') || '无'}`);

		for (const [id, providerConfig] of Object.entries(providers)) {
			try {
				this.addProvider(id, providerConfig);
				this.logger.debug(`已加载 provider: ${id}`);
			} catch (error) {
				this.logger.warn(`加载 provider ${id} 失败:`, error);
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
	addProvider(id: string, config: any): BaseProvider {
		const type = config.type || 'openai';
		const ProviderClass = PROVIDER_TYPES[type];

		if (!ProviderClass) {
			throw new Error(`Unknown provider type: ${type}`);
		}

		const provider = new ProviderClass(this.config);
		provider.setProviderId(id); // 设置 provider id
		this.providers.set(id, provider);
		this.logger.info(`已添加 provider: ${id} (${type})`);

		return provider;
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
		for (const provider of this.providers.values()) {
			return provider;
		}
		return null;
	}

	/**
	 * 解析模型引用
	 */
	resolveModel(modelRef?: string): { provider: BaseProvider; model: string } {
		if (!modelRef) {
			const provider = this.getDefaultProvider();
			if (!provider) throw new Error('No provider available');
			return { provider, model: provider.defaultModel || '' };
		}

		const parts = modelRef.split('/');
		if (parts.length === 2) {
			const [providerId, modelName] = parts;
			const provider = this.providers.get(providerId);
			if (!provider) throw new Error(`Provider not found: ${providerId}`);
			return { provider, model: modelName };
		}

		const provider = this.getDefaultProvider();
		if (!provider) throw new Error('No default provider available');
		return { provider, model: modelRef };
	}

	/**
	 * 执行聊天
	 */
	async *chat(
		modelRef: string | undefined,
		messages: any[],
		options: ChatOptions = {}
	): AsyncGenerator<ChatChunk> {
		const { provider, model } = this.resolveModel(modelRef);
		this.logger.debug(`对话使用: ${provider.name}, 模型: ${model}`);

		yield* provider.chat(model, messages, options);
	}

	/**
	 * 检查 Vision 支持
	 */
	checkVisionSupport(modelRef?: string): boolean {
		try {
			const { provider } = this.resolveModel(modelRef);
			return provider.supportsVision();
		} catch {
			return false;
		}
	}

	/**
	 * 检查 Function Call 支持
	 */
	checkFunctionCall(modelRef?: string): boolean {
		try {
			const { provider } = this.resolveModel(modelRef);
			return provider.supportsFunctionCall();
		} catch {
			return false;
		}
	}

	/**
	 * 获取所有 Provider 列表
	 */
	listProviders(): Array<{ id: string; name: string; type: string; vision: boolean; functionCall: boolean; thinking: boolean }> {
		return Array.from(this.providers.values()).map(p => ({
			id: p.name.toLowerCase(),
			name: p.name,
			type: p.type,
			vision: p.supportsVision(),
			functionCall: p.supportsFunctionCall(),
			thinking: p.supportsThinking(),
		}));
	}

	/**
	 * 获取状态
	 */
	getStatus(): Record<string, unknown> {
		return {
			count: this.providers.size,
			default: this.defaultProviderId,
			providers: this.listProviders(),
		};
	}

	/**
	 * 设置默认 Provider
	 */
	setDefaultProvider(id: string): void {
		if (!this.providers.has(id)) throw new Error(`Provider not found: ${id}`);
		this.defaultProviderId = id;
	}

	private get logger() {
		return logger.child('ProviderManager');
	}
}

export { BaseProvider, OpenAIProvider, AnthropicProvider };
export default ProviderManager;
