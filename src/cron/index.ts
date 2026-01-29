/**
 * Cron 定时任务管理
 */

import { Cron } from 'croner';
import { logger } from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';
import type { Gateway } from '../gateway/index.js';
import type { CronJob } from '../types/index.js';

interface CronJobInternal extends CronJob {
	name?: string;
	runCount: number;
	createdAt: string;
}

interface TaskConfig {
	type: string;
	name?: string;
	params?: Record<string, unknown>;
	message?: string;
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

/**
 * Cron 管理器
 */
export class CronManager {
	private gateway: Gateway;
	private jobs: Map<string, CronJobInternal> = new Map();
	private cronInstances: Map<string, Cron> = new Map();
	private logger = logger.child('CronManager');

	constructor(gateway: Gateway) {
		this.gateway = gateway;
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		// 加载配置中的任务
		const jobs = this.gateway.config.get<CronJob[]>('cron.jobs', []);

		for (const jobConfig of jobs) {
			this.addJob(jobConfig, false);
		}

		this.logger.info(`已加载 ${this.jobs.size} 个定时任务`);
	}

	/**
	 * 启动调度器
	 */
	async start(): Promise<void> {
		for (const [id, job] of this.jobs.entries()) {
			if (job.enabled) {
				this.scheduleJob(id);
			}
		}
		this.logger.info('定时任务调度器已启动');
	}

	/**
	 * 停止调度器
	 */
	async stop(): Promise<void> {
		for (const cron of this.cronInstances.values()) {
			cron.stop();
		}
		this.cronInstances.clear();
		this.logger.info('定时任务调度器已停止');
	}

	/**
	 * 添加任务
	 */
	addJob(config: Partial<CronJob> & { schedule: string; task: string }, save = true): CronJobInternal {
		const job: CronJobInternal = {
			id: config.id || generateId('cron'),
			name: config.task,
			schedule: config.schedule,
			task: config.task,
			enabled: config.enabled !== false,
			lastRun: undefined,
			nextRun: undefined,
			runCount: 0,
			createdAt: new Date().toISOString(),
		};

		// 验证 cron 表达式
		try {
			new Cron(job.schedule);
		} catch {
			throw new Error(`Invalid cron schedule: ${job.schedule}`);
		}

		this.jobs.set(job.id, job);

		// 如果已启动，立即调度
		if (job.enabled) {
			this.scheduleJob(job.id);
		}

		// 保存到配置
		if (save) {
			this.saveJobs();
		}

		this.logger.info(`已添加定时任务: ${job.id} (${job.schedule})`);

		return job;
	}

	/**
	 * 更新任务
	 */
	updateJob(id: string, updates: Partial<CronJob>): CronJobInternal {
		const job = this.jobs.get(id);
		if (!job) {
			throw new Error(`Cron job not found: ${id}`);
		}

		// 停止旧的调度
		this.unscheduleJob(id);

		// 更新配置
		Object.assign(job, updates);

		// 重新调度
		if (job.enabled) {
			this.scheduleJob(id);
		}

		this.saveJobs();
		this.logger.info(`已更新定时任务: ${id}`);

		return job;
	}

	/**
	 * 移除任务
	 */
	removeJob(id: string): void {
		this.unscheduleJob(id);
		this.jobs.delete(id);
		this.saveJobs();
		this.logger.info(`已移除定时任务: ${id}`);
	}

	/**
	 * 调度任务
	 */
	private scheduleJob(id: string): void {
		const job = this.jobs.get(id);
		if (!job) return;

		// 停止已有的调度
		this.unscheduleJob(id);

		const cron = new Cron(
			job.schedule,
			{
				name: job.id,
				catch: (error) => {
					this.logger.error(`定时任务出错 (${id}):`, (error as Error).message);
				},
			},
			() => {
				this.executeJob(id);
			}
		);

		this.cronInstances.set(id, cron);

		// 更新下次运行时间
		const next = cron.nextRun();
		if (next) {
			job.nextRun = next.toISOString();
		}

		this.logger.debug(`已调度定时任务: ${id}, 下次执行: ${job.nextRun}`);
	}

	/**
	 * 取消调度
	 */
	private unscheduleJob(id: string): void {
		const cron = this.cronInstances.get(id);
		if (cron) {
			cron.stop();
			this.cronInstances.delete(id);
		}
	}

	/**
	 * 执行任务
	 */
	private async executeJob(id: string): Promise<{
		success: boolean;
		result: unknown;
		error: string | null;
		duration: number;
	} | null> {
		const job = this.jobs.get(id);
		if (!job) return null;

		this.logger.info(`执行定时任务: ${id}`);

		const startTime = Date.now();
		let result: unknown = null;
		let error: string | null = null;

		try {
			// 解析任务
			const task = this.parseTask(job.task);

			// 执行
			switch (task.type) {
				case 'tool':
					result = await this.gateway.executeTool(task.name!, task.params || {});
					break;

				case 'chat':
					// 执行聊天任务
					const session = this.gateway.sessionManager.createSession({
						metadata: { cron: id },
					});
					const chunks: unknown[] = [];
					for await (const chunk of this.gateway.chat(task.message!, { sessionId: session.id })) {
						chunks.push(chunk);
					}
					result = chunks;
					break;

				case 'webhook':
					result = await this.executeWebhook(task);
					break;

				default:
					throw new Error(`Unknown task type: ${task.type}`);
			}
		} catch (e) {
			error = (e as Error).message;
			this.logger.error(`定时任务失败 (${id}):`, error);
		}

		// 更新状态
		job.lastRun = new Date().toISOString();
		job.runCount++;

		// 更新下次运行时间
		const cron = this.cronInstances.get(id);
		if (cron) {
			const next = cron.nextRun();
			if (next) {
				job.nextRun = next.toISOString();
			}
		}

		const duration = Date.now() - startTime;
		this.logger.info(`定时任务完成 (${id}): ${duration}ms`);

		// 发送事件
		this.gateway.emit?.('cron:executed', {
			jobId: id,
			duration,
			success: !error,
			error,
		});

		return { success: !error, result, error, duration };
	}

	/**
	 * 手动运行任务
	 */
	async runJob(id: string): Promise<{
		success: boolean;
		result: unknown;
		error: string | null;
		duration: number;
	} | null> {
		return this.executeJob(id);
	}

	/**
	 * 解析任务配置
	 */
	private parseTask(task: string | TaskConfig): TaskConfig {
		if (typeof task === 'string') {
			// 简单格式：tool:name 或 chat:message
			const [type, ...rest] = task.split(':');
			const value = rest.join(':');

			switch (type) {
				case 'tool':
					const [name, ...paramParts] = value.split(' ');
					return { type: 'tool', name, params: this.parseParams(paramParts.join(' ')) };
				case 'chat':
					return { type: 'chat', message: value };
				case 'webhook':
					return { type: 'webhook', url: value };
				default:
					return { type: 'chat', message: task };
			}
		}

		return task;
	}

	/**
	 * 解析参数
	 */
	private parseParams(str: string): Record<string, unknown> {
		if (!str) return {};
		try {
			return JSON.parse(str);
		} catch {
			return { command: str };
		}
	}

	/**
	 * 执行 Webhook
	 */
	private async executeWebhook(task: TaskConfig): Promise<{ status: number; body: string }> {
		const response = await fetch(task.url!, {
			method: task.method || 'POST',
			headers: {
				'Content-Type': 'application/json',
				...task.headers,
			},
			body: task.body ? JSON.stringify(task.body) : undefined,
		});

		return {
			status: response.status,
			body: await response.text(),
		};
	}

	/**
	 * 保存任务到配置
	 */
	private saveJobs(): void {
		const jobs = Array.from(this.jobs.values()).map((job) => ({
			id: job.id,
			name: job.name,
			schedule: job.schedule,
			task: job.task,
			enabled: job.enabled,
		}));

		this.gateway.config.set('cron.jobs', jobs);
		this.gateway.config.save();
	}

	/**
	 * 列出所有任务
	 */
	listJobs(): CronJobInternal[] {
		return Array.from(this.jobs.values());
	}

	/**
	 * 获取状态
	 */
	getStatus(): {
		running: boolean;
		totalJobs: number;
		enabledJobs: number;
	} {
		return {
			running: this.cronInstances.size > 0,
			totalJobs: this.jobs.size,
			enabledJobs: Array.from(this.jobs.values()).filter((j) => j.enabled).length,
		};
	}
}

export default CronManager;
