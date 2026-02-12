/**
 * OpenAI Provider
 * 支持 GPT-4o, GPT-4 Turbo 等模型
 */

import { BaseProvider, type ChatChunk, type ChatOptions } from './base.js';

export class OpenAIProvider extends BaseProvider {
	private fetch: typeof fetch;

	constructor(config: Record<string, unknown>) {
		super(config);
		this.fetch = fetch;
	}

	get name(): string {
		return 'OpenAI';
	}

	get type(): string {
		return 'openai';
	}

	/**
	 * GPT-4o, GPT-4 Turbo 支持 Vision
	 * GPT-3.5 不支持
	 */
	supportsVision(): boolean {
		const options = this.getOptions();
		const model = options.model?.toLowerCase() || '';
		
		// GPT-4 系列支持 Vision
		return model.includes('gpt-4');
	}

	/**
	 * GPT-3.5+, GPT-4 都支持 Function Calling
	 */
	supportsFunctionCall(): boolean {
		const options = this.getOptions();
		const model = options.model?.toLowerCase() || '';
		
		// GPT-3.5+ 支持 Function Calling
		return model.includes('gpt-3.5') || model.includes('gpt-4');
	}

	/**
	 * GPT-4 支持 o1/o3/o4 风格的 Thinking
	 */
	supportsThinking(): boolean {
		const options = this.getOptions();
		const model = options.model?.toLowerCase() || '';
		
		// o1, o3, o4 系列是推理模型
		return model.includes('o1') || model.includes('o3') || model.includes('o4');
	}

	async *chat(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk> {
		const opts = this.getOptions(modelRef);
		const apiKey = opts.apiKey || this.config.get<string>('openai.apiKey');
		let baseURL = opts.baseURL || 'https://api.openai.com/v1';
		const model = opts.model || 'gpt-4o';
		const maxTokens = opts.maxTokens || 4096;

		if (!apiKey) {
			throw new Error('OpenAI API key 未配置。请设置 openai.apiKey');
		}

		// 正确拼接 URL
		if (baseURL.endsWith('/v1') || baseURL.endsWith('/v1/')) {
			baseURL = baseURL + '/chat/completions';
		} else {
			baseURL = baseURL + '/v1/chat/completions';
		}

		// 转换消息格式
		const apiMessages = this.convertMessages(messages);

		const body: Record<string, unknown> = {
			model,
			max_tokens: maxTokens,
			messages: apiMessages,
			stream: true,
		};

		// 系统提示
		const systemMessage = messages.find((m: any) => m.role === 'system');
		if (systemMessage && typeof systemMessage.content === 'string') {
			// OpenAI 不直接支持 system 角色在 messages 数组中
			// 需要将系统提示插入到 user 消息中
		}

		// 添加工具调用（转换为 OpenAI 格式）
		if (options?.tools && options.tools.length > 0) {
			body.tools = options.tools.map((tool: any) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				},
			}));
			body.tool_choice = 'auto';
		}

		// 调试日志：打印发送给 API 的请求体（截断 tools 数组避免日志过长）
		const logBody = {
			...body,
			tools: body.tools ? body.tools.map((t: any) => ({
				type: t.type,
				function: {
					name: t.function?.name,
					description: t.function?.description?.substring(0, 100) + '...',
					// parameters 太长，跳过
				}
			})) : undefined,
			// messages 也截断
			messages: body.messages?.map((m: any) => ({
				role: m.role,
				content: typeof m.content === 'string' ? m.content?.substring(0, 200) + '...' : m.content,
				tool_calls: m.tool_calls?.map((tc: any) => ({
					id: tc.id,
					type: tc.type,
					function: { name: tc.function?.name, arguments: tc.function?.arguments?.substring(0, 100) + '...' }
				}))
			}))
		};
		this.logger.info(`[OpenAI 请求] ${JSON.stringify(logBody, null, 2)}`);

		try {
			const response = await fetch(baseURL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => '无响应内容');
				const errorMsg = errorText || `HTTP ${response.status}`;
				throw new Error(`OpenAI API 错误: ${response.status} - ${errorMsg}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('无法读取响应流');

			const decoder = new TextDecoder();
			let fullContent = '';

			// 累积工具调用数据（因为是流式返回）
			let pendingToolCalls: any[] = [];
			let toolCallIndex = 0;

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
						const choice = parsed.choices?.[0];

						if (!choice) continue;

						const delta = choice.delta;

						// 内容块
						if (delta?.content) {
							fullContent += delta.content;
							yield { type: 'content', content: delta.content, fullContent };
						}

						// 工具调用（流式累积）
						if (delta?.tool_calls) {
							for (const tc of delta.tool_calls) {
								const idx = tc.index ?? 0;
								// 确保该索引的累积数据存在
								while (pendingToolCalls.length <= idx) {
									pendingToolCalls.push({
										index: idx,
										id: null,
										type: 'function',
										function: {
											name: '',
											arguments: '',
										},
									});
								}
								// 累积更新
								if (tc.id) pendingToolCalls[idx].id = tc.id;
								if (tc.type) pendingToolCalls[idx].type = tc.type;
								if (tc.function) {
									if (tc.function.name) {
										pendingToolCalls[idx].function.name = tc.function.name;
									}
									if (tc.function.arguments) {
										pendingToolCalls[idx].function.arguments += tc.function.arguments;
									}
								}
							}
						}

						// 完成
						if (choice.finish_reason) {
							// 只有在有累积的工具调用时才 yield
							if (pendingToolCalls.length > 0) {
								// 在完成时一次性 yield 所有累积的工具调用
								for (const tc of pendingToolCalls) {
									yield {
										type: 'tool_use',
										toolUse: {
											index: tc.index,
											id: tc.id,
											type: tc.type,
											function: {
												name: tc.function.name,
												arguments: tc.function.arguments,
											},
										},
									};
								}
								pendingToolCalls = [];
							}
							yield { type: 'finish', reason: choice.finish_reason };
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
				// 空对象 {}
				if (Object.keys(error).length === 0) {
					errorMsg = 'API 请求失败（空错误响应，可能是网络问题或 API 不可用）';
					errorDetails = `请求 URL: ${baseURL}/chat/completions\n模型: ${model}`;
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
		const result = messages.map((m: any) => {
			const msg: Record<string, unknown> = { role: m.role };

			// 首先处理 content
			if (typeof m.content === 'string') {
				msg.content = m.content;
			} else if (Array.isArray(m.content)) {
				// 多模态内容
				msg.content = m.content.map((c: any) => {
					if (c.type === 'text' || c.type === 'text_block') {
						return { type: 'text', text: c.text };
					} else if (c.type === 'image_url') {
						return {
							type: 'image_url',
							image_url: c.image_url || c,
						};
					}
					return c;
				});
			}

			// 无论 content 是什么，只要有 tool_calls 就要添加
			const toolCalls = m.tool_calls || m.toolCalls;
			if (toolCalls) {
				msg.tool_calls = toolCalls;
			}

			// tool 消息需要 tool_call_id
			if (m.role === 'tool' && m.tool_call_id) {
				msg.tool_call_id = m.tool_call_id;
			}

			return msg;
		});
		return result;
	}

	/**
	 * 流式聊天
	 */
	*stream(
		modelRef: string | undefined,
		messages: unknown[],
		options?: ChatOptions
	): AsyncGenerator<ChatChunk> {
		// OpenAI 原生流式，直接使用 chat
		yield* this.chat(modelRef, messages, options);
	}
}

export default OpenAIProvider;
