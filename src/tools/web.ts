/**
 * 网页工具
 * 网页内容抓取、搜索等
 */

import { BaseTool } from './registry.js';

export class WebTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'web',
			description: '网页工具，可以获取网页内容、搜索等',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: fetch(获取单个网页), batch_fetch(并发获取多个网页), search(搜索)',
					required: true,
					enum: ['fetch', 'batch_fetch', 'search', 'extract'],
				},
				url: {
					type: 'string',
					description: 'fetch 操作的目标网址',
				},
				urls: {
					type: 'array',
					description: 'batch_fetch 操作的多个网址数组，会并发获取所有网页内容',
					items: { type: 'string' },
				},
				query: {
					type: 'string',
					description: 'search 操作的搜索关键词',
				},
				selector: {
					type: 'string',
					description: 'extract 操作的 CSS 选择器',
				},
				timeout: {
					type: 'number',
					description: '请求超时时间(毫秒)，默认 30000',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			url?: string;
			urls?: string[];
			query?: string;
			selector?: string;
			timeout?: number;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, url, urls, query, selector, timeout = 30000 } = params;

		switch (action) {
			case 'fetch':
				if (!url) throw new Error('fetch 操作需要 url 参数');
				return await this.fetchPage(url, timeout);
			case 'batch_fetch':
				if (!urls || !Array.isArray(urls) || urls.length === 0) {
					throw new Error('batch_fetch 操作需要 urls 数组参数');
				}
				return await this.batchFetch(urls, timeout);
			case 'search':
				if (!query) throw new Error('search 操作需要 query 参数');
				return await this.search(query);
			case 'extract':
				if (!url) throw new Error('extract 操作需要 url 参数');
				return await this.extractContent(url, selector, timeout);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	private async fetchPage(
		url: string,
		timeout: number
	): Promise<{ success: boolean; url: string; status: number; contentType: string; text: string; length: number }> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				},
			});

			clearTimeout(timeoutId);

			const contentType = response.headers.get('content-type') || '';
			let text = await response.text();

			// 如果是 HTML，简化处理（移除脚本和样式）
			if (contentType.includes('html')) {
				text = this.simplifyHtml(text);
			}

			// 限制长度
			const maxLength = 50000;
			if (text.length > maxLength) {
				text = text.substring(0, maxLength) + '\n...[内容已截断]';
			}

			this.logger.info(`获取网页: ${url} (${text.length} 字符)`);

			return {
				success: true,
				url,
				status: response.status,
				contentType,
				text,
				length: text.length,
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
	 * 并发获取多个网页
	 */
	private async batchFetch(
		urls: string[],
		timeout: number
	): Promise<{
		success: boolean;
		total: number;
		succeeded: number;
		failed: number;
		results: Array<{
			url: string;
			success: boolean;
			status?: number;
			text?: string;
			length?: number;
			error?: string;
		}>;
	}> {
		this.logger.info(`并发获取 ${urls.length} 个网页...`);
		const startTime = Date.now();

		// 并发获取所有网页
		const promises = urls.map(async (url) => {
			try {
				const result = await this.fetchPage(url, timeout);
				return {
					url,
					success: true,
					status: result.status,
					text: result.text,
					length: result.length,
				};
			} catch (error) {
				return {
					url,
					success: false,
					error: (error as Error).message,
				};
			}
		});

		const results = await Promise.all(promises);
		const succeeded = results.filter((r) => r.success).length;
		const failed = results.length - succeeded;
		const duration = Date.now() - startTime;

		this.logger.info(`并发获取完成: ${succeeded}/${urls.length} 成功, 耗时 ${duration}ms`);

		return {
			success: succeeded > 0,
			total: urls.length,
			succeeded,
			failed,
			results,
		};
	}

	private simplifyHtml(html: string): string {
		// 移除脚本
		html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		// 移除样式
		html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
		// 移除 HTML 注释
		html = html.replace(/<!--[\s\S]*?-->/g, '');
		// 移除标签，保留文本
		html = html.replace(/<[^>]+>/g, ' ');
		// 清理空白
		html = html.replace(/\s+/g, ' ').trim();

		return html;
	}

	private async search(query: string): Promise<{ success: boolean; query: string; suggestion: string }> {
		// 返回搜索建议（实际搜索需要用 browser 工具）
		const encodedQuery = encodeURIComponent(query);

		return {
			success: true,
			query,
			suggestion: `要进行搜索，请使用以下方式之一：
1. 使用 exec 工具打开默认浏览器:
   - Windows: Start-Process "https://www.google.com/search?q=${encodedQuery}"
   - macOS: open "https://www.google.com/search?q=${encodedQuery}"
   - Linux: xdg-open "https://www.google.com/search?q=${encodedQuery}"

2. 使用 browser 工具:
   - action: goto, url: "https://www.google.com/search?q=${encodedQuery}"

常用搜索引擎:
- Google: https://www.google.com/search?q=${encodedQuery}
- Bing: https://www.bing.com/search?q=${encodedQuery}
- Baidu: https://www.baidu.com/s?wd=${encodedQuery}
- DuckDuckGo: https://duckduckgo.com/?q=${encodedQuery}`,
		};
	}

	private async extractContent(
		url: string,
		selector?: string,
		timeout: number = 30000
	): Promise<{ success: boolean; url: string; content: string }> {
		// 获取页面
		const result = await this.fetchPage(url, timeout);

		// 如果没有选择器，返回全部内容
		if (!selector) {
			return {
				success: true,
				url,
				content: result.text,
			};
		}

		// 使用简单的正则提取（完整的 CSS 选择器需要 DOM 解析库）
		this.logger.info(`提取内容: ${url} [${selector}]`);

		return {
			success: true,
			url,
			content: result.text, // 简化版本返回全部内容
		};
	}

	async cleanup(): Promise<void> {
		// 无需清理
	}
}

export default WebTool;
