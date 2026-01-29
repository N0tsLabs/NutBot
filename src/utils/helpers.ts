/**
 * 工具函数集合
 */

import { randomUUID } from 'crypto';

// 缓存的位置信息
let cachedLocation: UserLocation | null = null;
let locationCacheTime = 0;
const LOCATION_CACHE_TTL = 3600000; // 1 小时缓存

export interface UserLocation {
	city: string;
	region?: string;
	country?: string;
	timezone?: string;
	ip?: string;
}

/**
 * 通过 IP 获取用户位置（使用免费 API）
 */
export async function getLocationByIP(): Promise<UserLocation | null> {
	// 检查缓存
	if (cachedLocation && Date.now() - locationCacheTime < LOCATION_CACHE_TTL) {
		return cachedLocation;
	}

	const apis = [
		// ip-api.com（免费，无需 API Key）
		{
			url: 'http://ip-api.com/json/?lang=zh-CN',
			parse: (data: Record<string, unknown>) => ({
				city: data.city as string,
				region: data.regionName as string,
				country: data.country as string,
				timezone: data.timezone as string,
				ip: data.query as string,
			}),
		},
		// ipinfo.io（备用）
		{
			url: 'https://ipinfo.io/json',
			parse: (data: Record<string, unknown>) => ({
				city: data.city as string,
				region: data.region as string,
				country: data.country as string,
				timezone: data.timezone as string,
				ip: data.ip as string,
			}),
		},
	];

	for (const api of apis) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(api.url, {
				signal: controller.signal,
				headers: { 'User-Agent': 'NutBot/1.0' },
			});
			clearTimeout(timeout);

			if (response.ok) {
				const data = (await response.json()) as Record<string, unknown>;
				const location = api.parse(data);
				if (location.city) {
					cachedLocation = location;
					locationCacheTime = Date.now();
					return location;
				}
			}
		} catch {
			// 尝试下一个 API
			continue;
		}
	}

	return null;
}

/**
 * 深度克隆对象
 */
export function deepClone<T>(obj: T): T {
	if (obj === null || typeof obj !== 'object') {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => deepClone(item)) as T;
	}

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(obj as Record<string, unknown>)) {
		result[key] = deepClone((obj as Record<string, unknown>)[key]);
	}
	return result as T;
}

/**
 * 深度合并对象（返回完全独立的新对象）
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
	// 先深拷贝 target，确保不共享任何引用
	const result = deepClone(target);

	for (const key of Object.keys(source) as (keyof T)[]) {
		const targetVal = result[key];
		const sourceVal = source[key];

		if (isObject(targetVal) && isObject(sourceVal)) {
			result[key] = deepMerge(
				targetVal as Record<string, unknown>,
				sourceVal as Record<string, unknown>
			) as T[keyof T];
		} else if (sourceVal !== undefined) {
			result[key] = deepClone(sourceVal) as T[keyof T];
		}
	}

	return result;
}

/**
 * 判断是否为普通对象
 */
export function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 生成唯一 ID
 */
export function generateId(prefix = ''): string {
	const uuid = randomUUID().replace(/-/g, '').substring(0, 12);
	return prefix ? `${prefix}-${uuid}` : uuid;
}

/**
 * 延迟函数
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带超时的 Promise
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
	const timeout = new Promise<never>((_, reject) => {
		setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]);
}

/**
 * 重试选项
 */
interface RetryOptions {
	maxAttempts?: number;
	delay?: number;
	backoff?: number;
}

/**
 * 重试函数
 */
export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn(attempt);
		} catch (error) {
			lastError = error as Error;
			if (attempt < maxAttempts) {
				await sleep(delay * Math.pow(backoff, attempt - 1));
			}
		}
	}

	throw lastError;
}

/**
 * 安全解析 JSON
 */
export function safeParseJSON<T>(str: string, defaultValue: T): T {
	try {
		return JSON.parse(str) as T;
	} catch {
		return defaultValue;
	}
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
	if (!str || str.length <= maxLength) return str;
	return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 格式化字节数
 */
export function formatBytes(bytes: number, decimals = 2): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
	return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timer: NodeJS.Timeout | null = null;
	return function (this: unknown, ...args: Parameters<T>) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), delay);
	};
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
	fn: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle = false;
	return function (this: unknown, ...args: Parameters<T>) {
		if (!inThrottle) {
			fn.apply(this, args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}

/**
 * 异步队列执行
 */
interface QueueItem<T> {
	fn: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

export class AsyncQueue {
	private concurrency: number;
	private running: number;
	private queue: QueueItem<unknown>[];

	constructor(concurrency = 1) {
		this.concurrency = concurrency;
		this.running = 0;
		this.queue = [];
	}

	async add<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.queue.push({ fn, resolve: resolve as (value: unknown) => void, reject });
			this.process();
		});
	}

	private async process(): Promise<void> {
		if (this.running >= this.concurrency || this.queue.length === 0) {
			return;
		}

		this.running++;
		const item = this.queue.shift()!;

		try {
			const result = await item.fn();
			item.resolve(result);
		} catch (error) {
			item.reject(error as Error);
		} finally {
			this.running--;
			this.process();
		}
	}
}
