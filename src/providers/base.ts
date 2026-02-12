/**
 * Provider 基类
 * 定义统一接口和模型能力检测
 */

import { logger } from '../utils/logger.js';
import type { ConfigManager } from '../utils/config.js';

export interface ProviderOptions {
	apiKey?: string;
	baseURL?: string;
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface ChatChunk {
	type: 'content' | 'finish' | 'error' | 'tool_use' | 'thinking';
	content?: string;
	fullContent?: string;
	reason?: string;
	toolCalls?: unknown[];
	toolUse?: unknown;
}

export interface ChatOptions {
	tools?: unknown[];
	systemPrompt?: string;
	maxTokens?: number;
	temperature?: number;
	thinking?: boolean;
}

/**
 * Provider 能力检测接口
 */
export interface ProviderCapabilities {
	supportsVision(): boolean;
	supportsFunctionCall(): boolean;
	supportsThinking(): boolean;
}

export abstract class BaseProvider {
	protected config: ConfigManager;
	protected logger = logger.child('Provider');
	protected providerId: string = ''; // 存储配置中的 provider id

	constructor(config: ConfigManager) {
		this.config = config;
	}

	/**
	 * 设置 provider id
	 */
	setProviderId(id: string): void {
		this.providerId = id;
	}

	/**
	 * 获取 Provider 名称
	 */
	abstract get name(): string;

	/**
	 * 获取 Provider 类型
	 */
	abstract get type(): string;

	/**
	 * 检查是否支持 Vision（图像理解）
	 * 默认返回 true，子类可重写
	 */
	supportsVision(): boolean {
		return true;
	}

	/**
	 * 检查是否支持 Function Calling
	 * 默认返回 true，子类可重写
	 */
	supportsFunctionCall(): boolean {
		return true;
	}

	/**
	 * 检查是否支持 Thinking/Reasoning
	 * 默认返回 false，子类可重写
	 */
	supportsThinking(): boolean {
		return false;
	}

	/**
	 * 检查 Vision 支持
	 * @deprecated 使用 supportsVision()
	 */
	checkVision(modelRef?: string): boolean {
		return this.supportsVision();
	}

	/**
	 * 检查 Function Call 支持
	 * @deprecated 使用 supportsFunctionCall()
	 */
	checkFunctionCall(modelRef?: string): boolean {
		return this.supportsFunctionCall();
	}

	/**
	 * 获取 Provider 选项
	 */
	protected getOptions(modelRef?: string): ProviderOptions {
		const id = this.providerId || this.type;
		return {
			apiKey: this.config.get<string>(`providers.${id}.apiKey`),
			baseURL: this.config.get<string>(`providers.${id}.baseUrl`) || this.config.get<string>(`providers.${id}.baseURL`),
			model: modelRef || this.config.get<string>(`providers.${id}.model`),
			maxTokens: this.config.get<number>(`providers.${id}.maxTokens`),
			temperature: this.config.get<number>(`providers.${id}.temperature`),
		};
	}

	/**
	 * 聊天完成
	 */
	abstract chat(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk>;

	/**
	 * 流式聊天完成
	 */
	abstract *stream(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk>;

	/**
	 * 获取状态
	 */
	getStatus(): Record<string, unknown> {
		return {
			name: this.name,
			type: this.type,
			vision: this.supportsVision(),
			functionCall: this.supportsFunctionCall(),
			thinking: this.supportsThinking(),
		};
	}
}

export default BaseProvider;
