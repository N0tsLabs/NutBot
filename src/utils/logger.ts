/**
 * 日志系统
 * 支持多级别日志、文件输出、颜色输出
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
};

// 日志级别图标
const LEVEL_ICONS: Record<string, string> = {
	debug: '🔍',
	info: 'ℹ️',
	warn: '⚠️',
	error: '❌',
};

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
	private enableConsole = true;
	private enableFile = false;
	private fileStream: WriteStream | null = null;
	private prefix = 'NutBot';

	/**
	 * 初始化日志系统
	 */
	init(options: LoggerOptions = {}): this {
		this.level = options.level || 'info';
		this.enableConsole = options.console !== false;
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
		const timestamp = new Date().toISOString();
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
			raw: `${timestamp} ${prefix} [${level.toUpperCase()}] ${message}${extra}`,
		};
	}

	/**
	 * 输出日志
	 */
	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (!this.shouldLog(level)) return;

		const formatted = this.format(level, message, ...args);
		const color = LEVEL_COLORS[level] || chalk.white;

		// 控制台输出
		if (this.enableConsole) {
			const consoleMsg = `${chalk.gray(formatted.timestamp)} ${formatted.prefix} ${color(`[${level.toUpperCase()}]`)} ${formatted.icon} ${formatted.message}`;
			console.log(consoleMsg);
		}

		// 文件输出
		if (this.enableFile && this.fileStream) {
			this.fileStream.write(formatted.raw + '\n');
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

	error(message: string, ...args: unknown[]): void {
		this.log('error', message, ...args);
	}

	/**
	 * 成功日志（info 级别，绿色）
	 */
	success(message: string, ...args: unknown[]): void {
		if (!this.shouldLog('info')) return;
		const formatted = this.format('info', message, ...args);

		if (this.enableConsole) {
			console.log(
				`${chalk.gray(formatted.timestamp)} ${formatted.prefix} ${chalk.green('[SUCCESS]')} ✅ ${formatted.message}`
			);
		}

		if (this.enableFile && this.fileStream) {
			this.fileStream.write(formatted.raw.replace('[INFO]', '[SUCCESS]') + '\n');
		}
	}

	/**
	 * 进度日志
	 */
	progress(message: string, ...args: unknown[]): void {
		if (!this.shouldLog('info')) return;
		const formatted = this.format('info', message, ...args);

		if (this.enableConsole) {
			console.log(
				`${chalk.gray(formatted.timestamp)} ${formatted.prefix} ${chalk.cyan('[PROGRESS]')} 🔄 ${formatted.message}`
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
			this.error(`Failed: ${label} (${formatDuration(duration)})`, (error as Error).message);
			throw error;
		}
	}

	/**
	 * 创建子 Logger
	 */
	child(childPrefix: string): Logger {
		const childLogger = new Logger();
		childLogger.level = this.level;
		childLogger.enableConsole = this.enableConsole;
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
export default logger;
