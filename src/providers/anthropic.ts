/**
 * Anthropic Provider
 * 支持 Claude API
 */

import { BaseProvider, ProviderConfig } from './base.js';
import type { ChatMessage, ChatOptions, ChatChunk, ContentBlock } from '../types/index.js';

interface AnthropicResponse {
	content?: Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	}>;
	model?: string;
	stop_reason?: string;
	usage?: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
	type: string;
	content_block?: {
		type: string;
		id?: string;
		name?: string;
		text?: string;
	};
	delta?: {
		type: string;
		text?: string;
		partial_json?: string;
	};
	error?: { message: string };
	usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider extends BaseProvider {
	private apiVersion: string;

	constructor(config: ProviderConfig & { apiVersion?: string }) {
		super(config);
		this.type = 'anthropic';
		this.apiVersion = config.apiVersion || '2023-06-01';
	}

	/**
	 * 获取认证头
	 */
	protected getAuthHeaders(): Record<string, string> {
		return {
			'x-api-key': this.apiKey,
			'anthropic-version': this.apiVersion,
		};
	}

	/**
	 * 聊天补全
	 */
	async *chat(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<ChatChunk> {
		const { model = this.defaultModel, maxTokens = 4096, stream = true, tools, system } = options;

		if (!model) {
			throw new Error('No model specified');
		}

		// 转换消息格式
		const anthropicMessages = this.convertMessages(messages);

		const requestBody: Record<string, unknown> = {
			model,
			messages: anthropicMessages,
			max_tokens: maxTokens,
			stream,
		};

		// 系统提示
		if (system) {
			requestBody.system = system;
		}

		// 工具调用
		if (tools && tools.length > 0) {
			requestBody.tools = tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				input_schema: tool.parameters,
			}));
		}

		if (stream) {
			yield* this.streamChat(requestBody);
		} else {
			const response = await this.request<AnthropicResponse>('/messages', requestBody);
			yield this.parseResponse(response as AnthropicResponse);
		}
	}

	/**
	 * 转换消息格式
	 */
	private convertMessages(messages: ChatMessage[]): Array<{ role: string; content: unknown }> {
		return messages
			.filter((m) => m.role !== 'system')
			.map((m) => ({
				role: m.role === 'assistant' ? 'assistant' : 'user',
				content: this.convertContent(m.content),
			}));
	}

	/**
	 * 转换内容格式
	 */
	private convertContent(content: string | ContentBlock[]): unknown {
		if (typeof content === 'string') {
			return content;
		}

		if (Array.isArray(content)) {
			return content.map((item) => {
				if (item.type === 'text') {
					return { type: 'text', text: item.text };
				}
				if (item.type === 'image_url') {
					const url = item.image_url?.url || '';
					if (url.startsWith('data:')) {
						const [header, base64] = url.split(',');
						const mediaType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
						return {
							type: 'image',
							source: {
								type: 'base64',
								media_type: mediaType,
								data: base64,
							},
						};
					}
					return { type: 'text', text: `[Image: ${url}]` };
				}
				return item;
			});
		}

		return content;
	}

	/**
	 * 流式聊天
	 */
	private async *streamChat(requestBody: Record<string, unknown>): AsyncGenerator<ChatChunk> {
		const response = await this.request<ReadableStream<Uint8Array>>('/messages', requestBody, { stream: true });

		const reader = (response as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();

		let buffer = '';
		let fullContent = '';
		let toolUse: { id: string; name: string; input: string } | null = null;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) continue;

					try {
						const json = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent;

						switch (json.type) {
							case 'content_block_start':
								if (json.content_block?.type === 'tool_use') {
									toolUse = {
										id: json.content_block.id || '',
										name: json.content_block.name || '',
										input: '',
									};
								}
								break;

							case 'content_block_delta':
								if (json.delta?.type === 'text_delta') {
									const text = json.delta.text || '';
									fullContent += text;
									yield {
										type: 'content',
										content: text,
										fullContent,
									};
								} else if (json.delta?.type === 'input_json_delta' && toolUse) {
									toolUse.input += json.delta.partial_json || '';
								}
								break;

							case 'content_block_stop':
								if (toolUse) {
									let parsedInput: Record<string, unknown> = {};
									try {
										parsedInput = JSON.parse(toolUse.input);
									} catch {
										/* ignore */
									}

									yield {
										type: 'tool_use',
										toolUse: {
											id: toolUse.id,
											name: toolUse.name,
											input: parsedInput,
										},
									};
									toolUse = null;
								}
								break;

							case 'message_stop':
								yield {
									type: 'finish',
									reason: 'stop',
									fullContent,
								};
								break;

							case 'message_delta':
								if (json.delta) {
									yield {
										type: 'finish',
										reason: 'stop',
										fullContent,
										usage: json.usage,
									};
								}
								break;

							case 'error':
								throw new Error(json.error?.message || 'Stream error');
						}
					} catch (e) {
						if ((e as Error).message !== 'Stream error') {
							this.logger.warn('Failed to parse stream chunk');
						} else {
							throw e;
						}
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
	private parseResponse(response: AnthropicResponse): ChatChunk {
		const content = response.content?.[0];

		return {
			type: 'complete',
			content: content?.text || '',
			fullContent: content?.text || '',
			toolUse:
				content?.type === 'tool_use'
					? {
							id: content.id || '',
							name: content.name || '',
							input: content.input || {},
						}
					: undefined,
		};
	}

	/**
	 * 测试连接
	 */
	async testConnection(model?: string): Promise<{ success: boolean; model?: string; message: string }> {
		const testModel = model || this.defaultModel || 'claude-3-haiku-20240307';
		try {
			const response = await this.request<AnthropicResponse>('/messages', {
				model: testModel,
				messages: [{ role: 'user', content: 'Hi' }],
				max_tokens: 5,
			});

			return {
				success: true,
				model: (response as AnthropicResponse).model || testModel,
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
	 * 视觉分析
	 */
	async analyzeImage(imageBase64: string, prompt: string, options: ChatOptions = {}): Promise<string> {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/png',
							data: imageBase64,
						},
					},
					{ type: 'text', text: prompt },
				],
			},
		];

		let result = '';
		for await (const chunk of this.chat(messages, { ...options, stream: false })) {
			if (chunk.content) {
				result = chunk.content;
			}
		}

		return result;
	}
}

export default AnthropicProvider;
