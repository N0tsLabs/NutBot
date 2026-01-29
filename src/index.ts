/**
 * NutBot 主入口
 * AI 驱动的自动化机器人
 */

import { Command } from 'commander';
import { gateway } from './gateway/index.js';

const program = new Command();

program.name('nutbot').description('AI 驱动的自动化机器人').version('0.1.0');

// 启动命令
program
	.command('start')
	.description('启动 NutBot 服务')
	.option('-c, --config <path>', '配置文件路径')
	.option('-p, --port <port>', '服务端口', '18800')
	.option('-h, --host <host>', '服务地址', '127.0.0.1')
	.action(async (options) => {
		try {
			// 初始化
			await gateway.init({
				configPath: options.config,
			});

			// 覆盖配置
			if (options.port) {
				gateway.config.set('server.port', parseInt(options.port));
			}
			if (options.host) {
				gateway.config.set('server.host', options.host);
			}

			// 启动
			await gateway.start();

			// 处理退出信号
			const shutdown = async () => {
				console.log('\n正在关闭...');
				await gateway.stop();
				process.exit(0);
			};

			process.on('SIGINT', shutdown);
			process.on('SIGTERM', shutdown);
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
export { ToolRegistry, BaseTool } from './tools/index.js';
export { Agent, SessionManager } from './agent/index.js';
export { CronManager } from './cron/index.js';
export { configManager } from './utils/config.js';
export { logger } from './utils/logger.js';
export * from './types/index.js';
