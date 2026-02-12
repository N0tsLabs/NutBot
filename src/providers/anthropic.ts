/**
 * Anthropic Provider
 * 支持 Claude 模型
 */

import { BaseProvider, type ChatChunk, type ChatOptions } from './base.js';
import { safeParseJSON } from '../utils/helpers.js';
import type { ConfigManager } from '../utils/config.js';

export class AnthropicProvider extends BaseProvider {
	private fetch: typeof fetch;

	constructor(config: ConfigManager) {
		super(config);
		this.fetch = fetch;
	}

	get name(): string {
		return 'Anthropic';
	}

	get type(): string {
		return 'anthropic';
	}

	/**
	 * Claude 支持 Vision（Claude 3+）
	 */
	supportsVision(): boolean {
		return true; // Claude 3/4 都支持 Vision
	}

	/**
	 * Claude 支持 Function Calling（Claude 3.5+）
	 */
	supportsFunctionCall(): boolean {
		return true; // Claude 3.5 Haiku/Sonnet 支持 Tool Use
	}

	/**
	 * Claude 支持 Thinking（Claude 3.7+）
	 */
	supportsThinking(): boolean {
		const options = this.getOptions();
		const model = options.model?.toLowerCase() || '';
		
		// Claude 3.7+ 支持 extended thinking
		return model.includes('3.7') || model.includes('3.5') || model.includes('4');
	}

	async *chat(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk> {
		const opts = this.getOptions(modelRef);
		const apiKey = opts.apiKey || this.config.get<string>('anthropic.apiKey');
		let baseURL = opts.baseURL || 'https://api.anthropic.com';
		const model = opts.model || 'claude-sonnet-4-20250514';
		const maxTokens = opts.maxTokens || 4096;

		if (!apiKey) {
			throw new Error('Anthropic API key 未配置。请设置 anthropic.apiKey');
		}

		// 正确拼接 URL
		if (baseURL.endsWith('/v1') || baseURL.endsWith('/v1/')) {
			baseURL = baseURL + '/messages';
		} else {
			baseURL = baseURL + '/v1/messages';
		}

		// 转换消息格式
		const apiMessages = this.convertMessages(messages);

		const body: Record<string, unknown> = {
			model,
			max_tokens: maxTokens,
			messages: apiMessages,
			stream: true,
		};

		// 添加系统提示
		const systemMessage = messages.find((m: any) => m.role === 'system');
		if (systemMessage && typeof systemMessage.content === 'string') {
			body.system = systemMessage.content;
		}

		// 添加工具定义（Function Calling）
		if (options?.tools && options.tools.length > 0) {
			body.tools = this.convertTools(options.tools);
			body.tool_choice = { type: 'auto' };
		}

		try {
			const response = await fetch(baseURL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'anthropic-dangerous-direct-browser-access': 'true',
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Anthropic API 错误: ${response.status} - ${error}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('无法读取响应流');

			const decoder = new TextDecoder();
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk.split('\n');

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;

					const data = line.slice(6);
					if (data === '[DONE]') continue;

					try {
						const parsed = JSON.parse(data);
						const eventType = parsed.type;

						if (eventType === 'content_block_start') {
							// 开始内容块
						} else if (eventType === 'content_block_delta') {
							// 内容增量
							const delta = parsed.delta;
							if (delta.type === 'text_delta') {
								fullContent += delta.text;
								yield { type: 'content', content: delta.text, fullContent };
							} else if (delta.type === 'tool_use_delta') {
								// 工具调用增量
								yield { type: 'tool_use', toolUse: delta };
							}
						} else if (eventType === 'message_stop') {
							// 消息结束
							yield { type: 'finish', reason: parsed.message?.stop_reason };
						} else if (eventType === 'message_delta') {
							// 消息增量
							if (parsed.delta?.stop_reason) {
								yield { type: 'finish', reason: parsed.delta.stop_reason };
							}
						}
					} catch {
						/* 忽略解析错误 */
					}
				}
			}
		} catch (error: any) {
			// 改进错误诊断
			let errorMsg = '未知错误';
			let errorDetails = '';
			let rawError = '';

			if (error instanceof Error) {
				errorMsg = error.message;
				errorDetails = error.stack || '';
			} else if (typeof error === 'string') {
				errorMsg = error;
				rawError = error;
			} else if (typeof error === 'object' && error !== null) {
				rawError = JSON.stringify(error);
				if (Object.keys(error).length === 0) {
					errorMsg = 'API 请求失败（空错误响应，可能是网络问题或 API 不可用）';
					errorDetails = `请求 URL: ${baseURL}\n模型: ${model}`;
				} else {
					errorMsg = rawError;
				}
			}

			const fullError = `错误: ${errorMsg}${errorDetails ? `\n${errorDetails}` : ''}`;
			this.logger.error(fullError);
			yield { type: 'error', content: fullError };
		}
	}

	/**
	 * 转换消息格式
	 */
	private convertMessages(messages: unknown[]): Record<string, unknown>[] {
		return messages
			.filter((m: any) => m.role !== 'system') // 系统消息单独处理
			.map((m: any) => {
				// 处理 tool 消息（Anthropic 使用 role: 'user' + name + tool_use_id）
				if (m.role === 'tool') {
					return {
						role: 'user',
						content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
						name: m.name || m.metadata?.toolName || 'unknown',
						tool_use_id: m.tool_call_id || m.metadata?.toolCallId || `call_${Date.now()}`,
					};
				}

				const msg: Record<string, unknown> = { role: m.role };

				if (typeof m.content === 'string') {
					msg.content = m.content;
				} else if (Array.isArray(m.content)) {
					// 多模态内容
					msg.content = m.content
						.filter((c: any) => c.type === 'text')
						.map((c: any) => c.text)
						.join('\n');
				} else if (m.tool_calls) {
					// 工具调用
					msg.role = 'assistant';
					msg.content = '';
					msg.tool_calls = m.tool_calls;
				}

				return msg;
			});
	}

	/**
	 * 转换工具定义
	 */
	private convertTools(tools: unknown[]): Record<string, unknown>[] {
		return tools.map((tool: any) => {
			const t: Record<string, unknown> = {
				name: tool.name,
				description: tool.description || '',
				input_schema: {
					type: 'object',
					properties: {},
					required: [],
				},
			};

			if (tool.parameters && typeof tool.parameters === 'object') {
				const params = tool.parameters as Record<string, any>;
				t.input_schema = {
					type: 'object',
					properties: params.properties || {},
					required: params.required || [],
				};
			}

			return t;
		});
	}

	/**
	 * 流式聊天（非流式包装）
	 */
	*stream(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk> {
		// Anthropic 原生就是流式的，直接使用 chat
		yield* this.chat(modelRef, messages, options);
	}
}

export default AnthropicProvider;
