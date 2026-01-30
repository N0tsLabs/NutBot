/**
 * OpenAI 兼容 Provider
 * 支持 OpenAI API 格式的所有服务
 */

import { BaseProvider, ProviderConfig } from './base.js';
import { safeParseJSON } from '../utils/helpers.js';
import type { ChatMessage, ChatOptions, ChatChunk, ToolCall } from '../types/index.js';

interface OpenAIResponse {
	choices?: Array<{
		message?: {
			content?: string;
			tool_calls?: ToolCall[];
		};
		delta?: {
			content?: string;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string;
	}>;
	model?: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
	data?: Array<{ id: string }>;
}

export class OpenAIProvider extends BaseProvider {
	constructor(config: ProviderConfig) {
		super(config);
		this.type = 'openai';
		// 自动补全 baseUrl（OpenAI 兼容 API 通常需要 /v1）
		this.baseUrl = BaseProvider.normalizeBaseUrl(this.baseUrl, 'openai', '/chat/completions');
	}

	/**
	 * 聊天补全
	 */
	async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<ChatChunk> {
		const {
			model = this.defaultModel,
			temperature = 0.7,
			maxTokens = 4096,
			stream = true,
			tools,
			toolChoice,
		} = options;

		if (!model) {
			throw new Error('No model specified');
		}

		const requestBody: Record<string, unknown> = {
			model,
			messages,
			temperature,
			max_tokens: maxTokens,
			stream,
		};

		// 添加工具调用支持
		if (tools && tools.length > 0) {
			requestBody.tools = tools.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				},
			}));

			if (toolChoice) {
				requestBody.tool_choice = toolChoice;
			}
		}

		if (stream) {
			yield* this.streamChat(requestBody);
		} else {
			const response = await this.request<OpenAIResponse>('/chat/completions', requestBody);
			yield this.parseResponse(response as OpenAIResponse);
		}
	}

	/**
	 * 流式聊天
	 */
	private async *streamChat(requestBody: Record<string, unknown>): AsyncGenerator<ChatChunk> {
		const response = await this.request<ReadableStream<Uint8Array>>('/chat/completions', requestBody, {
			stream: true,
		});

		const reader = (response as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();

		let buffer = '';
		let fullContent = '';
		const toolCalls: ToolCall[] = [];

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') continue;
					if (!trimmed.startsWith('data: ')) continue;

					try {
						const json = JSON.parse(trimmed.slice(6)) as OpenAIResponse;
						const delta = json.choices?.[0]?.delta;

						if (!delta) continue;

						// 处理内容
						if (delta.content) {
							fullContent += delta.content;
							yield {
								type: 'content',
								content: delta.content,
								fullContent,
							};
						}

						// 处理工具调用
						if (delta.tool_calls) {
							for (const toolCall of delta.tool_calls) {
								const index = toolCall.index || 0;

								if (!toolCalls[index]) {
									toolCalls[index] = {
										id: toolCall.id || '',
										type: 'function',
										function: { name: '', arguments: '' },
									};
								}

								if (toolCall.function?.name) {
									toolCalls[index].function.name += toolCall.function.name;
								}
								if (toolCall.function?.arguments) {
									toolCalls[index].function.arguments += toolCall.function.arguments;
								}
							}
						}

						// 处理结束原因
						if (json.choices?.[0]?.finish_reason) {
							yield {
								type: 'finish',
								reason: json.choices[0].finish_reason,
								fullContent,
								toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
							};
						}
					} catch {
						this.logger.warn('Failed to parse stream chunk');
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * 解析非流式响应
	 */
	private parseResponse(response: OpenAIResponse): ChatChunk {
		const choice = response.choices?.[0];
		if (!choice) {
			throw new Error('Invalid response: no choices');
		}

		return {
			type: 'complete',
			content: choice.message?.content || '',
			toolCalls: choice.message?.tool_calls,
			fullContent: choice.message?.content || '',
		};
	}

	/**
	 * 测试连接
	 */
	async testConnection(model?: string): Promise<{ success: boolean; model?: string; message: string }> {
		const testModel = model || this.defaultModel || 'gpt-3.5-turbo';
		try {
			const response = await this.request<OpenAIResponse>('/chat/completions', {
				model: testModel,
				messages: [{ role: 'user', content: 'Hi' }],
				max_tokens: 5,
			});

			return {
				success: true,
				model: (response as OpenAIResponse).model || testModel,
				message: '连接成功',
			};
		} catch (error) {
			return {
				success: false,
				model: testModel,
				message: (error as Error).message,
			};
		}
	}

	/**
	 * 获取模型列表
	 * @param forceRefresh - 是否强制从 API 获取
	 */
	async listModels(forceRefresh = false): Promise<string[]> {
		// 如果不强制刷新且已有模型列表，直接返回
		if (!forceRefresh && this.models.length > 0) {
			return this.models;
		}

		try {
			const response = await this.request<OpenAIResponse>('/models', null, { method: 'GET' });
			const models = (response as OpenAIResponse).data?.map((m) => m.id) || [];
			models.sort((a, b) => a.localeCompare(b));
			return models;
		} catch (error) {
			this.logger.warn('Failed to fetch models:', (error as Error).message);
			throw new Error(`获取模型列表失败: ${(error as Error).message}`);
		}
	}

	/**
	 * 视觉分析
	 */
	async analyzeImage(imageBase64: string, prompt: string, options: ChatOptions = {}): Promise<string> {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: prompt },
					{
						type: 'image_url',
						image_url: {
							url: `data:image/png;base64,${imageBase64}`,
							detail: 'high',
						},
					},
				],
			},
		];

		let result = '';
		for await (const chunk of this.chat(messages, options)) {
			if (chunk.fullContent) {
				result = chunk.fullContent;
			}
		}

		return result;
	}
}

export default OpenAIProvider;
