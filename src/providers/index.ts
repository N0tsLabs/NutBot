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

/**
 * 创建 Provider 实例
 */
export function createProvider(type: string, config: { baseUrl: string; apiKey: string }): BaseProvider {
	const ProviderClass = PROVIDER_TYPES[type];
	if (!ProviderClass) {
		throw new Error(`Unknown provider type: ${type}`);
	}
	return new ProviderClass(config);
}

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
			// 跳过 null 或 undefined 的配置（用户已删除的 provider）
			if (!providerConfig) {
				this.logger.debug(`跳过已删除的 provider: ${id}`);
				continue;
			}
			try {
				this.addProvider(id, providerConfig);
				this.logger.debug(`已加载 provider: ${id}`);
			} catch (error) {
				this.logger.warn(`加载 provider ${id} 失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// 设置默认 Provider（从 modelLibrary 获取）
		const modelLibrary = this.config.getModelLibrary();
		if (modelLibrary.defaultModelId) {
			const [providerId] = modelLibrary.defaultModelId.split('/');
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
		
		// 设置配置属性
		if (config.name) provider.setDisplayName(config.name);
		if (config.baseUrl) provider.baseUrl = config.baseUrl;
		if (config.apiKey) provider.apiKey = config.apiKey;
		if (config.defaultModel) provider.defaultModel = config.defaultModel;
		if (config.supportsVision !== undefined) provider.supportsVision = config.supportsVision;
		
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
	 * 删除 Provider
	 */
	removeProvider(id: string): void {
		if (!this.providers.has(id)) {
			throw new Error(`Provider not found: ${id}`);
		}
		this.providers.delete(id);
		// 如果删除的是默认 provider，清除默认设置
		if (this.defaultProviderId === id) {
			this.defaultProviderId = null;
		}
		// 从配置中删除
		this.config.removeProvider(id);
		this.logger.info(`已删除 provider: ${id}`);
	}

	/**
	 * 解析模型引用
	 * modelRef 是模型 ID，从模型库中查找配置并通过 providerId 获取供应商
	 */
	resolveModel(modelRef?: string): { provider: BaseProvider; model: string } {
		if (!modelRef) {
			// 使用默认模型
			const defaultModelId = this.config.getModelLibrary().defaultModelId;
			if (!defaultModelId) throw new Error('No default model configured');
			modelRef = defaultModelId;
		}

		// 从模型库中查找模型配置
		const modelLibrary = this.config.getModelLibrary();
		const modelConfig = modelLibrary.models.find(m => m.id === modelRef && m.enabled);
		
		if (!modelConfig) {
			throw new Error(`Model not found or disabled: ${modelRef}`);
		}

		// 通过 providerId 获取供应商
		const provider = this.providers.get(modelConfig.providerId);
		if (!provider) {
			throw new Error(`Provider not found: ${modelConfig.providerId}`);
		}

		return { provider, model: modelConfig.name };
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
			if (!modelRef) {
				modelRef = this.config.getModelLibrary().defaultModelId;
				if (!modelRef) return false;
			}
			const modelConfig = this.config.getModelLibrary().models.find(m => m.id === modelRef);
			return modelConfig?.supportsVision ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * 检查 Function Call 支持
	 */
	checkFunctionCall(modelRef?: string): boolean {
		try {
			if (!modelRef) {
				modelRef = this.config.getModelLibrary().defaultModelId;
				if (!modelRef) return false;
			}
			const modelConfig = this.config.getModelLibrary().models.find(m => m.id === modelRef);
			return modelConfig?.supportsFunctionCall ?? false;
		} catch {
			return false;
		}
	}

	/**
	 * 获取所有 Provider 列表
	 */
	listProviders(): Array<{ id: string; name: string; type: string; vision: boolean; functionCall: boolean; thinking: boolean; baseUrl?: string; apiKey?: string; models: string[]; defaultModel: string | null }> {
		return Array.from(this.providers.entries()).map(([id, p]) => ({
			...p.getInfo(),
			vision: p.supportsVision,
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

	/**
	 * 更新 Provider 配置
	 */
	updateProvider(id: string, updates: Partial<{ name?: string; type?: 'openai' | 'anthropic'; baseUrl?: string; apiKey?: string; models?: string[]; supportsVision?: boolean }>): void {
		const provider = this.providers.get(id);
		if (!provider) throw new Error(`Provider not found: ${id}`);
		
		// 更新配置
		this.config.updateProvider(id, updates);
		
		this.logger.info(`已更新 provider: ${id}`);
	}

	/**
	 * 更新模型 Vision 支持
	 */
	updateModelVisionSupport(providerId: string, model: string, supportsVision: boolean): void {
		const provider = this.providers.get(providerId);
		if (!provider) throw new Error(`Provider not found: ${providerId}`);
		
		// 更新配置中的 modelInfo
		const modelInfo = this.config.get<Record<string, { supportsVision?: boolean }>>(`providers.${providerId}.modelInfo`, {});
		modelInfo[model] = { ...modelInfo[model], supportsVision };
		this.config.set(`providers.${providerId}.modelInfo`, modelInfo);
		
		this.logger.info(`已更新模型 ${providerId}/${model} 的 Vision 支持: ${supportsVision}`);
	}

	/**
	 * 测试 Provider 连接
	 */
	async testProvider(id: string, model?: string): Promise<{ success: boolean; message?: string }> {
		const provider = this.providers.get(id);
		if (!provider) throw new Error(`Provider not found: ${id}`);
		
		try {
			// 使用指定的模型或 provider 的默认模型
			const testModel = model || provider.defaultModel || '';
			if (!testModel) {
				return { success: false, message: '没有可用的模型进行测试' };
			}
			
			// 发送一个简单的测试消息
			const messages = [{ role: 'user', content: 'Hello' }];
			const response = await provider.chat(testModel, messages, { maxTokens: 5 });
			
			// 消费完生成器
			for await (const chunk of response) {
				// 只需要确认能收到响应即可
			}
			
			return { success: true };
		} catch (error) {
			return { success: false, message: (error as Error).message };
		}
	}

	/**
	 * 测试模型 Vision 支持
	 */
	async testVisionSupport(id: string, model: string): Promise<{ supported: boolean; message?: string }> {
		const provider = this.providers.get(id);
		if (!provider) throw new Error(`Provider not found: ${id}`);
		
		try {
			// 发送一个包含图像的测试消息
			const messages = [{
				role: 'user',
				content: [
					{ type: 'text', text: 'What is in this image?' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } }
				]
			}];
			
			const response = await provider.chat(model, messages, { maxTokens: 5 });
			
			// 消费完生成器
			for await (const chunk of response) {
				// 只需要确认能收到响应即可
			}
			
			return { supported: true };
		} catch (error) {
			const message = (error as Error).message;
			// 如果是 Vision 不支持的错误，返回 supported: false
			if (message.includes('vision') || message.includes('image') || message.includes('multimodal')) {
				return { supported: false, message };
			}
			return { supported: false, message };
		}
	}

	private get logger() {
		return logger.child('ProviderManager');
	}
}

export { BaseProvider, OpenAIProvider, AnthropicProvider };
export default ProviderManager;
