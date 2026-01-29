/**
 * AI Provider 基础类
 */

import { logger } from '../utils/logger.js';
import type { ChatMessage, ChatOptions, ChatChunk, ProviderInfo, ToolSchema } from '../types/index.js';

export interface ProviderConfig {
	id: string;
	name?: string;
	baseUrl: string;
	apiKey: string;
	type?: 'openai' | 'anthropic';
	models?: string[];
	defaultModel?: string;
	enabled?: boolean;
	timeout?: number;
	headers?: Record<string, string>;
	supportsVision?: boolean; // 是否支持图像理解（用户配置，或通过测试检测）
}

export abstract class BaseProvider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	type: 'openai' | 'anthropic';
	models: string[];
	defaultModel: string | null;
	enabled: boolean;
	timeout: number;
	headers: Record<string, string>;
	supportsVision: boolean;
	protected logger: ReturnType<typeof logger.child>;

	constructor(config: ProviderConfig) {
		this.id = config.id;
		this.name = config.name || config.id;
		this.baseUrl = config.baseUrl;
		this.apiKey = config.apiKey;
		this.type = config.type || 'openai';
		this.models = config.models || [];
		this.defaultModel = config.defaultModel || null;
		this.enabled = config.enabled !== false;
		this.timeout = config.timeout || 120000; // 默认 2 分钟，工具调用需要更长时间
		this.headers = config.headers || {};
		this.logger = logger.child(`Provider:${this.id}`);

		// Vision 支持：由用户配置，默认 false
		this.supportsVision = config.supportsVision ?? false;
	}

	/**
	 * 测试是否支持 Vision（发送一个简单的图片请求）
	 * 返回测试结果，可用于自动检测
	 */
	async testVisionSupport(model?: string): Promise<{ supported: boolean; message: string }> {
		const targetModel = model || this.defaultModel;

		// 1x1 红色像素的 PNG base64
		const testImage =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

		try {
			// 构建带图片的测试消息
			const messages = [
				{
					role: 'user' as const,
					content: [
						{ type: 'text' as const, text: '这是什么颜色？只回答颜色名称。' },
						{ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${testImage}` } },
					],
				},
			];

			// 发送测试请求
			const response = await this.chat(messages, {
				model: targetModel || undefined,
				maxTokens: 50,
			});

			// 收集响应
			let content = '';
			for await (const chunk of response) {
				if (chunk.type === 'content' && chunk.content) {
					content += chunk.content;
				}
			}

			// 如果有响应内容，说明支持 Vision
			if (content && content.length > 0) {
				return { supported: true, message: `支持图像理解。测试响应: ${content.substring(0, 50)}` };
			}

			return { supported: false, message: '无响应内容' };
		} catch (error) {
			const errMsg = (error as Error).message;
			// 某些错误明确表示不支持图片
			if (errMsg.includes('image') || errMsg.includes('vision') || errMsg.includes('multimodal')) {
				return { supported: false, message: `不支持图像理解: ${errMsg}` };
			}
			return { supported: false, message: `测试失败: ${errMsg}` };
		}
	}

	/**
	 * 发送 HTTP 请求
	 */
	protected async request<T>(
		endpoint: string,
		data: unknown,
		options: { method?: string; stream?: boolean; headers?: Record<string, string> } = {}
	): Promise<T | ReadableStream<Uint8Array>> {
		const url = `${this.baseUrl}${endpoint}`;
		const { method = 'POST', stream = false } = options;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...this.getAuthHeaders(),
			...this.headers,
			...options.headers,
		};

		const controller = new AbortController();
		// 流式请求用更长的超时（5分钟），非流式用默认超时
		const requestTimeout = stream ? 300000 : this.timeout;
		const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: data ? JSON.stringify(data) : undefined,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			// 检查 content-type
			const contentType = response.headers.get('content-type') || '';
			const isJson = contentType.includes('application/json');

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
				if (isJson) {
					const errorData = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
					errorMessage = errorData.error?.message || errorMessage;
				}
				throw new Error(errorMessage);
			}

			if (stream) {
				return response.body as ReadableStream<Uint8Array>;
			}

			if (!isJson) {
				throw new Error(
					`Expected JSON response but got: ${contentType || 'unknown'}. 请检查 API 地址是否正确（可能需要添加 /v1 后缀，如 https://api.example.com/v1）`
				);
			}

			return (await response.json()) as T;
		} catch (error) {
			clearTimeout(timeoutId);

			if ((error as Error).name === 'AbortError') {
				throw new Error(`请求超时 (${Math.round(requestTimeout / 1000)}秒)，请检查网络连接或 API 服务状态`);
			}
			throw error;
		}
	}

	/**
	 * 获取认证头
	 */
	protected getAuthHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
		};
	}

	/**
	 * 聊天补全
	 */
	abstract chat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatChunk>;

	/**
	 * 测试连接
	 */
	abstract testConnection(model?: string): Promise<{ success: boolean; model?: string; message: string }>;

	/**
	 * 获取可用模型列表
	 * @param forceRefresh - 是否强制从 API 获取（默认 false）
	 */
	async listModels(forceRefresh = false): Promise<string[]> {
		// 基类默认返回已配置的模型，子类可覆盖实现从 API 获取
		if (!forceRefresh && this.models.length > 0) {
			return this.models;
		}
		return this.models;
	}

	/**
	 * 获取 Provider 信息
	 */
	getInfo(): ProviderInfo {
		return {
			id: this.id,
			name: this.name,
			type: this.type,
			baseUrl: this.baseUrl,
			models: this.models,
			defaultModel: this.defaultModel,
			enabled: this.enabled,
			supportsVision: this.supportsVision,
		};
	}
}

export default BaseProvider;
