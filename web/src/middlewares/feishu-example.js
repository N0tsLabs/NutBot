/**
 * 飞书通知中间件示例
 * 展示如何使用步骤更新中间件系统将 NutBot 的执行过程发送到飞书
 */

import { useAppStore } from '../stores/app.js';

// 飞书 Webhook 配置（实际使用时从配置文件或环境变量读取）
const FEISHU_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx';

/**
 * 创建飞书通知中间件
 * @param {Object} options - 配置选项
 * @param {string} options.webhookUrl - 飞书机器人 Webhook URL
 * @param {boolean} options.includeToolResults - 是否包含工具执行结果
 * @param {boolean} options.includeScreenshots - 是否包含截图（需要处理图片上传）
 * @returns {Function} 中间件函数
 */
export function createFeishuMiddleware(options = {}) {
	const { webhookUrl = FEISHU_WEBHOOK_URL, includeToolResults = true } = options;

	// 飞书消息队列，用于控制发送频率
	let messageQueue = [];
	let isProcessing = false;

	// 发送消息到飞书
	const sendToFeishu = async (content) => {
		try {
			const response = await fetch(webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					msg_type: 'text',
					content: {
						text: content,
					},
				}),
			});
			const result = await response.json();
			console.log('[Feishu] 消息发送成功:', result);
		} catch (error) {
			console.error('[Feishu] 消息发送失败:', error);
		}
	};

	// 处理消息队列
	const processQueue = async () => {
		if (isProcessing || messageQueue.length === 0) return;
		isProcessing = true;

		while (messageQueue.length > 0) {
			const message = messageQueue.shift();
			await sendToFeishu(message);
			// 控制发送频率，避免触发飞书限流
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		isProcessing = false;
	};

	// 格式化步骤更新消息
	const formatStepMessage = (type, chunk, context) => {
		const { sessionId, currentStep, timestamp } = context;
		const time = new Date(timestamp).toLocaleTimeString('zh-CN');

		switch (type) {
			case 'thinking':
				return `[${time}] 💭 步骤 ${chunk.step} - AI思考中...\n${chunk.content || ''}`;

			case 'summary':
				return `[${time}] 📝 步骤 ${chunk.step} - 执行结果:\n${chunk.content || ''}`;

			case 'tool_start':
				return `[${time}] 🔧 正在执行工具: ${chunk.tool}\n操作: ${chunk.action || 'N/A'}\n描述: ${chunk.description || '无'}`;

			case 'tool_result':
				if (!includeToolResults) return null;
				// 截断过长的结果
				let result = chunk.result || '';
				if (result.length > 500) {
					result = result.substring(0, 500) + '... (已截断)';
				}
				return `[${time}] ✅ 工具执行完成: ${chunk.tool}\n结果: ${result}`;

			case 'tool_error':
				return `[${time}] ❌ 工具执行失败: ${chunk.tool}\n错误: ${chunk.error || '未知错误'}`;

			default:
				return `[${time}] [${type}] ${JSON.stringify(chunk)}`;
		}
	};

	// 中间件函数
	const middleware = (type, chunk, context) => {
		const message = formatStepMessage(type, chunk, context);
		if (message) {
			messageQueue.push(message);
			processQueue();
		}
	};

	return middleware;
}

/**
 * 初始化飞书中间件
 * 在应用启动时调用
 */
export function initFeishuMiddleware(options = {}) {
	const store = useAppStore();
	const middleware = createFeishuMiddleware(options);

	// 注册中间件
	store.registerStepUpdateMiddleware(middleware);

	console.log('[Feishu] 中间件已注册');

	// 返回注销函数
	return () => {
		store.unregisterStepUpdateMiddleware(middleware);
		console.log('[Feishu] 中间件已注销');
	};
}

/**
 * 使用示例：
 *
 * // 在 main.js 或 App.vue 中初始化
 * import { initFeishuMiddleware } from './middlewares/feishu-example.js';
 *
 * // 方式1：使用默认配置
 * initFeishuMiddleware();
 *
 * // 方式2：自定义配置
 * const unregister = initFeishuMiddleware({
 *   webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-url',
 *   includeToolResults: true,
 * });
 *
 * // 需要时可以注销
 * // unregister();
 */
