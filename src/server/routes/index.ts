/**
 * API 路由
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Gateway } from '../../gateway/index.js';
import { memoryManager, type Memory } from '../../memory/index.js';
import { ocrSomService, type OcrSomOptions } from '../../services/ocr-som.js';

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
						id: string;
						name?: string;
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

				if (!id || !baseUrl || !apiKey) {
					return reply.code(400).send({
						error: true,
						message: 'Missing required fields: id, baseUrl, apiKey',
					});
				}

				gateway.providerManager.addProvider(id, {
					id,
					name: name || id,
					baseUrl,
					apiKey,
					type: (type as 'openai' | 'anthropic') || 'openai',
					models: models || [],
					defaultModel,
					supportsVision: supportsVision ?? true, // 默认开启
				});

				return { success: true, id };
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
			if (name !== undefined) provider.name = name;
			if (baseUrl !== undefined) provider.baseUrl = baseUrl;
			if (apiKey !== undefined) provider.apiKey = apiKey;
			if (type !== undefined) provider.type = type as 'openai' | 'anthropic';
			if (defaultModel !== undefined) provider.defaultModel = defaultModel;
			if (supportsVision !== undefined) provider.supportsVision = supportsVision;

			// 保存到配置
			gateway.config.updateProvider(id, {
				id,
				name: provider.name,
				baseUrl: provider.baseUrl,
				apiKey: provider.apiKey,
				type: provider.type,
				defaultModel: provider.defaultModel || undefined,
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

		fastify.put<{
			Params: { id: string };
			Body: { models: string[] };
		}>('/providers/:id/models', async (request, reply) => {
			const { models } = request.body;
			const provider = gateway.providerManager.getProvider(request.params.id);
			if (!provider) {
				return reply.code(404).send({ error: true, message: 'Provider not found' });
			}

			provider.models = models || [];
			gateway.config.updateProvider(request.params.id, {
				id: request.params.id,
				type: provider.type,
				baseUrl: provider.baseUrl,
				apiKey: provider.apiKey,
				models: provider.models,
			});

			return { success: true, models: provider.models };
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

		fastify.get<{ Params: { id: string } }>('/sessions/:id/history', async (request) => {
			return gateway.sessionManager.getHistory(request.params.id);
		});

		// ==================== 工具管理 ====================

		fastify.get('/tools', async () => {
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
				name: gateway.config.get<string>('user.name'),
				location: gateway.config.get<string>('user.location'),
				timezone: gateway.config.get<string>('user.timezone'),
				customPrompt: gateway.config.get<string>('user.customPrompt'),
				language: gateway.config.get<string>('user.language'),
			};
		});

		fastify.put<{
			Body: {
				name?: string;
				location?: string;
				timezone?: string;
				customPrompt?: string;
				language?: string;
			};
		}>('/user', async (request) => {
			const { name, location, timezone, customPrompt, language } = request.body;

			if (name !== undefined) gateway.config.set('user.name', name || null);
			if (location !== undefined) gateway.config.set('user.location', location || null);
			if (timezone !== undefined) gateway.config.set('user.timezone', timezone || null);
			if (customPrompt !== undefined) gateway.config.set('user.customPrompt', customPrompt || null);
			if (language !== undefined) gateway.config.set('user.language', language || null);

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

		// ==================== OCR-SoM 服务 ====================

		// 检查 OCR-SoM 连接
		fastify.get('/ocr/status', async () => {
			return ocrSomService.checkConnection();
		});

		// 获取 OCR 配置
		fastify.get('/ocr/config', async () => {
			return {
				enabled: gateway.config.get<boolean>('ocr.enabled', true),
				baseUrl: gateway.config.get<string>('ocr.baseUrl', 'http://localhost:5000'),
				timeout: gateway.config.get<number>('ocr.timeout', 30000),
			};
		});

		// 更新 OCR 配置
		fastify.put<{
			Body: {
				enabled?: boolean;
				baseUrl?: string;
				timeout?: number;
			};
		}>('/ocr/config', async (request) => {
			const { enabled, baseUrl, timeout } = request.body;

			if (enabled !== undefined) gateway.config.set('ocr.enabled', enabled);
			if (baseUrl !== undefined) gateway.config.set('ocr.baseUrl', baseUrl);
			if (timeout !== undefined) gateway.config.set('ocr.timeout', timeout);

			gateway.config.save();
			return { success: true };
		});

		// OCR 识别（SoM 标注）
		fastify.post<{
			Body: {
				image_base64: string;
				options?: OcrSomOptions;
			};
		}>('/ocr/analyze', async (request, reply) => {
			const { image_base64, options } = request.body;

			if (!image_base64) {
				return reply.code(400).send({
					success: false,
					error: 'Missing image_base64',
				});
			}

			const result = await ocrSomService.analyze(image_base64, options || {});
			return result;
		});

		// 仅 OCR 识别
		fastify.post<{
			Body: { image_base64: string };
		}>('/ocr/text', async (request, reply) => {
			const { image_base64 } = request.body;

			if (!image_base64) {
				return reply.code(400).send({
					success: false,
					error: 'Missing image_base64',
				});
			}

			const result = await ocrSomService.ocr(image_base64);
			return result;
		});
	};
}

export default registerRoutes;
