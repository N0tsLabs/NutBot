import ScreenshotModule from "./screenshot.js";
import AIAnalyzer from "./aiAnalyzer.js";
import AutomationModule from "./automation.js";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import ErrorHandler from "../utils/errorHandler.js";

/**
 * 任务执行引擎
 */
class TaskEngine {
    constructor() {
        this.screenshotModule = new ScreenshotModule();
        this.aiAnalyzer = new AIAnalyzer();
        this.automationModule = new AutomationModule();
        this.isRunning = false;
        this.shouldStop = false;
        this.currentTask = null;
        this.actionHistory = [];
    }

    /**
     * 执行任务
     */
    async executeTask(userTask, options = {}) {
        return await ErrorHandler.handleAsync(async () => {
            if (this.isRunning) {
                throw new Error("任务引擎正在运行中，请等待当前任务完成");
            }

        this.isRunning = true;
        this.shouldStop = false;
        this.currentTask = {
            id: this.generateTaskId(),
            userTask,
            startTime: new Date(),
            options
        };
            this.actionHistory = [];

            logger.info(`开始执行任务: ${userTask}`);
            logger.info(`任务ID: ${this.currentTask.id}`);

            try {
                const result = await this.runTaskLoop();
                this.currentTask.endTime = new Date();
                this.currentTask.status = "completed";
                this.currentTask.result = result;

                logger.success(`任务执行完成: ${userTask}`);
                return result;
            } catch (error) {
                this.currentTask.endTime = new Date();
                this.currentTask.status = "failed";
                this.currentTask.error = error.message;

                logger.error(`任务执行失败: ${error.message}`);
                throw error;
            } finally {
                this.isRunning = false;
            }
        }, "TaskEngine.executeTask");
    }

    /**
     * 任务执行循环
     */
    async runTaskLoop() {
        const maxIterations = this.currentTask.options.maxIterations || 20;
        let iteration = 0;

        while (iteration < maxIterations && !this.shouldStop) {
            iteration++;
            logger.info(`执行第 ${iteration} 轮分析...`);

            // 检查是否需要停止
            if (this.shouldStop) {
                throw new Error("任务已被用户停止");
            }

            // 1. 截取屏幕截图
            const screenshot = await this.screenshotModule.capture({
                filename: `task-${this.currentTask.id}-${iteration}.png`
            });

            // 2. AI分析截图
            const analysis = await this.aiAnalyzer.analyzeScreenshot(
                screenshot.filePath,
                this.currentTask.userTask,
                this.actionHistory
            );

            logger.info(`AI分析结果: ${analysis.description}`);
            logger.debug(`推理过程: ${analysis.reasoning}`);

            // 3. 检查任务状态
            if (analysis.status === "complete") {
                logger.success("任务已完成！");
                return await this.generateFinalResult(analysis);
            }

            if (analysis.status === "error") {
                throw new Error(`AI分析错误: ${analysis.description}`);
            }

            // 4. 执行操作指令
            if (analysis.actions && analysis.actions.length > 0) {
                await this.executeActions(analysis.actions, iteration);
            } else {
                logger.warn("AI没有生成任何操作指令");
                await this.automationModule.wait({ duration: 2000 });
            }

            // 检查是否需要停止
            if (this.shouldStop) {
                throw new Error("任务已被用户停止");
            }

            // 5. 检查超时
            const elapsed = Date.now() - this.currentTask.startTime.getTime();
            if (elapsed > config.app.taskTimeout) {
                throw new Error(`任务执行超时 (${config.app.taskTimeout}ms)`);
            }
        }

        throw new Error(`任务执行达到最大迭代次数 (${maxIterations})`);
    }

    /**
     * 执行操作指令
     */
    async executeActions(actions, iteration) {
        logger.info(`执行 ${actions.length} 个操作指令...`);

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const actionId = `${this.currentTask.id}-${iteration}-${i + 1}`;

            logger.progress(`执行操作 ${i + 1}/${actions.length}: ${action.type} - ${action.target}`);

            try {
                const startTime = Date.now();
                await this.automationModule.executeAction(action);
                const duration = Date.now() - startTime;

                // 记录操作历史
                this.actionHistory.push({
                    id: actionId,
                    type: action.type,
                    target: action.target,
                    params: action.params,
                    success: true,
                    duration,
                    timestamp: new Date()
                });

                logger.success(`操作完成: ${action.type} (${duration}ms)`);
            } catch (error) {
                logger.error(`操作失败: ${action.type} - ${error.message}`);

                // 记录失败的操作
                this.actionHistory.push({
                    id: actionId,
                    type: action.type,
                    target: action.target,
                    params: action.params,
                    success: false,
                    error: error.message,
                    timestamp: new Date()
                });

                // 根据操作重要性决定是否继续
                if (action.critical !== false) {
                    throw error;
                }
            }
        }
    }

    /**
     * 生成最终结果
     */
    async generateFinalResult(finalAnalysis) {
        const result = {
            taskId: this.currentTask.id,
            userTask: this.currentTask.userTask,
            status: "completed",
            startTime: this.currentTask.startTime,
            endTime: new Date(),
            duration: Date.now() - this.currentTask.startTime.getTime(),
            totalActions: this.actionHistory.length,
            successfulActions: this.actionHistory.filter(a => a.success).length,
            failedActions: this.actionHistory.filter(a => !a.success).length,
            actionHistory: this.actionHistory,
            finalDescription: finalAnalysis.description,
            summary: null
        };

        // 生成任务总结
        try {
            result.summary = await this.aiAnalyzer.generateTaskSummary(
                this.currentTask.userTask,
                this.actionHistory
            );
        } catch (error) {
            logger.warn("生成任务总结失败:", error.message);
        }

        return result;
    }

    /**
     * 停止当前任务
     */
    async stopTask() {
        if (!this.isRunning) {
            logger.warn("没有正在运行的任务");
            return;
        }

        logger.info("正在停止任务...");
        this.shouldStop = true;
        this.isRunning = false;

        if (this.currentTask) {
            this.currentTask.endTime = new Date();
            this.currentTask.status = "stopped";
        }
    }

    /**
     * 获取任务状态
     */
    getTaskStatus() {
        return {
            isRunning: this.isRunning,
            currentTask: this.currentTask,
            actionCount: this.actionHistory.length
        };
    }

    /**
     * 生成任务ID
     */
    generateTaskId() {
        return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 清理资源
     */
    async cleanup() {
        logger.info("正在清理任务引擎资源...");

        try {
            // 清理旧截图
            await this.screenshotModule.cleanup();
            logger.success("资源清理完成");
        } catch (error) {
            logger.warn("资源清理失败:", error.message);
        }
    }
}

export default TaskEngine;
