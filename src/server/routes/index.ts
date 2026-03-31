/**
 * API 路由
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Gateway } from '../../gateway/index.js';
import { memoryManager, type Memory } from '../../memory/index.js';
import { browserService, type BrowserConfig } from '../../services/browser-service.js';
import { systemInfo } from '../../tools/exec.js';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';

// 浏览器截图保存目录 - 使用项目根目录下的 data 文件夹
const BROWSER_SCREENSHOT_DIR = join(process.cwd(), 'data', 'browser-screenshots');

// 点击标记截图保存目录 - 使用项目根目录下的 data 文件夹
const MARKED_CLICKS_DIR = join(process.cwd(), 'data', 'marked-clicks');

// 系统截图保存目录 - 使用项目根目录下的 data 文件夹
const SYSTEM_SCREENSHOT_DIR = join(process.cwd(), 'data', 'screenshots');

/**
 * 创建路由插件
 */
export function registerRoutes(gateway: Gateway): FastifyPluginAsync {
	return async (fastify) => {
		// ==================== 健康检查 ====================

		fastify.get('/health', async () => {
			return {
				status: 'ok',
				version: '0.1.0',
				uptime: process.uptime(),
			};
		});

		// ==================== 配置管理 ====================

		fastify.get('/config', async () => {
			return gateway.config.getAll();
		});

		fastify.put('/config', async (request: FastifyRequest<{ Body: Record<string, unknown> }>) => {
			const updates = request.body;
			for (const [key, value] of Object.entries(updates)) {
				gateway.config.set(key, value);
			}
			gateway.config.save();
			return { success: true, config: gateway.config.getAll() };
		});

		// ==================== AI Provider 管理 ====================

		fastify.get('/providers', async () => {
			return gateway.providerManager.listProviders();
		});

		fastify.post(
			'/providers',
			async (
				request: FastifyRequest<{
					Body: {
						id?: string;
						name: string;
						baseUrl: string;
						apiKey: string;
						type?: string;
						models?: string[];
						defaultModel?: string;
						supportsVision?: boolean;
					};
				}>,
				reply: FastifyReply
			) => {
				const { id, name, baseUrl, apiKey, type, models, defaultModel, supportsVision } = request.body;

				if (!name || !baseUrl || !apiKey) {
					return reply.code(400).send({
						error: true,
						message: 'Missing required fields: name, baseUrl, apiKey',
					});
				}

				// 使用 name 作为 id
				const providerId = id || name;

				gateway.providerManager.addProvider(providerId, {
					id: providerId,
					name,
					baseUrl,
					apiKey,
					type: (type as 'openai' | 'anthropic') || 'openai',
					models: models || [],
					defaultModel,
					supportsVision: supportsVision ?? true, // 默认开启
				});

				return { success: true, id: providerId };
			}
		);

		fastify.put<{
			Params: { id: string };
			Body: {
				name?: string;
				baseUrl?: string;
				apiKey?: string;
				type?: string;
				defaultModel?: string;
				supportsVision?: boolean;
			};
		}>('/providers/:id', async (request, reply) => {
			const { id } = request.params;
			const { name, baseUrl, apiKey, type, defaultModel, supportsVision } = request.body;

			let provider = gateway.providerManager.getProvider(id);

			// 如果内存中不存在但有完整配置信息，则重新创建
			if (!provider && baseUrl && apiKey) {
				provider = gateway.providerManager.addProvider(id, {
					id,
					name: name || id,
					baseUrl,
					apiKey,
					type: (type as 'openai' | 'anthropic') || 'openai',
					defaultModel,
				});
			}

			if (!provider) {
				const availableIds = gateway.providerManager.listProviders().map((p) => p.id);
				return reply.code(404).send({
					error: true,
					message: `Provider "${id}" 不存在。可用的 Provider: ${availableIds.length > 0 ? availableIds.join(', ') : '无'}。请提供完整的配置信息（包括 API Key）来创建新的 Provider。`,
				});
			}

			// 更新 Provider 属性
			if (name !== undefined) provider.setDisplayName(name);
			if (baseUrl !== undefined) provider.baseUrl = baseUrl;
			if (apiKey !== undefined) provider.apiKey = apiKey;
			if (type !== undefined) provider.setProviderType(type);
			if (defaultModel !== undefined) provider.defaultModel = defaultModel;
			if (supportsVision !== undefined) provider.supportsVision = supportsVision;

			// 保存到配置
			gateway.config.updateProvider(id, {
				id,
				name: provider.getDisplayName(),
				baseUrl: provider.baseUrl,
				apiKey: provider.apiKey,
				type: (provider.type === 'openai' || provider.type === 'anthropic') ? provider.type : 'openai',
				models: provider.models,
				supportsVision: provider.supportsVision,
			});

			return { success: true, provider: provider.getInfo() };
		});

		fastify.delete<{ Params: { id: string } }>('/providers/:id', async (request, reply) => {
			try {
				gateway.providerManager.removeProvider(request.params.id);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		fastify.get<{
			Params: { id: string };
			Querystring: { model?: string };
		}>('/providers/:id/test', async (request, reply) => {
			try {
				const result = await gateway.providerManager.testProvider(request.params.id, request.query.model);
				return result;
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 测试 Provider 是否支持 Vision（图像理解）
		fastify.get<{
			Params: { id: string };
			Querystring: { model?: string };
		}>('/providers/:id/test-vision', async (request, reply) => {
			try {
				const model = request.query.model;
				if (!model) {
					return reply.code(400).send({
						supported: false,
						message: 'No model specified',
					});
				}
				const result = await gateway.providerManager.testVisionSupport(request.params.id, model);
				return result;
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 更新 Provider 配置（如 supportsVision）
		fastify.patch<{
			Params: { id: string };
			Body: { supportsVision?: boolean };
		}>('/providers/:id', async (request, reply) => {
			try {
				gateway.providerManager.updateProvider(request.params.id, request.body);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 更新单个模型的配置（如 Vision 支持）
		fastify.patch<{
			Params: { id: string; model: string };
			Body: { supportsVision?: boolean };
		}>('/providers/:id/models/:model', async (request, reply) => {
			try {
				const { id, model } = request.params;
				const { supportsVision } = request.body;

				gateway.providerManager.updateModelVisionSupport(id, model, supportsVision ?? false);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		fastify.get<{
			Params: { id: string };
			Querystring: { refresh?: string };
		}>('/providers/:id/models', async (request, reply) => {
			const { id } = request.params;
			const forceRefresh = request.query.refresh === 'true';
			const provider = gateway.providerManager.getProvider(id);

			if (!provider) {
				const availableIds = gateway.providerManager.listProviders().map((p) => p.id);
				return reply.code(404).send({
					error: true,
					message: `Provider "${id}" 不存在。可用的 Provider: ${availableIds.length > 0 ? availableIds.join(', ') : '无'}。可能需要重新添加该 Provider。`,
				});
			}

			try {
				const models = await provider.listModels(forceRefresh);
				return { models };
			} catch (error) {
				return reply.code(400).send({
					error: true,
					message: (error as Error).message,
					hint: '您可以手动输入模型名称',
				});
			}
		});

		// ==================== 模型库管理 ====================

		// 获取模型库
		fastify.get('/models', async () => {
			return gateway.config.getModelLibrary();
		});

		// 添加模型到模型库
		fastify.post<{
			Body: {
				id: string;
				name: string;
				providerId: string;
				supportsVision?: boolean;
				supportsFunctionCall?: boolean;
				supportsThinking?: boolean;
				description?: string;
			};
		}>('/models', async (request, reply) => {
			try {
				const { id, name, providerId, supportsVision, supportsFunctionCall, supportsThinking, description } = request.body;

				gateway.config.addModel({
					id,
					name,
					providerId,
					enabled: true,
					supportsVision,
					supportsFunctionCall,
					supportsThinking,
					description,
				});
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 批量添加模型
		fastify.post<{
			Body: { models: Array<{ id: string; name: string; providerId: string; supportsVision?: boolean }> };
		}>('/models/batch', async (request, reply) => {
			try {
				const { models } = request.body;
				const modelsToAdd = models.map(m => ({
					...m,
					enabled: true,
				}));
				gateway.config.addModels(modelsToAdd);
				return { success: true, count: models.length };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 更新模型
		fastify.put<{
			Params: { id: string };
			Body: Partial<{
				name: string;
				providerId: string;
				enabled: boolean;
				supportsVision: boolean;
				supportsFunctionCall: boolean;
				supportsThinking: boolean;
				description: string;
			}>;
		}>('/models/:id', async (request, reply) => {
			try {
				gateway.config.updateModel(request.params.id, request.body);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 删除模型
		fastify.delete<{ Params: { id: string } }>('/models/:id', async (request, reply) => {
			try {
				gateway.config.removeModel(request.params.id);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 设置默认模型
		fastify.post<{
			Body: { modelId: string | null };
		}>('/models/default', async (request, reply) => {
			try {
				gateway.config.setDefaultModel(request.body.modelId || undefined);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 测试模型连接
		fastify.get<{
			Params: { id: string };
		}>('/models/:id/test', async (request, reply) => {
			try {
				const model = gateway.config.getModelLibrary().models.find(m => m.id === request.params.id);
				if (!model) {
					return reply.code(404).send({ error: true, message: 'Model not found' });
				}

				// 通过 providerId 获取供应商
				const provider = gateway.providerManager.getProvider(model.providerId);
				if (!provider) {
					return reply.code(404).send({ error: true, message: `Provider not found: ${model.providerId}` });
				}

				// 发送一个简单的测试消息
				const messages = [{ role: 'user', content: 'Hi' }];
				const chunks: string[] = [];
				for await (const chunk of provider.chat(model.name, messages, { maxTokens: 10 })) {
					if (chunk.content) {
						chunks.push(chunk.content);
					}
				}
				return { success: true, message: '连接成功', response: chunks.join('') };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// ==================== 聊天接口 ====================

		fastify.post<{
			Body: { message: string; sessionId?: string; options?: Record<string, unknown> };
		}>('/chat', async (request, reply) => {
			const { message, sessionId, options } = request.body;

			if (!message) {
				return reply.code(400).send({ error: true, message: 'Missing message' });
			}

			// SSE 响应（需要手动添加 CORS 头）
			reply.raw.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Credentials': 'true',
			});

			try {
				for await (const chunk of gateway.chat(message, { sessionId, ...options })) {
					reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}
				reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
			} catch (error) {
				reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
			}

			reply.raw.end();
		});

		// ==================== 会话管理 ====================

		fastify.get('/sessions', async () => {
			return gateway.sessionManager.listSessions();
		});

		// 创建新会话
		fastify.post('/sessions', async (request) => {
			const { title, context } = request.body as { title?: string; context?: Record<string, unknown> } || {};
			const session = gateway.sessionManager.createSession({ title, context });
			return session;
		});

		fastify.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
			const session = gateway.sessionManager.getSession(request.params.id);
			if (!session) {
				return reply.code(404).send({ error: true, message: 'Session not found' });
			}
			return session;
		});

		fastify.delete<{ Params: { id: string } }>('/sessions/:id', async (request) => {
			gateway.sessionManager.deleteSession(request.params.id);
			return { success: true };
		});

		fastify.get<{ Params: { id: string } }>('/sessions/:id/history', async (request, reply) => {
			const { id } = request.params;
			try {
				// 先尝试重新加载会话（以防会话在内存中不存在但在文件中存在）
				let session = gateway.sessionManager.getSession(id);
				if (!session) {
					console.log(`[history] 会话 ${id} 不在内存中，尝试重新加载...`);
					await gateway.sessionManager.forceReloadSessions();
					session = gateway.sessionManager.getSession(id);
				}
				
				if (!session) {
					console.warn(`[history] 会话 ${id} 不存在`);
					return reply.code(404).send({ error: true, message: 'Session not found' });
				}
				
				const history = gateway.sessionManager.getHistory(id);
				console.log(`[history] 成功获取会话 ${id} 的历史，共 ${history.length} 条消息`);
				return history;
			} catch (error) {
				const message = (error as Error).message;
				console.error(`[history] 获取会话 ${id} 历史失败: ${message}`);
				return reply.code(500).send({ error: true, message: `Failed to load history: ${message}` });
			}
		});

		// 更新会话中的消息（用于前端更新消息内容，如终止操作后保存状态）
		fastify.put<{ Params: { id: string; messageId: string }, Body: { content?: string; metadata?: Record<string, unknown> } }>('/sessions/:id/messages/:messageId', async (request, reply) => {
			const { id, messageId } = request.params;
			const { content, metadata } = request.body || {};
			
			try {
				const session = gateway.sessionManager.getSession(id);
				if (!session) {
					return reply.code(404).send({ error: true, message: 'Session not found' });
				}
				
				await gateway.sessionManager.updateMessage(id, messageId, { content, metadata });
				console.log(`[updateMessage] 成功更新会话 ${id} 的消息 ${messageId}`);
				return { success: true };
			} catch (error) {
				const message = (error as Error).message;
				console.error(`[updateMessage] 更新消息失败: ${message}`);
				return reply.code(500).send({ error: true, message: `Failed to update message: ${message}` });
			}
		});

		// 清空所有会话
		fastify.delete('/sessions', async () => {
			await gateway.sessionManager.clearAllSessions();
			return { success: true };
		});

		// ==================== 工具管理 ====================

		// 获取工具列表（支持分组）
		fastify.get<{
			Querystring: { grouped?: string };
		}>('/tools', async (request) => {
			const grouped = request.query.grouped === 'true';
			if (grouped) {
				return gateway.toolRegistry.listToolsGrouped();
			}
			return gateway.toolRegistry.listTools();
		});

		fastify.get<{ Params: { name: string } }>('/tools/:name', async (request, reply) => {
			const tool = gateway.toolRegistry.getTool(request.params.name);
			if (!tool) {
				return reply.code(404).send({ error: true, message: 'Tool not found' });
			}
			return tool.getSchema();
		});

		// ==================== 定时任务管理 ====================

		fastify.get('/cron', async () => {
			return gateway.cronManager.listJobs();
		});

		fastify.post<{
			Body: { id?: string; schedule: string; task: string; enabled?: boolean };
		}>('/cron', async (request, reply) => {
			const { id, schedule, task, enabled } = request.body;

			if (!schedule || !task) {
				return reply.code(400).send({
					error: true,
					message: 'Missing required fields: schedule, task',
				});
			}

			const job = gateway.cronManager.addJob({ id, schedule, task, enabled });
			return { success: true, job };
		});

		fastify.put<{
			Params: { id: string };
			Body: { schedule?: string; task?: string; enabled?: boolean };
		}>('/cron/:id', async (request, reply) => {
			try {
				const job = gateway.cronManager.updateJob(request.params.id, request.body);
				return { success: true, job };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		fastify.delete<{ Params: { id: string } }>('/cron/:id', async (request, reply) => {
			try {
				gateway.cronManager.removeJob(request.params.id);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		fastify.post<{ Params: { id: string } }>('/cron/:id/run', async (request, reply) => {
			try {
				const result = await gateway.cronManager.runJob(request.params.id);
				return { success: true, result };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// ==================== 日志 ====================

		fastify.get<{
			Querystring: { limit?: string; level?: string; since?: string };
		}>('/logs', async (request) => {
			const { limit = '100', level, since } = request.query;
			return gateway.getLogs({ limit: parseInt(limit), level, since });
		});

		// ==================== 系统状态 ====================

		fastify.get('/status', async () => {
			return gateway.getStatus();
		});

		// ==================== 用户设置 ====================

		fastify.get('/user', async () => {
			return {
				aiName: gateway.config.get<string>('user.aiName') || 'NutBot',
				name: gateway.config.get<string>('user.name'),
				location: gateway.config.get<string>('user.location'),
				timezone: gateway.config.get<string>('user.timezone'),
				customPrompt: gateway.config.get<string>('user.customPrompt'),
				language: gateway.config.get<string>('user.language'),
			};
		});

		fastify.put<{
			Body: {
				aiName?: string;
				name?: string;
				location?: string;
				timezone?: string;
				customPrompt?: string;
				language?: string;
			};
		}>('/user', async (request) => {
			const { aiName, name, location, timezone, customPrompt, language } = request.body;

			if (aiName !== undefined) gateway.config.set('user.aiName', aiName || 'NutBot');
			if (name !== undefined) gateway.config.set('user.name', name || null);
			if (location !== undefined) gateway.config.set('user.location', location || null);
			if (timezone !== undefined) gateway.config.set('user.timezone', timezone || null);
			if (customPrompt !== undefined) gateway.config.set('user.customPrompt', customPrompt || null);
			if (language !== undefined) gateway.config.set('user.language', language || null);

			gateway.config.save();
			return { success: true };
		});

		// ==================== Agent 配置 ====================

		fastify.get('/agent', async () => {
			// 返回当前选中的 Agent Profile 配置（模型配置已从 Agent 移除，使用全局模型库）
			const current = gateway.agentProfiles.getCurrent();
			const modelLibrary = gateway.config.getModelLibrary();
			return {
				// 默认模型从模型库获取
				defaultModel: modelLibrary.defaultModelId,
				systemPrompt: current.systemPrompt || gateway.config.get<string | null>('agent.systemPrompt'),
				maxIterations: current.maxIterations || gateway.config.get<number>('agent.maxIterations', 30),
				timeout: current.timeout || gateway.config.get<number>('agent.timeout', 300000),
				debugMode: gateway.config.get<boolean>('agent.debugMode', false),
				temperature: current.temperature || gateway.config.get<number | null>('agent.temperature'),
				maxTokens: current.maxTokens || gateway.config.get<number | null>('agent.maxTokens'),
			};
		});

		fastify.put<{
			Body: {
				systemPrompt?: string | null;
				maxIterations?: number;
				timeout?: number;
				debugMode?: boolean;
				temperature?: number | null;
				maxTokens?: number | null;
			};
		}>('/agent', async (request) => {
			const body = request.body;
			// 注意：defaultModel 已从 Agent 配置中移除，请在 Provider 页面设置默认模型
			if (body.systemPrompt !== undefined) gateway.config.set('agent.systemPrompt', body.systemPrompt);
			if (body.maxIterations !== undefined) gateway.config.set('agent.maxIterations', body.maxIterations);
			if (body.timeout !== undefined) gateway.config.set('agent.timeout', body.timeout);
			if (body.debugMode !== undefined) gateway.config.set('agent.debugMode', body.debugMode);
			if (body.temperature !== undefined) gateway.config.set('agent.temperature', body.temperature);
			if (body.maxTokens !== undefined) gateway.config.set('agent.maxTokens', body.maxTokens);
			gateway.config.save();

			// 更新当前 Agent Profile（不再包含 model）
			const currentId = gateway.agentProfiles.getCurrentId();
			await gateway.agentProfiles.update(currentId, {
				systemPrompt: body.systemPrompt || undefined,
				maxIterations: body.maxIterations,
				timeout: body.timeout,
				temperature: body.temperature || undefined,
				maxTokens: body.maxTokens || undefined,
			});

			return { success: true };
		});

		// ==================== Agent Profiles 管理 ====================

		// 获取所有 Agent 列表
		fastify.get('/agents', async () => {
			return {
				agents: gateway.agentProfiles.list(),
				currentId: gateway.agentProfiles.getCurrentId(),
			};
		});

		// 创建新 Agent
		fastify.post<{
			Body: {
				name: string;
				description?: string;
				icon?: string;
				model?: string;
				temperature?: number;
				maxTokens?: number;
				systemPrompt?: string;
				maxIterations?: number;
				timeout?: number;
				tools?: { enabled?: string[]; disabled?: string[] };
			};
		}>('/agents', async (request, reply) => {
			try {
				const agent = await gateway.agentProfiles.create(request.body);
				return { success: true, agent };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 获取单个 Agent
		fastify.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
			const agent = gateway.agentProfiles.get(request.params.id);
			if (!agent) {
				return reply.code(404).send({ error: true, message: 'Agent not found' });
			}
			return agent;
		});

		// 更新 Agent
		fastify.put<{
			Params: { id: string };
			Body: {
				name?: string;
				description?: string;
				icon?: string;
				model?: string;
				temperature?: number;
				maxTokens?: number;
				systemPrompt?: string;
				maxIterations?: number;
				timeout?: number;
				tools?: { enabled?: string[]; disabled?: string[] };
			};
		}>('/agents/:id', async (request, reply) => {
			try {
				const agent = await gateway.agentProfiles.update(request.params.id, request.body);
				return { success: true, agent };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 删除 Agent
		fastify.delete<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
			try {
				await gateway.agentProfiles.delete(request.params.id);
				return { success: true };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 复制 Agent
		fastify.post<{ Params: { id: string } }>('/agents/:id/duplicate', async (request, reply) => {
			try {
				const agent = await gateway.agentProfiles.duplicate(request.params.id);
				return { success: true, agent };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 导出 Agent
		fastify.get<{ Params: { id: string } }>('/agents/:id/export', async (request, reply) => {
			try {
				const data = gateway.agentProfiles.export(request.params.id);
				const agent = gateway.agentProfiles.get(request.params.id);
				const filename = `${agent?.name || 'agent'}.nutbot-agent.json`;

				reply.header('Content-Type', 'application/json');
				reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
				return data;
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 导入 Agent
		fastify.post<{
			Body: {
				version: number;
				agent: {
					name: string;
					description?: string;
					icon?: string;
					model?: string;
					temperature?: number;
					maxTokens?: number;
					systemPrompt?: string;
					maxIterations?: number;
					timeout?: number;
					tools?: { enabled?: string[]; disabled?: string[] };
				};
			};
		}>('/agents/import', async (request, reply) => {
			try {
				const agent = await gateway.agentProfiles.import(request.body);
				return { success: true, agent };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// 设置当前 Agent
		fastify.post<{ Body: { id: string } }>('/agents/current', async (request, reply) => {
			try {
				await gateway.agentProfiles.setCurrent(request.body.id);
				return { success: true, currentId: request.body.id };
			} catch (error) {
				return reply.code(400).send({ error: true, message: (error as Error).message });
			}
		});

		// ==================== MCP 配置 ====================

		fastify.get('/mcp', async () => {
			return {
				enabled: gateway.config.get<boolean>('mcp.enabled', true),
				servers: gateway.config.get<unknown[]>('mcp.servers', []),
			};
		});

		fastify.put<{
			Body: {
				enabled?: boolean;
				servers?: Array<{ name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string }>;
			};
		}>('/mcp', async (request) => {
			const { enabled, servers } = request.body;
			if (enabled !== undefined) gateway.config.set('mcp.enabled', enabled);
			if (servers !== undefined) gateway.config.set('mcp.servers', servers);
			gateway.config.save();
			return { success: true };
		});

		// MCP 热重载
		fastify.post('/mcp/reload', async () => {
			try {
				const result = await gateway.toolRegistry.reloadMcpTools();
				return {
					success: true,
					...result,
				};
			} catch (error) {
				return {
					success: false,
					error: (error as Error).message,
				};
			}
		});

		// ==================== Skills 配置 ====================

		fastify.get('/skills', async () => {
			const { loadSkills } = await import('../../services/skills-loader.js');
			const skills = loadSkills(gateway.config);
			return {
				enabled: gateway.config.get<boolean>('skills.enabled', true),
				directory: gateway.config.get<string>('skills.directory', './skills'),
				autoload: gateway.config.get<boolean>('skills.autoload', true),
				includeInPrompt: gateway.config.get<boolean>('skills.includeInPrompt', true),
				loaded: skills.map((s) => ({ name: s.name, description: s.description })),
			};
		});

		fastify.put<{
			Body: {
				enabled?: boolean;
				directory?: string;
				autoload?: boolean;
				includeInPrompt?: boolean;
			};
		}>('/skills', async (request) => {
			const body = request.body;
			if (body.enabled !== undefined) gateway.config.set('skills.enabled', body.enabled);
			if (body.directory !== undefined) gateway.config.set('skills.directory', body.directory);
			if (body.autoload !== undefined) gateway.config.set('skills.autoload', body.autoload);
			if (body.includeInPrompt !== undefined) gateway.config.set('skills.includeInPrompt', body.includeInPrompt);
			gateway.config.save();
			return { success: true };
		});

		// ==================== 记忆管理 ====================

		fastify.get('/memories', async () => {
			return memoryManager.list();
		});

		fastify.get<{ Querystring: { category?: string } }>('/memories/search', async (request) => {
			const { category } = request.query;
			if (category) {
				return memoryManager.listByCategory(category as Memory['category']);
			}
			return memoryManager.list();
		});

		fastify.get<{ Params: { id: string } }>('/memories/:id', async (request, reply) => {
			const memory = memoryManager.get(request.params.id);
			if (!memory) {
				return reply.code(404).send({ error: true, message: 'Memory not found' });
			}
			return memory;
		});

		fastify.post<{
			Body: {
				content: string;
				category: Memory['category'];
				tags?: string[];
			};
		}>('/memories', async (request, reply) => {
			const { content, category, tags } = request.body;

			if (!content || !category) {
				return reply.code(400).send({
					error: true,
					message: 'Missing required fields: content, category',
				});
			}

			const memory = memoryManager.add({ content, category, tags });
			return { success: true, memory };
		});

		fastify.put<{
			Params: { id: string };
			Body: {
				content?: string;
				category?: Memory['category'];
				tags?: string[];
			};
		}>('/memories/:id', async (request, reply) => {
			const memory = memoryManager.update(request.params.id, request.body);
			if (!memory) {
				return reply.code(404).send({ error: true, message: 'Memory not found' });
			}
			return { success: true, memory };
		});

		fastify.delete<{ Params: { id: string } }>('/memories/:id', async (request, reply) => {
			const deleted = memoryManager.delete(request.params.id);
			if (!deleted) {
				return reply.code(404).send({ error: true, message: 'Memory not found' });
			}
			return { success: true };
		});

		fastify.delete('/memories', async () => {
			memoryManager.clear();
			return { success: true };
		});

		// ==================== 浏览器管理 ====================

		// 初始化浏览器服务
		await browserService.init(gateway.config);

		// 打开独立浏览器
		fastify.post<{
			Body: { url?: string };
		}>('/browser/open', async (request, reply) => {
			try {
				const { url } = request.body || {};
				const result = await browserService.open(url);
				return result;
			} catch (error) {
				return reply.code(500).send({
					success: false,
					message: (error as Error).message,
				});
			}
		});

		// 关闭浏览器
		fastify.post('/browser/close', async () => {
			return await browserService.close();
		});

		// 获取浏览器状态
		fastify.get('/browser/status', async () => {
			return await browserService.getStatus();
		});

		// 导航到 URL
		fastify.post<{
			Body: { url: string };
		}>('/browser/navigate', async (request, reply) => {
			const { url } = request.body || {};
			if (!url) {
				return reply.code(400).send({
					success: false,
					message: 'Missing url parameter',
				});
			}
			return await browserService.navigate(url);
		});

		// 检测系统浏览器
		fastify.get('/browser/detect', async () => {
			const browsers = await browserService.detectBrowsers();
			
			// 获取系统默认浏览器
			const { getSystemDefaultBrowser } = await import('../../services/browser/launcher.js');
			const defaultBrowser = getSystemDefaultBrowser();
			
			return {
				success: true,
				browsers,
				platform: process.platform,
				path: defaultBrowser.executablePath,
				type: defaultBrowser.type,
			};
		});

		// 获取浏览器配置
		fastify.get('/browser/config', async () => {
			return browserService.getConfig();
		});

		// 更新浏览器配置
		fastify.put<{
			Body: Partial<BrowserConfig>;
		}>('/browser/config', async (request) => {
			browserService.updateConfig(request.body);
			return { success: true, config: browserService.getConfig() };
		});

		// ==================== 浏览器截图访问接口 ====================

		// 获取浏览器截图文件
		fastify.get<{ Params: { filename: string } }>('/screenshots/browser/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			// 安全检查：防止目录遍历攻击
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(BROWSER_SCREENSHOT_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/png');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});

		// 获取点击标记截图文件
		fastify.get<{ Params: { filename: string } }>('/screenshots/marked-clicks/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			// 安全检查：防止目录遍历攻击
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(MARKED_CLICKS_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Marked screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/png');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});

		// 获取系统截图文件
		fastify.get<{ Params: { filename: string } }>('/screenshots/system/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			// 安全检查：防止目录遍历攻击
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(SYSTEM_SCREENSHOT_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/jpeg');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});

	};
}

/**
 * 注册截图服务路由（独立注册，不带 /api 前缀）
 */
export function registerScreenshotRoutes(): FastifyPluginAsync {
	return async (fastify) => {
		// 获取浏览器截图文件
		fastify.get<{ Params: { filename: string } }>('/browser/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(BROWSER_SCREENSHOT_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/png');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});

		// 获取点击标记截图文件
		fastify.get<{ Params: { filename: string } }>('/marked-clicks/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(MARKED_CLICKS_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Marked screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/png');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});

		// 获取系统截图文件
		fastify.get<{ Params: { filename: string } }>('/system/:filename', async (request, reply) => {
			const { filename } = request.params;
			
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
				return reply.code(400).send({ error: true, message: 'Invalid filename' });
			}
			
			const filePath = join(SYSTEM_SCREENSHOT_DIR, filename);
			
			if (!existsSync(filePath)) {
				return reply.code(404).send({ error: true, message: 'Screenshot not found' });
			}
			
			reply.header('Content-Type', 'image/jpeg');
			reply.header('Cache-Control', 'public, max-age=3600');
			return reply.send(createReadStream(filePath));
		});
	};
}

export default registerRoutes;
