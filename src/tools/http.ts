/**
 * HTTP 请求工具
 * 支持发送 HTTP 请求、文件下载上传
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import fs from 'fs-extra';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

interface RequestOptions {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
}

interface RequestResult {
	success: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: unknown;
	contentType: string;
	elapsed: number;
}

export class HttpTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'http',
			description: 'HTTP 请求工具，支持发送各类 HTTP 请求、文件下载和上传',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: request(发送请求), download(下载文件), upload(上传文件)',
					required: true,
					enum: ['request', 'download', 'upload'],
				},
				method: {
					type: 'string',
					description: 'HTTP 方法: GET, POST, PUT, DELETE, PATCH',
					enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
				},
				url: {
					type: 'string',
					description: '请求 URL',
					required: true,
				},
				headers: {
					type: 'object',
					description: '请求头（JSON 对象）',
				},
				body: {
					type: 'string',
					description: 'POST/PUT 请求的 body（JSON 字符串或文本）',
				},
				json: {
					type: 'object',
					description: 'POST/PUT 请求的 JSON body（自动设置 Content-Type）',
				},
				savePath: {
					type: 'string',
					description: 'download 操作的保存路径',
				},
				filePath: {
					type: 'string',
					description: 'upload 操作的文件路径',
				},
				fieldName: {
					type: 'string',
					description: 'upload 操作的字段名，默认 "file"',
				},
				timeout: {
					type: 'number',
					description: '超时时间(毫秒)，默认 30000',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			method?: string;
			url: string;
			headers?: Record<string, string>;
			body?: string;
			json?: Record<string, unknown>;
			savePath?: string;
			filePath?: string;
			fieldName?: string;
			timeout?: number;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, method = 'GET', url, headers = {}, body, json, savePath, filePath, fieldName, timeout = 30000 } = params;

		switch (action) {
			case 'request':
				return await this.sendRequest({
					method,
					url,
					headers,
					body: json || body,
					timeout,
				});
			case 'download':
				if (!savePath) throw new Error('download 操作需要 savePath 参数');
				return await this.downloadFile(url, savePath, headers, timeout);
			case 'upload':
				if (!filePath) throw new Error('upload 操作需要 filePath 参数');
				return await this.uploadFile(url, filePath, fieldName || 'file', headers, timeout);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 发送 HTTP 请求
	 */
	private async sendRequest(options: RequestOptions): Promise<RequestResult> {
		const { method, url, headers = {}, body, timeout = 30000 } = options;

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const startTime = Date.now();

		try {
			// 准备请求选项
			const fetchOptions: RequestInit = {
				method,
				headers: { ...headers },
				signal: controller.signal,
			};

			// 处理 body
			if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
				if (typeof body === 'object') {
					fetchOptions.body = JSON.stringify(body);
					if (!headers['Content-Type'] && !headers['content-type']) {
						(fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
					}
				} else {
					fetchOptions.body = String(body);
				}
			}

			const response = await fetch(url, fetchOptions);
			clearTimeout(timeoutId);

			const elapsed = Date.now() - startTime;
			const contentType = response.headers.get('content-type') || '';

			// 解析响应
			let responseBody: unknown;
			if (contentType.includes('application/json')) {
				try {
					responseBody = await response.json();
				} catch {
					responseBody = await response.text();
				}
			} else {
				responseBody = await response.text();
				// 限制文本长度
				if (typeof responseBody === 'string' && responseBody.length > 50000) {
					responseBody = responseBody.substring(0, 50000) + '\n...[内容已截断]';
				}
			}

			// 收集响应头
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});

			this.logger.info(`HTTP ${method} ${url} -> ${response.status} (${elapsed}ms)`);

			return {
				success: response.ok,
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders,
				body: responseBody,
				contentType,
				elapsed,
			};
		} catch (error) {
			clearTimeout(timeoutId);

			if ((error as Error).name === 'AbortError') {
				throw new Error(`请求超时: ${url}`);
			}
			throw error;
		}
	}

	/**
	 * 下载文件
	 */
	private async downloadFile(
		url: string,
		savePath: string,
		headers: Record<string, string> = {},
		timeout: number = 30000
	): Promise<{
		success: boolean;
		url: string;
		path: string;
		size: number;
		sizeHuman: string;
		contentType: string;
		elapsed: number;
	}> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const startTime = Date.now();
		const normalizedPath = path.resolve(savePath);

		try {
			const response = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					...headers,
				},
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
			}

			// 确保目录存在
			await fs.ensureDir(path.dirname(normalizedPath));

			// 使用流式写入
			const fileStream = fs.createWriteStream(normalizedPath);
			const body = response.body;

			if (!body) {
				throw new Error('响应没有 body');
			}

			// Node.js 18+ 支持 ReadableStream
			const nodeStream = Readable.fromWeb(body as import('stream/web').ReadableStream);
			await pipeline(nodeStream, fileStream);

			const elapsed = Date.now() - startTime;
			const stat = await fs.stat(normalizedPath);
			const contentType = response.headers.get('content-type') || '';

			this.logger.info(`下载文件: ${url} -> ${normalizedPath} (${this.formatSize(stat.size)}, ${elapsed}ms)`);

			return {
				success: true,
				url,
				path: normalizedPath,
				size: stat.size,
				sizeHuman: this.formatSize(stat.size),
				contentType,
				elapsed,
			};
		} catch (error) {
			clearTimeout(timeoutId);

			// 清理可能创建的不完整文件
			if (await fs.pathExists(normalizedPath)) {
				await fs.remove(normalizedPath);
			}

			if ((error as Error).name === 'AbortError') {
				throw new Error(`下载超时: ${url}`);
			}
			throw error;
		}
	}

	/**
	 * 上传文件
	 */
	private async uploadFile(
		url: string,
		filePath: string,
		fieldName: string,
		headers: Record<string, string> = {},
		timeout: number = 30000
	): Promise<{
		success: boolean;
		url: string;
		file: string;
		size: number;
		status: number;
		response: unknown;
		elapsed: number;
	}> {
		const normalizedPath = path.resolve(filePath);

		const exists = await fs.pathExists(normalizedPath);
		if (!exists) {
			throw new Error(`文件不存在: ${normalizedPath}`);
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const startTime = Date.now();

		try {
			const stat = await fs.stat(normalizedPath);
			const fileName = path.basename(normalizedPath);
			const fileBuffer = await fs.readFile(normalizedPath);

			// 创建 FormData
			const formData = new FormData();
			const blob = new Blob([fileBuffer]);
			formData.append(fieldName, blob, fileName);

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					...headers,
					// FormData 会自动设置 Content-Type
				},
				body: formData,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			const elapsed = Date.now() - startTime;

			// 解析响应
			let responseBody: unknown;
			const contentType = response.headers.get('content-type') || '';
			if (contentType.includes('application/json')) {
				try {
					responseBody = await response.json();
				} catch {
					responseBody = await response.text();
				}
			} else {
				responseBody = await response.text();
			}

			this.logger.info(`上传文件: ${normalizedPath} -> ${url} (${this.formatSize(stat.size)}, ${elapsed}ms)`);

			return {
				success: response.ok,
				url,
				file: normalizedPath,
				size: stat.size,
				status: response.status,
				response: responseBody,
				elapsed,
			};
		} catch (error) {
			clearTimeout(timeoutId);

			if ((error as Error).name === 'AbortError') {
				throw new Error(`上传超时: ${url}`);
			}
			throw error;
		}
	}

	/**
	 * 格式化文件大小
	 */
	private formatSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let i = 0;
		while (bytes >= 1024 && i < units.length - 1) {
			bytes /= 1024;
			i++;
		}
		return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
	}

	async cleanup(): Promise<void> {
		// 无需清理
	}
}

export default HttpTool;
