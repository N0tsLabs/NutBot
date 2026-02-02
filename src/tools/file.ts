/**
 * 文件操作工具
 * 支持文本文件读写、目录操作、文件搜索等
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { systemInfo } from './exec.js';

const execAsync = promisify(exec);

interface FileInfo {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modified: string;
	created: string;
}

interface SearchResult {
	path: string;
	name: string;
	matches?: string[]; // 内容匹配时的行
}

export class FileTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'file',
			description: '文件操作工具，支持读写文本文件、目录操作、文件搜索等',
			parameters: {
				action: {
					type: 'string',
					description:
						'操作类型: read(读取), write(写入), append(追加), list(列目录), search(搜索), copy(复制), move(移动), delete(删除), info(文件信息), mkdir(创建目录)',
					required: true,
					enum: ['read', 'write', 'append', 'list', 'search', 'copy', 'move', 'delete', 'info', 'mkdir'],
				},
				path: {
					type: 'string',
					description: '文件或目录路径',
					required: true,
				},
				content: {
					type: 'string',
					description: 'write/append 操作的内容',
				},
				dest: {
					type: 'string',
					description: 'copy/move 操作的目标路径',
				},
				pattern: {
					type: 'string',
					description: 'search 操作的搜索模式（文件名通配符或内容关键词）',
				},
				searchContent: {
					type: 'boolean',
					description: 'search 操作是否搜索文件内容（默认只搜索文件名）',
				},
				recursive: {
					type: 'boolean',
					description: 'list/search 操作是否递归子目录',
				},
				encoding: {
					type: 'string',
					description: '文件编码，默认 utf-8',
				},
				confirmDelete: {
					type: 'boolean',
					description: 'delete 操作的确认标记，必须为 true 才能执行删除',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			path: string;
			content?: string;
			dest?: string;
			pattern?: string;
			searchContent?: boolean;
			recursive?: boolean;
			encoding?: BufferEncoding;
			confirmDelete?: boolean;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, path: filePath, content, dest, pattern, searchContent, recursive, encoding = 'utf-8', confirmDelete } = params;

		// 规范化路径
		const normalizedPath = this.normalizePath(filePath);

		switch (action) {
			case 'read':
				return await this.readFile(normalizedPath, encoding);
			case 'write':
				if (content === undefined) throw new Error('write 操作需要 content 参数');
				return await this.writeFile(normalizedPath, content, encoding);
			case 'append':
				if (content === undefined) throw new Error('append 操作需要 content 参数');
				return await this.appendFile(normalizedPath, content, encoding);
			case 'list':
				return await this.listDirectory(normalizedPath, recursive);
			case 'search':
				if (!pattern) throw new Error('search 操作需要 pattern 参数');
				return await this.searchFiles(normalizedPath, pattern, searchContent, recursive);
			case 'copy':
				if (!dest) throw new Error('copy 操作需要 dest 参数');
				return await this.copyFile(normalizedPath, this.normalizePath(dest));
			case 'move':
				if (!dest) throw new Error('move 操作需要 dest 参数');
				return await this.moveFile(normalizedPath, this.normalizePath(dest));
			case 'delete':
				return await this.deleteFile(normalizedPath, confirmDelete);
			case 'info':
				return await this.getFileInfo(normalizedPath);
			case 'mkdir':
				return await this.makeDirectory(normalizedPath);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 规范化路径（处理跨平台差异）
	 */
	private normalizePath(filePath: string): string {
		// 展开 ~ 为用户目录
		if (filePath.startsWith('~')) {
			filePath = path.join(systemInfo.homedir, filePath.slice(1));
		}
		return path.resolve(filePath);
	}

	/**
	 * 读取文件
	 */
	private async readFile(
		filePath: string,
		encoding: BufferEncoding
	): Promise<{ success: boolean; path: string; content: string; size: number; encoding: string }> {
		const exists = await fs.pathExists(filePath);
		if (!exists) {
			throw new Error(`文件不存在: ${filePath}`);
		}

		const stat = await fs.stat(filePath);
		if (stat.isDirectory()) {
			throw new Error(`路径是目录，不是文件: ${filePath}`);
		}

		// 限制读取大小（10MB）
		const maxSize = 10 * 1024 * 1024;
		if (stat.size > maxSize) {
			throw new Error(`文件过大 (${Math.round(stat.size / 1024 / 1024)}MB)，最大支持 10MB`);
		}

		const content = await fs.readFile(filePath, encoding);
		this.logger.info(`读取文件: ${filePath} (${content.length} 字符)`);

		return {
			success: true,
			path: filePath,
			content,
			size: stat.size,
			encoding,
		};
	}

	/**
	 * 写入文件
	 */
	private async writeFile(
		filePath: string,
		content: string,
		encoding: BufferEncoding
	): Promise<{ success: boolean; path: string; size: number; overwritten: boolean; requireConfirmation?: boolean }> {
		const exists = await fs.pathExists(filePath);

		// 如果文件已存在，标记需要确认（但仍然执行，让上层决定是否拦截）
		const overwritten = exists;

		// 确保目录存在
		await fs.ensureDir(path.dirname(filePath));

		await fs.writeFile(filePath, content, encoding);
		const stat = await fs.stat(filePath);

		this.logger.info(`写入文件: ${filePath} (${stat.size} 字节)`);

		return {
			success: true,
			path: filePath,
			size: stat.size,
			overwritten,
			...(overwritten && { requireConfirmation: true }),
		};
	}

	/**
	 * 追加内容到文件
	 */
	private async appendFile(
		filePath: string,
		content: string,
		encoding: BufferEncoding
	): Promise<{ success: boolean; path: string; appended: number }> {
		// 确保目录存在
		await fs.ensureDir(path.dirname(filePath));

		await fs.appendFile(filePath, content, encoding);

		this.logger.info(`追加到文件: ${filePath} (${content.length} 字符)`);

		return {
			success: true,
			path: filePath,
			appended: content.length,
		};
	}

	/**
	 * 列出目录内容
	 */
	private async listDirectory(
		dirPath: string,
		recursive?: boolean
	): Promise<{ success: boolean; path: string; items: FileInfo[]; total: number }> {
		const exists = await fs.pathExists(dirPath);
		if (!exists) {
			throw new Error(`目录不存在: ${dirPath}`);
		}

		const stat = await fs.stat(dirPath);
		if (!stat.isDirectory()) {
			throw new Error(`路径不是目录: ${dirPath}`);
		}

		const items: FileInfo[] = [];
		await this.walkDirectory(dirPath, items, recursive ? 10 : 0, 0);

		// 限制返回数量
		const maxItems = 500;
		const truncated = items.length > maxItems;
		const result = truncated ? items.slice(0, maxItems) : items;

		this.logger.info(`列出目录: ${dirPath} (${result.length} 项)`);

		return {
			success: true,
			path: dirPath,
			items: result,
			total: items.length,
		};
	}

	/**
	 * 递归遍历目录
	 */
	private async walkDirectory(dirPath: string, items: FileInfo[], maxDepth: number, currentDepth: number): Promise<void> {
		if (currentDepth > maxDepth) return;

		const entries = await fs.readdir(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			try {
				const stat = await fs.stat(fullPath);
				items.push({
					name: entry.name,
					path: fullPath,
					isDirectory: entry.isDirectory(),
					size: stat.size,
					modified: stat.mtime.toISOString(),
					created: stat.birthtime.toISOString(),
				});

				if (entry.isDirectory() && currentDepth < maxDepth) {
					await this.walkDirectory(fullPath, items, maxDepth, currentDepth + 1);
				}
			} catch {
				// 忽略无法访问的文件
			}
		}
	}

	/**
	 * 搜索文件
	 */
	private async searchFiles(
		dirPath: string,
		pattern: string,
		searchContent?: boolean,
		recursive?: boolean
	): Promise<{ success: boolean; path: string; pattern: string; results: SearchResult[]; total: number }> {
		const exists = await fs.pathExists(dirPath);
		if (!exists) {
			throw new Error(`目录不存在: ${dirPath}`);
		}

		const results: SearchResult[] = [];
		const maxResults = 100;

		await this.searchInDirectory(dirPath, pattern, searchContent || false, recursive ? 10 : 0, 0, results, maxResults);

		this.logger.info(`搜索: ${pattern} in ${dirPath} (找到 ${results.length} 个)`);

		return {
			success: true,
			path: dirPath,
			pattern,
			results,
			total: results.length,
		};
	}

	/**
	 * 在目录中搜索
	 */
	private async searchInDirectory(
		dirPath: string,
		pattern: string,
		searchContent: boolean,
		maxDepth: number,
		currentDepth: number,
		results: SearchResult[],
		maxResults: number
	): Promise<void> {
		if (currentDepth > maxDepth || results.length >= maxResults) return;

		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		const regex = this.patternToRegex(pattern);

		for (const entry of entries) {
			if (results.length >= maxResults) break;

			const fullPath = path.join(dirPath, entry.name);

			// 文件名匹配
			if (regex.test(entry.name)) {
				results.push({ path: fullPath, name: entry.name });
			}
			// 内容搜索（仅文件）
			else if (searchContent && entry.isFile()) {
				try {
					const stat = await fs.stat(fullPath);
					// 只搜索小于 1MB 的文本文件
					if (stat.size < 1024 * 1024) {
						const content = await fs.readFile(fullPath, 'utf-8');
						const lines = content.split('\n');
						const matches: string[] = [];

						for (let i = 0; i < lines.length; i++) {
							if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
								matches.push(`${i + 1}: ${lines[i].trim().substring(0, 100)}`);
								if (matches.length >= 5) break;
							}
						}

						if (matches.length > 0) {
							results.push({ path: fullPath, name: entry.name, matches });
						}
					}
				} catch {
					// 忽略无法读取的文件
				}
			}

			// 递归子目录
			if (entry.isDirectory() && currentDepth < maxDepth) {
				await this.searchInDirectory(fullPath, pattern, searchContent, maxDepth, currentDepth + 1, results, maxResults);
			}
		}
	}

	/**
	 * 将通配符模式转换为正则表达式
	 */
	private patternToRegex(pattern: string): RegExp {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
		return new RegExp(escaped, 'i');
	}

	/**
	 * 复制文件或目录
	 */
	private async copyFile(src: string, dest: string): Promise<{ success: boolean; src: string; dest: string }> {
		const exists = await fs.pathExists(src);
		if (!exists) {
			throw new Error(`源文件不存在: ${src}`);
		}

		await fs.copy(src, dest);
		this.logger.info(`复制: ${src} -> ${dest}`);

		return {
			success: true,
			src,
			dest,
		};
	}

	/**
	 * 移动/重命名文件
	 */
	private async moveFile(src: string, dest: string): Promise<{ success: boolean; src: string; dest: string }> {
		const exists = await fs.pathExists(src);
		if (!exists) {
			throw new Error(`源文件不存在: ${src}`);
		}

		await fs.move(src, dest);
		this.logger.info(`移动: ${src} -> ${dest}`);

		return {
			success: true,
			src,
			dest,
		};
	}

	/**
	 * 删除文件或目录（需要确认）
	 */
	private async deleteFile(
		filePath: string,
		confirmDelete?: boolean
	): Promise<{ success: boolean; path: string; deleted: boolean; requireConfirmation: boolean; message?: string }> {
		const exists = await fs.pathExists(filePath);
		if (!exists) {
			return {
				success: true,
				path: filePath,
				deleted: false,
				requireConfirmation: false,
				message: '文件不存在',
			};
		}

		// 必须明确确认才能删除
		if (!confirmDelete) {
			return {
				success: false,
				path: filePath,
				deleted: false,
				requireConfirmation: true,
				message: '删除操作需要确认，请设置 confirmDelete: true',
			};
		}

		const stat = await fs.stat(filePath);
		await fs.remove(filePath);

		this.logger.info(`删除: ${filePath} (${stat.isDirectory() ? '目录' : '文件'})`);

		return {
			success: true,
			path: filePath,
			deleted: true,
			requireConfirmation: false,
		};
	}

	/**
	 * 获取文件信息
	 */
	private async getFileInfo(filePath: string): Promise<{
		success: boolean;
		path: string;
		exists: boolean;
		isDirectory?: boolean;
		isFile?: boolean;
		size?: number;
		sizeHuman?: string;
		modified?: string;
		created?: string;
		accessed?: string;
		permissions?: string;
	}> {
		const exists = await fs.pathExists(filePath);
		if (!exists) {
			return {
				success: true,
				path: filePath,
				exists: false,
			};
		}

		const stat = await fs.stat(filePath);

		return {
			success: true,
			path: filePath,
			exists: true,
			isDirectory: stat.isDirectory(),
			isFile: stat.isFile(),
			size: stat.size,
			sizeHuman: this.formatSize(stat.size),
			modified: stat.mtime.toISOString(),
			created: stat.birthtime.toISOString(),
			accessed: stat.atime.toISOString(),
			permissions: stat.mode.toString(8).slice(-3),
		};
	}

	/**
	 * 创建目录
	 */
	private async makeDirectory(dirPath: string): Promise<{ success: boolean; path: string; created: boolean }> {
		const exists = await fs.pathExists(dirPath);
		if (exists) {
			return {
				success: true,
				path: dirPath,
				created: false,
			};
		}

		await fs.ensureDir(dirPath);
		this.logger.info(`创建目录: ${dirPath}`);

		return {
			success: true,
			path: dirPath,
			created: true,
		};
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

export default FileTool;
