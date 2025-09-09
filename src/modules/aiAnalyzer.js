import { readFile } from "fs/promises";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import ErrorHandler from "../utils/errorHandler.js";

/**
 * AI分析模块 - 使用原生API请求
 */
class AIAnalyzer {
    constructor() {
        this.apiKey = config.openai.apiKey;
        this.model = config.openai.model;
        // this.baseURL = "https://api.openai.com/v1";
        this.baseURL = "https://api.qqslyx.com/v1";

        // 检查API密钥
        if (!this.apiKey || this.apiKey === "your_openai_api_key_here") {
            throw new Error("OpenAI API密钥未设置，请在.env文件中设置OPENAI_API_KEY");
        }
    }

    /**
     * 分析截图并生成操作指令
     */
    async analyzeScreenshot(screenshotPath, userTask, previousActions = []) {
        return await ErrorHandler.handleAsync(async () => {
            logger.info("正在分析截图并生成操作指令...");

            // 读取截图文件
            const imageBuffer = await readFile(screenshotPath);
            const base64Image = imageBuffer.toString("base64");

            // 构建提示词
            const systemPrompt = this.buildSystemPrompt();
            const userPrompt = this.buildUserPrompt(userTask, previousActions);

            // 构建请求数据
            const requestData = {
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: userPrompt
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${base64Image}`,
                                    detail: "high"
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 2000,
                temperature: 0.1
            };

            // 发送API请求
            const response = await this.makeAPIRequest("/chat/completions", requestData);

            if (!response.choices || !response.choices[0] || !response.choices[0].message) {
                throw new Error("API响应格式错误");
            }

            const analysisResult = this.parseAIResponse(response.choices[0].message.content);

            logger.success("AI分析完成");
            logger.debug("分析结果:", analysisResult);

            return analysisResult;
        }, "AIAnalyzer.analyzeScreenshot");
    }

    /**
     * 发送API请求
     */
    async makeAPIRequest(endpoint, data) {
        const url = `${this.baseURL}${endpoint}`;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data),
                timeout: 30000 // 30秒超时
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;

                if (response.status === 401) {
                    throw new Error("OpenAI API密钥无效，请检查环境变量 OPENAI_API_KEY");
                } else if (response.status === 429) {
                    throw new Error("OpenAI API请求频率限制，请稍后重试");
                } else if (response.status === 500) {
                    throw new Error("OpenAI服务器错误，请稍后重试");
                } else {
                    throw new Error(`API请求失败: ${errorMessage}`);
                }
            }

            return await response.json();
        } catch (error) {
            if (error.name === "TypeError" && error.message.includes("fetch")) {
                throw new Error("网络连接失败，请检查网络连接或代理设置");
            } else if (error.name === "AbortError") {
                throw new Error("请求超时，请稍后重试");
            } else {
                throw error;
            }
        }
    }

    /**
     * 构建系统提示词
     */
    buildSystemPrompt() {
        return `你是一个专业的自动化任务执行助手。你的任务是分析屏幕截图，理解用户的任务需求，并生成具体的操作指令。

请按照以下JSON格式返回分析结果：
{
  "status": "continue|complete|error",
  "description": "对当前屏幕状态和下一步操作的描述",
  "actions": [
    {
      "type": "click|type|scroll|wait|key|move",
      "target": "目标描述（如按钮文字、坐标等）",
      "params": {
        "x": 100,
        "y": 200,
        "text": "要输入的文字",
        "key": "要按的键",
        "duration": 1000
      },
      "confidence": 0.9
    }
  ],
  "reasoning": "为什么选择这些操作的推理过程"
}

操作类型说明：
- click: 点击操作，需要x,y坐标或目标描述
- type: 输入文字，需要text参数
- scroll: 滚动操作，需要direction和amount参数
- wait: 等待，需要duration参数
- key: 按键操作，需要key参数
- move: 移动鼠标，需要x,y坐标

请确保：
1. 操作指令具体明确
2. 坐标位置准确
3. 操作顺序合理
4. 包含足够的等待时间
5. 如果任务已完成，设置status为"complete"
6. 如果遇到错误，设置status为"error"`;
    }

    /**
     * 构建用户提示词
     */
    buildUserPrompt(userTask, previousActions) {
        let prompt = `用户任务: ${userTask}\n\n`;

        if (previousActions.length > 0) {
            prompt += `之前的操作历史:\n`;
            previousActions.forEach((action, index) => {
                prompt += `${index + 1}. ${action.type}: ${action.description || action.target}\n`;
            });
            prompt += "\n";
        }

        prompt += `请分析当前屏幕截图，生成下一步的操作指令。`;

        return prompt;
    }

    /**
     * 解析AI响应
     */
    parseAIResponse(responseText) {
        try {
            // 尝试提取JSON部分
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("无法找到有效的JSON响应");
            }

            const jsonStr = jsonMatch[0];
            const parsed = JSON.parse(jsonStr);

            // 验证响应格式
            this.validateResponse(parsed);

            return parsed;
        } catch (error) {
            logger.error("解析AI响应失败:", error.message);
            logger.debug("原始响应:", responseText);

            // 返回默认错误响应
            return {
                status: "error",
                description: "AI响应解析失败",
                actions: [],
                reasoning: error.message
            };
        }
    }

    /**
     * 验证AI响应格式
     */
    validateResponse(response) {
        const requiredFields = ["status", "description", "actions", "reasoning"];

        for (const field of requiredFields) {
            if (!(field in response)) {
                throw new Error(`缺少必需字段: ${field}`);
            }
        }

        if (!["continue", "complete", "error"].includes(response.status)) {
            throw new Error(`无效的状态值: ${response.status}`);
        }

        if (!Array.isArray(response.actions)) {
            throw new Error("actions必须是数组");
        }

        // 验证每个操作
        for (const action of response.actions) {
            this.validateAction(action);
        }
    }

    /**
     * 验证操作格式
     */
    validateAction(action) {
        const requiredFields = ["type", "target"];
        const validTypes = ["click", "type", "scroll", "wait", "key", "move"];

        for (const field of requiredFields) {
            if (!(field in action)) {
                throw new Error(`操作缺少必需字段: ${field}`);
            }
        }

        if (!validTypes.includes(action.type)) {
            throw new Error(`无效的操作类型: ${action.type}`);
        }

        if (action.confidence && (action.confidence < 0 || action.confidence > 1)) {
            throw new Error(`置信度必须在0-1之间: ${action.confidence}`);
        }
    }

    /**
     * 获取任务完成总结
     */
    async generateTaskSummary(task, actions, finalScreenshot) {
        return await ErrorHandler.handleAsync(async () => {
            logger.info("正在生成任务完成总结...");

            const prompt = `请为以下自动化任务生成一个简洁的完成总结：

任务: ${task}
执行的操作数量: ${actions.length}
操作列表: ${actions.map((a) => `${a.type}: ${a.target}`).join(", ")}

请用中文生成一个简洁的总结，包括：
1. 任务是否成功完成
2. 主要执行了哪些操作
3. 是否有任何需要注意的问题

总结应该简洁明了，不超过200字。`;

            const requestData = {
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.3
            };

            const response = await this.makeAPIRequest("/chat/completions", requestData);

            if (!response.choices || !response.choices[0] || !response.choices[0].message) {
                throw new Error("API响应格式错误");
            }

            const summary = response.choices[0].message.content.trim();
            logger.success("任务总结生成完成");

            return summary;
        }, "AIAnalyzer.generateTaskSummary");
    }

    /**
     * 测试API连接
     */
    async testConnection() {
        return await ErrorHandler.handleAsync(async () => {
            logger.info("测试OpenAI API连接...");

            const requestData = {
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "user",
                        content: "Hello, this is a connection test."
                    }
                ],
                max_tokens: 10
            };

            const response = await this.makeAPIRequest("/chat/completions", requestData);

            if (response.choices && response.choices[0]) {
                logger.success("OpenAI API连接测试成功");
                return true;
            } else {
                throw new Error("API响应格式错误");
            }
        }, "AIAnalyzer.testConnection");
    }
}

export default AIAnalyzer;
