#!/usr/bin/env node

import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";
import config from "./config/index.js";
import logger from "./utils/logger.js";
import platformUtils from "./utils/platform.js";
import TaskEngine from "./modules/taskEngine.js";
import ErrorHandler from "./utils/errorHandler.js";

/**
 * 交互式主程序类
 */
class AutoNutsApp {
    constructor() {
        this.taskEngine = null;
        this.isRunning = false;
        this.currentTask = null;
        this.rl = null;
        this.setupReadline();
    }

    /**
     * 设置交互式输入
     */
    setupReadline() {
        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan('🤖 Auto-Nuts > ')
        });

        this.rl.on('line', this.handleInput.bind(this));
        this.rl.on('close', this.handleClose.bind(this));
    }

    /**
     * 处理用户输入
     */
    async handleInput(input) {
        try {
            const command = input.trim();
            
            if (!command) {
                this.rl.prompt();
                return;
            }

        // 处理特殊命令
        if (command === 'exit' || command === 'quit') {
            await this.handleExit();
            return;
        }

        if (command === 'help') {
            this.showHelp();
            this.rl.prompt();
            return;
        }

        if (command === 'status') {
            this.showStatus();
            this.rl.prompt();
            return;
        }

        if (command === 'stop') {
            await this.stopCurrentTask();
            this.rl.prompt();
            return;
        }

        if (command === 'check') {
            await this.checkSystem();
            this.rl.prompt();
            return;
        }

        if (command === 'config') {
            this.showConfig();
            this.rl.prompt();
            return;
        }

        if (command === 'cleanup') {
            await this.cleanup();
            this.rl.prompt();
            return;
        }

        if (command === 'test-api') {
            await this.testAPI();
            this.rl.prompt();
            return;
        }

        // 执行任务
        await this.executeTask(command);
        
        } catch (error) {
            console.error(chalk.red('处理输入时发生错误:'), error.message);
            console.log(chalk.yellow('程序将继续运行...'));
            this.rl.prompt();
        }
    }

    /**
     * 执行任务
     */
    async executeTask(task) {
        if (this.isRunning) {
            console.log(chalk.yellow('⚠️  有任务正在运行中，请先输入 "stop" 停止当前任务'));
            this.rl.prompt();
            return;
        }

        this.isRunning = true;
        this.currentTask = {
            id: this.generateTaskId(),
            task,
            startTime: new Date()
        };

        console.log(chalk.green(`\n🚀 开始执行任务: ${task}`));
        console.log(chalk.gray(`任务ID: ${this.currentTask.id}`));
        console.log(chalk.gray(`开始时间: ${this.currentTask.startTime.toLocaleString()}`));
        console.log(chalk.gray('输入 "stop" 可以随时停止任务\n'));

        try {
            // 初始化任务引擎
            if (!this.taskEngine) {
                this.taskEngine = new TaskEngine();
            }

            // 验证配置
            const configValidation = config.validate();
            if (!configValidation.isValid) {
                console.log(chalk.red('❌ 配置验证失败:'));
                configValidation.errors.forEach(error => console.log(chalk.red(`  - ${error}`)));
                this.isRunning = false;
                this.rl.prompt();
                return;
            }

            // 执行任务
            const result = await this.taskEngine.executeTask(task, {
                maxIterations: 20,
                timeout: 300000
            });

            this.currentTask.endTime = new Date();
            this.currentTask.status = "completed";
            this.currentTask.result = result;

            // 显示结果
            this.displayTaskResult(result);

        } catch (error) {
            this.currentTask.endTime = new Date();
            this.currentTask.status = "failed";
            this.currentTask.error = error.message;

            console.log(chalk.red(`\n❌ 任务执行失败: ${error.message}`));
            
            if (error.message.includes('stopped')) {
                console.log(chalk.yellow('任务已被用户停止'));
            } else {
                console.log(chalk.red('请检查错误信息并重试'));
            }
        } finally {
            this.isRunning = false;
            console.log(chalk.cyan('\n💡 输入新的任务指令继续，或输入 "help" 查看帮助'));
            this.rl.prompt();
        }
    }

    /**
     * 停止当前任务
     */
    async stopCurrentTask() {
        if (!this.isRunning) {
            console.log(chalk.yellow('⚠️  当前没有正在运行的任务'));
            return;
        }

        console.log(chalk.yellow('\n⏹️  正在停止当前任务...'));
        
        try {
            if (this.taskEngine) {
                await this.taskEngine.stopTask();
            }
            
            this.isRunning = false;
            this.currentTask.status = "stopped";
            this.currentTask.endTime = new Date();
            
            console.log(chalk.green('✅ 任务已停止'));
        } catch (error) {
            console.log(chalk.red(`❌ 停止任务失败: ${error.message}`));
        }
    }

    /**
     * 显示帮助信息
     */
    showHelp() {
        console.log(chalk.bold.cyan('\n📖 Auto-Nuts 帮助信息'));
        console.log(chalk.gray('='.repeat(50)));
        console.log(chalk.white('基本用法:'));
        console.log(chalk.green('  直接输入任务描述即可开始执行'));
        console.log(chalk.gray('  例如: "打开网页去bilibili看看热搜总结给我"'));
        console.log();
        console.log(chalk.white('特殊命令:'));
        console.log(chalk.blue('  help     - 显示此帮助信息'));
        console.log(chalk.blue('  status   - 显示当前状态'));
        console.log(chalk.blue('  stop     - 停止当前任务'));
        console.log(chalk.blue('  check    - 检查系统环境'));
        console.log(chalk.blue('  config   - 显示配置信息'));
        console.log(chalk.blue('  cleanup  - 清理临时文件'));
        console.log(chalk.blue('  test-api - 测试OpenAI API连接'));
        console.log(chalk.blue('  exit     - 退出程序'));
        console.log();
        console.log(chalk.white('提示:'));
        console.log(chalk.yellow('  - 任务执行过程中可以随时输入 "stop" 停止'));
        console.log(chalk.yellow('  - 支持自然语言描述，AI会自动分析并执行'));
        console.log(chalk.yellow('  - 程序会持续运行，可以连续执行多个任务'));
        console.log(chalk.gray('='.repeat(50)));
    }

    /**
     * 显示当前状态
     */
    showStatus() {
        console.log(chalk.bold.cyan('\n📊 当前状态'));
        console.log(chalk.gray('='.repeat(30)));
        console.log(chalk.white(`运行状态: ${this.isRunning ? chalk.green('运行中') : chalk.gray('空闲')}`));
        
        if (this.currentTask) {
            console.log(chalk.white(`当前任务: ${this.currentTask.task}`));
            console.log(chalk.white(`任务ID: ${this.currentTask.id}`));
            console.log(chalk.white(`状态: ${this.currentTask.status || '未知'}`));
            console.log(chalk.white(`开始时间: ${this.currentTask.startTime.toLocaleString()}`));
            
            if (this.currentTask.endTime) {
                console.log(chalk.white(`结束时间: ${this.currentTask.endTime.toLocaleString()}`));
                const duration = this.currentTask.endTime - this.currentTask.startTime;
                console.log(chalk.white(`执行时长: ${(duration / 1000).toFixed(2)}秒`));
            }
        } else {
            console.log(chalk.gray('当前任务: 无'));
        }
        
        console.log(chalk.gray('='.repeat(30)));
    }

    /**
     * 显示任务结果
     */
    displayTaskResult(result) {
        console.log(chalk.bold.green('\n🎉 任务执行完成!'));
        console.log(chalk.gray('='.repeat(40)));
        console.log(chalk.white(`任务ID: ${result.taskId}`));
        console.log(chalk.white(`状态: ${result.status}`));
        console.log(chalk.white(`执行时间: ${(result.duration / 1000).toFixed(2)}秒`));
        console.log(chalk.white(`总操作数: ${result.totalActions}`));
        console.log(chalk.white(`成功操作: ${result.successfulActions}`));
        console.log(chalk.white(`失败操作: ${result.failedActions}`));

        if (result.summary) {
            console.log(chalk.cyan('\n📝 任务总结:'));
            console.log(chalk.white(result.summary));
        }

        if (result.finalDescription) {
            console.log(chalk.blue('\n🔍 最终状态:'));
            console.log(chalk.white(result.finalDescription));
        }
        
        console.log(chalk.gray('='.repeat(40)));
    }

    /**
     * 检查系统环境
     */
    async checkSystem() {
        const spinner = ora("检查系统环境...").start();

        try {
            // 显示系统信息
            console.log(chalk.bold("\n💻 系统信息:"));
            console.log(chalk.white(`操作系统: ${config.platform}`));
            console.log(chalk.white(`Node.js版本: ${process.version}`));
            console.log(chalk.white(`工作目录: ${process.cwd()}`));

            // 检查配置
            spinner.text = "检查配置...";
            const configValidation = config.validate();
            if (configValidation.isValid) {
                console.log(chalk.green("✅ 配置验证通过"));
            } else {
                console.log(chalk.red("❌ 配置验证失败:"));
                configValidation.errors.forEach(error => console.log(chalk.red(`  - ${error}`)));
            }

            // 检查依赖
            spinner.text = "检查依赖...";
            try {
                const dependencies = await platformUtils.checkDependencies();
            } catch (error) {
                console.log(chalk.yellow("⚠️  依赖检查失败，但继续执行"));
            }
            
            // 检查权限
            spinner.text = "检查权限...";
            try {
                const permissions = await platformUtils.checkPermissions();
            } catch (error) {
                console.log(chalk.yellow("⚠️  权限检查失败，但继续执行"));
            }

            // 获取屏幕信息
            spinner.text = "获取屏幕信息...";
            try {
                const screenInfo = await platformUtils.getScreenInfo();
                console.log(chalk.white(`屏幕分辨率: ${screenInfo.width}x${screenInfo.height} (缩放: ${screenInfo.scale})`));
            } catch (error) {
                console.log(chalk.yellow("⚠️  无法获取屏幕信息"));
            }

            spinner.succeed("系统检查完成");

            // 显示建议
            try {
                const recommendations = platformUtils.getPlatformRecommendations();
                if (recommendations.length > 0) {
                    console.log(chalk.yellow("\n💡 平台建议:"));
                    recommendations.forEach(rec => console.log(chalk.yellow(`  - ${rec}`)));
                }
            } catch (error) {
                console.log(chalk.yellow("⚠️  无法获取平台建议"));
            }

        } catch (error) {
            spinner.fail("系统检查失败");
            console.log(chalk.red(`错误: ${error.message}`));
            console.log(chalk.red(`错误堆栈: ${error.stack}`));
        }
    }

    /**
     * 显示配置信息
     */
    showConfig() {
        console.log(chalk.bold.cyan("\n⚙️  当前配置:"));
        console.log(chalk.gray('='.repeat(30)));
        console.log(chalk.white(`OpenAI模型: ${config.openai.model}`));
        console.log(chalk.white(`截图质量: ${config.app.screenshotQuality}`));
        console.log(chalk.white(`最大重试次数: ${config.app.maxRetryAttempts}`));
        console.log(chalk.white(`任务超时: ${config.app.taskTimeout}ms`));
        console.log(chalk.white(`截图目录: ${config.app.screenshotsDir}`));
        console.log(chalk.white(`临时目录: ${config.app.tempDir}`));
        console.log(chalk.white(`平台: ${config.platform}`));
        console.log(chalk.gray('='.repeat(30)));
    }

    /**
     * 清理临时文件
     */
    async cleanup() {
        const spinner = ora("清理临时文件...").start();

        try {
            if (!this.taskEngine) {
                this.taskEngine = new TaskEngine();
            }
            await this.taskEngine.cleanup();
            spinner.succeed("清理完成");
        } catch (error) {
            spinner.fail("清理失败");
            console.log(chalk.red(`错误: ${error.message}`));
        }
    }

    /**
     * 测试OpenAI API连接
     */
    async testAPI() {
        const spinner = ora("测试OpenAI API连接...").start();

        try {
            if (!this.taskEngine) {
                this.taskEngine = new TaskEngine();
            }

            // 获取AI分析器实例
            const aiAnalyzer = this.taskEngine.aiAnalyzer;
            await aiAnalyzer.testConnection();
            
            spinner.succeed("OpenAI API连接测试成功");
            console.log(chalk.green("✅ API密钥有效，可以正常使用"));
        } catch (error) {
            spinner.fail("OpenAI API连接测试失败");
            console.log(chalk.red(`❌ 错误: ${error.message}`));
            console.log(chalk.yellow("请检查："));
            console.log(chalk.yellow("  1. OPENAI_API_KEY 环境变量是否正确设置"));
            console.log(chalk.yellow("  2. API密钥是否有效"));
            console.log(chalk.yellow("  3. 网络连接是否正常"));
        }
    }

    /**
     * 处理退出
     */
    async handleExit() {
        console.log(chalk.yellow('\n👋 正在退出 Auto-Nuts...'));
        
        if (this.isRunning) {
            console.log(chalk.yellow('⏹️  正在停止当前任务...'));
            await this.stopCurrentTask();
        }

        if (this.taskEngine) {
            console.log(chalk.yellow('🧹 正在清理资源...'));
            await this.taskEngine.cleanup();
        }

        console.log(chalk.green('✅ 退出完成，感谢使用 Auto-Nuts!'));
        this.rl.close();
        process.exit(0);
    }

    /**
     * 处理关闭
     */
    handleClose() {
        console.log(chalk.green('\n👋 再见!'));
        process.exit(0);
    }

    /**
     * 生成任务ID
     */
    generateTaskId() {
        return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 启动应用
     */
    async start() {
        // 添加全局异常处理
        process.on('uncaughtException', (error) => {
            console.error(chalk.red('未捕获的异常:'), error);
            console.log(chalk.yellow('程序将继续运行...'));
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error(chalk.red('未处理的Promise拒绝:'), reason);
            console.log(chalk.yellow('程序将继续运行...'));
        });

        try {
            // 显示欢迎信息
            console.log(chalk.bold.cyan("🤖 Auto-Nuts - AI驱动的自动化任务执行系统"));
            console.log(chalk.gray("版本: 1.0.0"));
            console.log(chalk.gray("输入 'help' 查看帮助，输入 'exit' 退出程序"));
            console.log();

            // 检查系统环境
            console.log(chalk.yellow("🔍 正在检查系统环境..."));
            const configValidation = config.validate();
            if (!configValidation.isValid) {
                console.log(chalk.red("❌ 配置验证失败:"));
                configValidation.errors.forEach(error => console.log(chalk.red(`  - ${error}`)));
                console.log(chalk.yellow("请检查配置后重新启动程序"));
                process.exit(1);
            }

            // 检查API密钥
            if (!config.openai.apiKey || config.openai.apiKey === 'your_openai_api_key_here') {
                console.log(chalk.red("❌ OpenAI API密钥未设置"));
                console.log(chalk.yellow("请按以下步骤配置API密钥:"));
                console.log(chalk.yellow("  1. 访问 https://platform.openai.com/api-keys"));
                console.log(chalk.yellow("  2. 创建新的API密钥"));
                console.log(chalk.yellow("  3. 编辑 .env 文件，设置 OPENAI_API_KEY=你的密钥"));
                console.log(chalk.yellow("  4. 重新启动程序"));
                process.exit(1);
            }

            const systemCheck = await platformUtils.checkDependencies();
            if (!systemCheck.allGood) {
                console.log(chalk.yellow("⚠️  系统环境检查发现问题，但程序将继续运行"));
            } else {
                console.log(chalk.green("✅ 系统环境检查通过"));
            }

            console.log(chalk.cyan("\n💡 现在可以开始输入任务指令了!"));
            console.log(chalk.gray("例如: 打开网页去bilibili看看热搜总结给我"));
            console.log();

            // 开始交互式输入
            this.rl.prompt();

        } catch (error) {
            console.error(chalk.red("应用启动失败:"), error.message);
            process.exit(1);
        }
    }
}

// 启动应用
const app = new AutoNutsApp();
app.start().catch(error => {
    console.error("应用启动失败:", error);
    process.exit(1);
});