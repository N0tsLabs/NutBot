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
	
	// 可写的属性
	private _displayName?: string;
	private _baseUrl?: string;
	private _apiKey?: string;
	private _providerType?: string;
	private _defaultModel?: string | null;
	private _supportsVisionFlag?: boolean;

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
	 * 获取 Provider 名称（抽象，子类必须实现）
	 */
	abstract get name(): string;

	/**
	 * 设置显示名称
	 */
	setDisplayName(value: string): void {
		this._displayName = value;
	}

	/**
	 * 获取显示名称
	 */
	getDisplayName(): string {
		return this._displayName || this.name;
	}

	/**
	 * 获取 Provider 类型（抽象，子类必须实现）
	 */
	abstract get type(): string;

	/**
	 * 设置 Provider 类型
	 */
	setProviderType(value: string): void {
		this._providerType = value;
	}

	/**
	 * 获取 baseUrl
	 */
	get baseUrl(): string | undefined {
		if (this._baseUrl !== undefined) return this._baseUrl;
		const id = this.providerId || this.type;
		return this.config.get<string>(`providers.${id}.baseUrl`) || this.config.get<string>(`providers.${id}.baseURL`);
	}
	set baseUrl(value: string | undefined) {
		this._baseUrl = value;
	}

	/**
	 * 获取 apiKey
	 */
	get apiKey(): string | undefined {
		if (this._apiKey !== undefined) return this._apiKey;
		const id = this.providerId || this.type;
		return this.config.get<string>(`providers.${id}.apiKey`);
	}
	set apiKey(value: string | undefined) {
		this._apiKey = value;
	}

	/**
	 * 获取 models
	 */
	get models(): string[] {
		const id = this.providerId || this.type;
		return this.config.get<string[]>(`providers.${id}.models`, []);
	}

	/**
	 * 获取 defaultModel
	 */
	get defaultModel(): string | null {
		if (this._defaultModel !== undefined) return this._defaultModel;
		const id = this.providerId || this.type;
		return this.config.get<string | null>(`providers.${id}.model`);
	}
	set defaultModel(value: string | null | undefined) {
		this._defaultModel = value;
	}

	/**
	 * 获取 supportsVision
	 */
	get supportsVision(): boolean {
		if (this._supportsVisionFlag !== undefined) return this._supportsVisionFlag;
		return this.supportsVisionCapability();
	}
	set supportsVision(value: boolean) {
		this._supportsVisionFlag = value;
	}

	/**
	 * 获取 Provider 信息（用于返回给前端）
	 */
	getInfo(): { id: string; name: string; type: string; baseUrl?: string; apiKey?: string; models: string[]; defaultModel: string | null; supportsVision: boolean } {
		return {
			id: this.providerId,
			name: this.getDisplayName(),
			type: this.type,
			baseUrl: this.baseUrl,
			apiKey: this.apiKey,
			models: this.models,
			defaultModel: this.defaultModel,
			supportsVision: this.supportsVision,
		};
	}

	/**
	 * 检查是否支持 Vision（图像理解）能力
	 * 默认返回 true，子类可重写
	 */
	supportsVisionCapability(): boolean {
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
	 * @deprecated 使用 supportsVisionCapability()
	 */
	checkVision(modelRef?: string): boolean {
		return this.supportsVisionCapability();
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
	abstract stream(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk>;

	/**
	 * 获取可用模型列表
	 * 子类可以重写此方法以支持动态获取模型列表
	 */
	async listModels(_forceRefresh?: boolean): Promise<string[]> {
		// 默认返回配置中已保存的模型列表
		return this.models;
	}

	/**
	 * 获取状态
	 */
	getStatus(): Record<string, unknown> {
		return {
			name: this.name,
			type: this.type,
			vision: this.supportsVision,
			functionCall: this.supportsFunctionCall(),
			thinking: this.supportsThinking(),
		};
	}
}

export default BaseProvider;
