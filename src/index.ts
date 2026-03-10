/**
 * NutBot 主入口
 * AI 驱动的自动化机器人
 */

import { Command } from 'commander';
import * as readline from 'readline';
import chalk from 'chalk';
import { gateway } from './gateway/index.js';

const program = new Command();

program.name('nutbot').description('AI 驱动的自动化机器人').version('0.1.0');

/**
 * 交互式终端聊天
 */
async function startInteractiveChat(options: { port: number; host: string; verbose: boolean }) {
	const { port, host } = options;

	// 清屏并显示欢迎信息
	console.clear();
	console.log('');
	console.log(chalk.yellow.bold('  🥜 NutBot'));
	console.log(chalk.gray('  ─────────────────────────────────────────────────'));
	console.log(chalk.gray('  你的 AI 助理，可以帮你操控电脑、浏览网页、执行任务'));
	console.log(chalk.gray('  Web UI: ') + chalk.cyan(`http://${host}:${port}`));
	console.log(chalk.gray('  ─────────────────────────────────────────────────'));
	console.log('');

	// 创建 readline 接口
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
		historySize: 100,
	});

	let isProcessing = false;

	// 尝试加载最近使用的 session，或创建新 session
	let currentSessionId: string | null = null;

	// 获取或创建 session
	function getSessionId(): string {
		if (currentSessionId) {
			return currentSessionId;
		}
		// 列出所有 session，找到最近更新的
		const sessions = gateway.sessionManager.listSessions();
		if (sessions.length > 0) {
			// 按更新时间排序，取最新的
			sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
			currentSessionId = sessions[0].id;
		}
		if (!currentSessionId) {
			const session = gateway.sessionManager.createSession();
			currentSessionId = session.id;
		}
		return currentSessionId;
	}

	// 显示用户输入提示
	const showPrompt = () => {
		process.stdout.write(chalk.green('\n  你 › '));
	};

	// 工具名翻译
	const toolNameMap: Record<string, string> = {
		browser: '浏览器',
		screenshot: '截图',
		computer: '电脑操作',
		web: '网络',
		exec: '命令行',
	};

	// 操作翻译
	const actionMap: Record<string, string> = {
		goto: '打开',
		state: '获取页面',
		click: '点击',
		type: '输入',
		fill: '填写',
		scroll: '滚动',
		hover: '悬停',
		select: '选择',
		close: '关闭',
		fetch: '读取',
		search: '搜索',
		take: '截图',
		mouse_move: '移动鼠标',
		left_click: '左键点击',
		right_click: '右键点击',
		double_click: '双击',
		key: '按键',
		list_elements: '获取元素',
	};

	// 翻译工具名
	const translateTool = (name: string): string => toolNameMap[name] || name;

	// 翻译操作
	const translateAction = (action: string): string => actionMap[action] || action;

	// 生成工具结果简述
	const getResultSummary = (result: Record<string, unknown>): string => {
		if (result.title) return `${result.title}`;
		if (result.url) return `${result.url}`.slice(0, 50);
		if (result.output) return `${result.output}`.slice(0, 60);
		if (result.elements) return `获取到 ${(result.elements as unknown[]).length} 个元素`;
		if (result.message) return `${result.message}`;
		return '完成';
	};

	// 显示 AI 消息
	const showAIMessage = (message: string, isNewLine = true) => {
		if (isNewLine) {
			console.log(chalk.yellow('\n  🥜 › ') + message);
		} else {
			process.stdout.write(message);
		}
	};

	// 显示状态消息
	const showStatus = (message: string) => {
		process.stdout.write(chalk.gray(`\r  ⏳ ${message}...`) + ' '.repeat(20));
	};

	// 清除当前行
	const clearLine = () => {
		process.stdout.write('\r' + ' '.repeat(80) + '\r');
	};

	// 询问确认
	const askConfirm = (question: string): Promise<boolean> => {
		return new Promise((resolve) => {
			rl.question(chalk.yellow(`\n  ⚠️  ${question} (y/n): `), (answer) => {
				resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
			});
		});
	};

	// 处理输入
	const handleLine = async (input: string) => {
		const trimmed = input.trim();

		if (!trimmed) {
			showPrompt();
			return;
		}

		// 处理命令
		if (trimmed.startsWith('/')) {
			const cmd = trimmed.slice(1).toLowerCase();
			switch (cmd) {
				case 'help':
					console.log(chalk.cyan('\n  📌 可用命令'));
					console.log(chalk.white('     /help  ') + chalk.gray('显示帮助'));
					console.log(chalk.white('     /clear ') + chalk.gray('清屏'));
					console.log(chalk.white('     /exit  ') + chalk.gray('退出'));
					console.log(chalk.white('     /web   ') + chalk.gray('打开网页界面'));
					break;
				case 'clear':
					console.clear();
					console.log(chalk.yellow.bold('\n  🥜 NutBot\n'));
					break;
				case 'exit':
				case 'quit':
					console.log(chalk.gray('\n  👋 再见！\n'));
					rl.close();
					await gateway.stop();
					process.exit(0);
					return;
				case 'web':
					const { exec } = await import('child_process');
					const url = `http://${host}:${port}`;
					const platform = process.platform;
					const cmd2 = platform === 'win32' ? `start "" "${url}"` : platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
					exec(cmd2);
					console.log(chalk.gray(`\n  🌐 已打开 ${url}`));
					break;
				default:
					console.log(chalk.red(`\n  ❓ 未知命令: /${cmd}`));
			}
			showPrompt();
			return;
		}

		isProcessing = true;
		clearLine();

		// 发送给 AI
		let responseContent = '';
		let hasStartedResponse = false;
		let lastThinking = '';

		try {
			for await (const chunk of gateway.chat(trimmed, { sessionId: getSessionId() })) {
				switch (chunk.type) {
					case 'thinking':
						// 显示迭代信息
						console.log(chalk.gray(`\n  ── 第 ${chunk.iteration} 轮思考 ──`));
						break;

					case 'tools':
						// 显示 AI 的思考过程
						if (chunk.thinking) {
							lastThinking = chunk.thinking;
							console.log(chalk.cyan('\n  💭 ') + chalk.white(chunk.thinking));
						}
						break;

					case 'content':
						if (!hasStartedResponse) {
							console.log(chalk.yellow('\n  🥜 › '));
							hasStartedResponse = true;
						}
						process.stdout.write(chunk.content || '');
						responseContent += chunk.content || '';
						break;

					case 'tool_start':
						// 显示工具名称和操作描述
						const toolName = translateTool(chunk.tool || 'unknown');
						const toolArgs = chunk.args || {};
						const action = toolArgs.action ? translateAction(toolArgs.action as string) : '';
						
						// 生成操作描述
						let actionDesc = action;
						if (toolArgs.url) {
							const url = (toolArgs.url as string).slice(0, 45);
							actionDesc = `${action || '访问'} ${url}${(toolArgs.url as string).length > 45 ? '...' : ''}`;
						}
						if (toolArgs.command) {
							actionDesc = `执行: ${(toolArgs.command as string).slice(0, 50)}`;
						}
						if (toolArgs.ref) {
							actionDesc += actionDesc ? ` [元素${toolArgs.ref}]` : `操作元素 ${toolArgs.ref}`;
						}
						if (toolArgs.text) {
							actionDesc += ` "${(toolArgs.text as string).slice(0, 25)}"`;
						}
						if (toolArgs.coordinate) {
							const coord = toolArgs.coordinate as number[];
							actionDesc += ` (${coord[0]}, ${coord[1]})`;
						}
						
						// 显示：🔧 浏览器 · 打开 bilibili.com
						const desc = actionDesc || chunk.description || '处理中';
						console.log(chalk.cyan(`  🔧 ${toolName}`) + chalk.gray(` · ${desc}`));
						break;

					case 'tool_result':
						// 显示工具结果
						if (chunk.result && typeof chunk.result === 'object' && 'success' in chunk.result) {
							const resultObj = chunk.result as Record<string, unknown>;
							if (resultObj.success) {
								const resultSummary = getResultSummary(resultObj);
								console.log(chalk.green(`     ✓ `) + chalk.gray(resultSummary));
							} else {
								console.log(chalk.red(`     ✗ 失败`));
							}
						} else {
							console.log(chalk.red(`     ✗ 失败`));
						}
						break;

					case 'tool_error':
						console.log(chalk.red(`     ✗ ${chunk.error}`));
						break;

					case 'error':
						console.log(chalk.red(`\n  ❌ ${chunk.error}`));
						break;

					case 'debug_confirm':
						// 调试模式确认
						console.log(chalk.yellow(`\n  🔍 调试确认: ${chunk.tool}`));
						if (chunk.thinking) {
							console.log(chalk.gray(`     思考: ${chunk.thinking}`));
						}
						if (chunk.args) {
							console.log(chalk.gray(`     参数: ${JSON.stringify(chunk.args)}`));
						}
						const confirmed = await askConfirm('确认执行？');
						if (chunk.confirmId) {
							gateway.server?.broadcast({
								type: 'debug_response',
								payload: { confirmId: chunk.confirmId, approved: confirmed },
							});
						}
						if (!confirmed) {
							console.log(chalk.gray('  已取消'));
						}
						break;
				}
			}
		} catch (error) {
			console.log(chalk.red(`\n  ❌ ${(error as Error).message}`));
		}

		if (hasStartedResponse) {
			console.log(''); // 换行
		}

		isProcessing = false;
		showPrompt();
	};

	// 监听输入
	rl.on('line', handleLine);

	// Ctrl+C 退出
	rl.on('SIGINT', async () => {
		console.log(chalk.gray('\n\n  👋 再见！\n'));
		rl.close();
		await gateway.stop();
		process.exit(0);
	});

	// 关闭事件
	rl.on('close', async () => {
		await gateway.stop();
		process.exit(0);
	});

	// 显示初始提示
	showPrompt();
}

// 启动命令
program
	.command('start')
	.description('启动 NutBot 服务')
	.option('-c, --config <path>', '配置文件路径')
	.option('-p, --port <port>', '服务端口', '18800')
	.option('-h, --host <host>', '服务地址', '127.0.0.1')
	.option('--open-browser', '启动时自动打开浏览器（默认不打开）')
	.option('-v, --verbose', '显示详细日志')
	.option('--interactive', '启用交互式聊天模式（终端对话）')
	.option('--silent', '禁用所有日志输出')
	.action(async (options) => {
		try {
			// 交互式模式：明确指定 --interactive 才启用
			const useInteractive = options.interactive === true;
			// 静默模式：--silent 或 交互模式时自动静默
			const isSilent = options.silent === true || useInteractive;

			// 初始化
			await gateway.init({
				configPath: options.config,
				silent: isSilent,
			});

			// 覆盖配置
			if (options.port) {
				gateway.config.set('server.port', parseInt(options.port));
			}
			if (options.host) {
				gateway.config.set('server.host', options.host);
			}

			const port = gateway.config.get('server.port', 18800);
			const host = gateway.config.get('server.host', '127.0.0.1');

			// 启动服务
			await gateway.start({ openBrowser: options.openBrowser === true });

			// 交互式模式（终端对话，无日志）
			if (useInteractive) {
				await startInteractiveChat({ port, host, verbose: options.verbose });
			} else {
				// 正常模式（后台运行，显示日志）
				console.log('');
				console.log('  🥜 NutBot 已启动');
				console.log(`  📍 http://${host}:${port}`);
				console.log('');
				console.log('  按 Ctrl+C 退出');
				console.log('');

				// 处理退出信号
				const shutdown = async () => {
					console.log('\n  正在关闭...');
					await gateway.stop();
					console.log('  👋 再见！');
					process.exit(0);
				};

				process.on('SIGINT', shutdown);
				process.on('SIGTERM', shutdown);
			}
		} catch (error) {
			console.error('启动失败:', (error as Error).message);
			process.exit(1);
		}
	});

// 聊天命令
program
	.command('chat <message>')
	.description('执行一次性对话')
	.option('-m, --model <model>', '使用的模型')
	.action(async (message, options) => {
		try {
			await gateway.init();

			for await (const chunk of gateway.chat(message, { model: options.model })) {
				if (chunk.type === 'content') {
					process.stdout.write(chunk.content || '');
				} else if (chunk.type === 'done') {
					console.log('\n');
				} else if (chunk.type === 'error') {
					console.error('\n错误:', chunk.error);
				}
			}

			process.exit(0);
		} catch (error) {
			console.error('执行失败:', (error as Error).message);
			process.exit(1);
		}
	});

// 工具命令
program
	.command('tool <name>')
	.description('执行工具')
	.option('-p, --params <json>', '工具参数 (JSON)')
	.action(async (name, options) => {
		try {
			await gateway.init();

			const params = options.params ? JSON.parse(options.params) : {};
			const result = await gateway.executeTool(name, params);

			console.log(JSON.stringify(result, null, 2));
			process.exit(0);
		} catch (error) {
			console.error('执行失败:', (error as Error).message);
			process.exit(1);
		}
	});

// 列出工具
program
	.command('tools')
	.description('列出可用工具')
	.action(async () => {
		try {
			await gateway.init();

			const tools = gateway.toolRegistry.listTools();

			console.log('\n可用工具:\n');
			for (const tool of tools) {
				console.log(`  ${tool.name}`);
				console.log(`    ${tool.description}\n`);
			}

			process.exit(0);
		} catch (error) {
			console.error('执行失败:', (error as Error).message);
			process.exit(1);
		}
	});

// 列出 Provider
program
	.command('providers')
	.description('列出 AI Provider')
	.action(async () => {
		try {
			await gateway.init();

			const providers = gateway.providerManager.listProviders();

			console.log('\nAI Providers:\n');
			for (const p of providers) {
				console.log(`  ${p.id} (${p.type})`);
				console.log(`    URL: ${p.baseUrl}`);
				console.log(`    Models: ${p.models.length > 0 ? p.models.join(', ') : '未配置'}`);
				console.log(`    Default: ${p.defaultModel || '未设置'}\n`);
			}

			process.exit(0);
		} catch (error) {
			console.error('执行失败:', (error as Error).message);
			process.exit(1);
		}
	});

// 解析命令行参数
program.parse();

// 导出
export { gateway, Gateway } from './gateway/index.js';
export { ProviderManager, BaseProvider, OpenAIProvider, AnthropicProvider } from './providers/index.js';
export { ToolRegistry, BaseTool, BrowserTool } from './tools/index.js';
export { default as Agent, default as SessionManager } from './agent/index.js';
export { CronManager } from './cron/index.js';
export { configManager } from './utils/config.js';
export { logger } from './utils/logger.js';
export * from './types/index.js';
