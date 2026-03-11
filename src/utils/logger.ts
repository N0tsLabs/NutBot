/**
 * 日志系统
 * 支持多级别日志、文件输出、颜色输出、WebSocket 广播
 * 
 * 精简日志设计：
 * 1. 只保留关键信息：用户输入、AI决策、AI回复、错误信息
 * 2. 错误信息详细记录，包括堆栈跟踪
 * 3. 系统内部状态使用 debug 级别，默认不显示
 */

import chalk from 'chalk';
import { createWriteStream, existsSync, mkdirSync, WriteStream } from 'fs';
import { dirname } from 'path';
import { formatDuration } from './helpers.js';

// 日志级别
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
};

// 日志级别颜色
const LEVEL_COLORS: Record<string, (text: string) => string> = {
	debug: chalk.gray,
	info: chalk.blue,
	warn: chalk.yellow,
	error: chalk.red,
	user: chalk.cyan,
	ai: chalk.magenta,
	tool: chalk.green,
};

// 日志级别图标
const LEVEL_ICONS: Record<string, string> = {
	debug: '🔍',
	info: 'ℹ️',
	warn: '⚠️',
	error: '❌',
	user: '👤',
	ai: '🤖',
	tool: '🔧',
	success: '✅',
};

// 日志条目接口（用于 WebSocket 广播）
export interface LogEntry {
	timestamp: string;
	level: string;
	prefix: string;
	message: string;
	icon: string;
}

// 日志广播回调类型
type LogBroadcastCallback = (entry: LogEntry) => void;

interface LoggerOptions {
	level?: LogLevel;
	console?: boolean;
	prefix?: string;
	file?: string;
}

interface FormattedLog {
	timestamp: string;
	level: string;
	icon: string;
	prefix: string;
	message: string;
	raw: string;
}

class Logger {
	private level: LogLevel = 'info';
	private enableFile = false;
	private fileStream: WriteStream | null = null;
	private prefix = 'NutBot';

	// 全局控制台输出开关（静态，所有实例共享）
	private static globalConsoleEnabled = true;

	// 日志广播回调（用于 WebSocket 推送到前端）
	private static broadcastCallback: LogBroadcastCallback | null = null;

	// 日志缓存（用于前端初始化时获取历史日志）
	private static logBuffer: LogEntry[] = [];
	private static maxBufferSize = 500;

	/**
	 * 设置日志广播回调
	 */
	static setBroadcastCallback(callback: LogBroadcastCallback | null): void {
		Logger.broadcastCallback = callback;
	}

	/**
	 * 获取缓存的日志
	 */
	static getLogBuffer(): LogEntry[] {
		return [...Logger.logBuffer];
	}

	/**
	 * 清空日志缓存
	 */
	static clearLogBuffer(): void {
		Logger.logBuffer = [];
	}

	/**
	 * 初始化日志系统
	 */
	init(options: LoggerOptions = {}): this {
		this.level = options.level || 'info';
		// 只有明确设置 console: false 才禁用，否则保持当前状态
		if (options.console === false) {
			Logger.globalConsoleEnabled = false;
		} else if (options.console === true) {
			Logger.globalConsoleEnabled = true;
		}
		this.prefix = options.prefix || 'NutBot';

		if (options.file) {
			this.enableFile = true;
			const dir = dirname(options.file);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			this.fileStream = createWriteStream(options.file, { flags: 'a' });
		}

		return this;
	}

	/**
	 * 启用/禁用控制台输出（全局生效）
	 */
	setConsoleEnabled(enabled: boolean): void {
		Logger.globalConsoleEnabled = enabled;
	}

	/**
	 * 获取控制台输出状态
	 */
	isConsoleEnabled(): boolean {
		return Logger.globalConsoleEnabled;
	}

	/**
	 * 设置日志级别
	 */
	setLevel(level: LogLevel): void {
		if (LOG_LEVELS[level] !== undefined) {
			this.level = level;
		}
	}

	/**
	 * 检查是否应该输出该级别的日志
	 */
	private shouldLog(level: LogLevel): boolean {
		return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
	}

	/**
	 * 格式化日志消息
	 */
	private format(level: string, message: string, ...args: unknown[]): FormattedLog {
		const now = new Date();
		// 生成ISO标准时间戳，确保前端可以正确解析
		const timestamp = now.toISOString();
		const displayTime = now.toLocaleTimeString('zh-CN', { 
			hour: '2-digit', 
			minute: '2-digit', 
			second: '2-digit',
			hour12: false 
		});
		const icon = LEVEL_ICONS[level] || '';
		const prefix = this.prefix ? `[${this.prefix}]` : '';

		// 处理额外参数
		const extra =
			args.length > 0
				? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
				: '';

		return {
			timestamp,
			level,
			icon,
			prefix,
			message: String(message) + extra,
			raw: `${displayTime} ${prefix} [${level.toUpperCase()}] ${message}${extra}`,
		};
	}

	/**
	 * 输出日志
	 */
	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (!this.shouldLog(level)) return;

		const formatted = this.format(level, message, ...args);
		const color = LEVEL_COLORS[level] || chalk.white;

		// 创建日志条目用于广播
		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level,
			prefix: this.prefix,
			message: formatted.message,
			icon: formatted.icon,
		};

		// 添加到缓存
		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}

		// WebSocket 广播
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		// 控制台输出（使用全局开关）
		if (Logger.globalConsoleEnabled) {
			// 简化格式：时间 级别 图标 消息
			const levelTag = color(`[${level.toUpperCase()}]`);
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			const consoleMsg = `${chalk.gray(displayTime)} ${levelTag} ${formatted.icon} ${formatted.prefix} ${formatted.message}`;
			console.log(consoleMsg);
		}

		// 文件输出
		if (this.enableFile && this.fileStream) {
			this.fileStream.write(formatted.raw + '\n');
		}
	}

	/**
	 * 用户输入日志（精简版 - 关键信息）
	 */
	userInput(message: string): void {
		if (!this.shouldLog('info')) return;
		
		const truncated = message.length > 200 ? message.substring(0, 200) + '...' : message;
		const formatted = this.format('info', `👤 用户: ${truncated}`);

		// 创建日志条目
		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level: 'user',
			prefix: this.prefix,
			message: truncated,
			icon: '👤',
		};

		// 添加到缓存并广播
		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			console.log(
				`${chalk.gray(displayTime)} ${chalk.cyan('[USER]')} 👤 ${formatted.prefix} ${truncated}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(`${formatted.timestamp} [USER] 👤 ${this.prefix} ${message}\n`);
		}
	}

	/**
	 * AI 决策日志（工具调用意图）
	 */
	aiDecision(toolName: string, intent?: string): void {
		if (!this.shouldLog('info')) return;
		
		const message = intent 
			? `🤖 AI 决策: 使用 [${toolName}] - ${intent}`
			: `🤖 AI 决策: 使用 [${toolName}]`;
		
		const formatted = this.format('info', message);

		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level: 'ai',
			prefix: this.prefix,
			message: `使用 [${toolName}]${intent ? ' - ' + intent : ''}`,
			icon: '🤖',
		};

		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			console.log(
				`${chalk.gray(displayTime)} ${chalk.magenta('[AI]')} 🤖 ${formatted.prefix} ${message}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(`${formatted.timestamp} [AI] 🤖 ${this.prefix} ${message}\n`);
		}
	}

	/**
	 * AI 回复内容日志
	 */
	aiResponse(content: string): void {
		if (!this.shouldLog('info')) return;
		
		const truncated = content.length > 300 ? content.substring(0, 300) + '...' : content;
		const message = `💬 AI 回复: ${truncated}`;
		
		const formatted = this.format('info', message);

		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level: 'ai',
			prefix: this.prefix,
			message: truncated,
			icon: '💬',
		};

		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			console.log(
				`${chalk.gray(displayTime)} ${chalk.magenta('[AI]')} 💬 ${formatted.prefix} ${truncated}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(`${formatted.timestamp} [AI] 💬 ${this.prefix} ${content}\n`);
		}
	}

	/**
	 * 工具执行结果日志（精简版）
	 */
	toolResult(toolName: string, success: boolean, summary?: string): void {
		if (!this.shouldLog('info')) return;
		
		const icon = success ? '✅' : '❌';
		const status = success ? '成功' : '失败';
		const message = summary 
			? `${icon} [${toolName}] ${status}: ${summary}`
			: `${icon} [${toolName}] ${status}`;
		
		const formatted = this.format('info', message);

		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level: success ? 'info' : 'error',
			prefix: this.prefix,
			message: `[${toolName}] ${status}${summary ? ': ' + summary : ''}`,
			icon,
		};

		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			const color = success ? chalk.green : chalk.red;
			console.log(
				`${chalk.gray(displayTime)} ${color('[TOOL]')} ${icon} ${formatted.prefix} ${message}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(`${formatted.timestamp} [TOOL] ${icon} ${this.prefix} ${message}\n`);
		}
	}

	debug(message: string, ...args: unknown[]): void {
		this.log('debug', message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.log('info', message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.log('warn', message, ...args);
	}

	/**
	 * 错误日志（详细记录，包括堆栈跟踪）
	 */
	error(message: string, ...args: unknown[]): void {
		// 处理错误对象，提取堆栈跟踪
		const processedArgs = args.map(arg => {
			if (arg instanceof Error) {
				return `\nError: ${arg.message}\nStack: ${arg.stack}`;
			}
			if (typeof arg === 'object' && arg !== null) {
				// 检查是否有 error 属性
				const err = arg as any;
				if (err.message || err.stack) {
					return `\nError: ${err.message || 'Unknown'}\nStack: ${err.stack || 'No stack'}`;
				}
			}
			return arg;
		});

		this.log('error', message, ...processedArgs);
	}

	/**
	 * 成功日志（info 级别，绿色）
	 */
	success(message: string, ...args: unknown[]): void {
		if (!this.shouldLog('info')) return;
		const formatted = this.format('info', message, ...args);

		// 创建日志条目
		const entry: LogEntry = {
			timestamp: formatted.timestamp,
			level: 'success',
			prefix: this.prefix,
			message: formatted.message,
			icon: '✅',
		};

		// 添加到缓存并广播
		Logger.logBuffer.push(entry);
		if (Logger.logBuffer.length > Logger.maxBufferSize) {
			Logger.logBuffer.shift();
		}
		if (Logger.broadcastCallback) {
			Logger.broadcastCallback(entry);
		}

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			console.log(
				`${chalk.gray(displayTime)} ${chalk.green('[SUCCESS]')} ✅ ${formatted.prefix} ${formatted.message}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(formatted.raw.replace('[INFO]', '[SUCCESS]') + '\n');
		}
	}

	/**
	 * 进度日志（精简版）
	 */
	progress(message: string, ...args: unknown[]): void {
		if (!this.shouldLog('info')) return;
		const formatted = this.format('info', message, ...args);

		if (Logger.globalConsoleEnabled) {
			const displayTime = new Date().toLocaleTimeString('zh-CN', { 
				hour: '2-digit', 
				minute: '2-digit', 
				second: '2-digit',
				hour12: false 
			});
			console.log(
				`${chalk.gray(displayTime)} ${chalk.cyan('[PROGRESS]')} 🔄 ${formatted.prefix} ${formatted.message}`
			);
		}
	}

	/**
	 * 带时间统计的操作
	 */
	async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
		const start = Date.now();
		this.debug(`Starting: ${label}`);

		try {
			const result = await fn();
			const duration = Date.now() - start;
			this.debug(`Completed: ${label} (${formatDuration(duration)})`);
			return result;
		} catch (error) {
			const duration = Date.now() - start;
			this.error(`Failed: ${label} (${formatDuration(duration)})`, error);
			throw error;
		}
	}

	/**
	 * 创建子 Logger
	 */
	child(childPrefix: string): Logger {
		const childLogger = new Logger();
		childLogger.level = this.level;
		// 控制台输出使用全局开关，不需要复制
		childLogger.enableFile = this.enableFile;
		childLogger.fileStream = this.fileStream;
		childLogger.prefix = this.prefix ? `${this.prefix}:${childPrefix}` : childPrefix;
		return childLogger;
	}

	/**
	 * 关闭日志系统
	 */
	close(): void {
		if (this.fileStream) {
			this.fileStream.end();
			this.fileStream = null;
		}
	}
}

// 单例导出
export const logger = new Logger();
export { Logger };
export default logger;
