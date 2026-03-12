/**
 * 浏览器自动化工具 - 简化版
 * 
 * 使用新的 BrowserManager 统一管理浏览器
 * 只保留工具接口层，核心逻辑委托给 BrowserManager
 */

import { BaseTool } from './registry.js';
import { browserManager, type PageState, type PageElement } from '../services/browser/index.js';

export class BrowserTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'browser',
			description: `浏览器自动化工具。通过数字索引操作网页元素。

【核心功能】
- goto(url) - 访问网页，返回页面状态（包含元素列表和页面内容）
- click(index) - 点击指定索引的元素
- type(index, text) - 在输入框中输入文本
- back() - 返回上一页
- screenshot() - 截图

【返回结果字段说明】
- elements: 可交互元素列表，格式为 "[索引] 类型: 名称"
- content: 页面主要内容文本（重要！包含消息、文章等文本信息）
- url: 当前页面URL
- title: 页面标题

【元素类型标记】
- [link] - 链接，可点击
- [button] - 按钮，可点击
- [input] - 输入框，可输入文本
- [textarea] - 文本域，可输入文本
- [select] - 下拉选择框

【执行原则】
- **立即执行** - 获取信息后马上执行下一步
- **相信返回** - 工具返回值包含完整信息，特别是 content 字段
- **读取 content 字段** - 页面文本内容在 content 字段中

【登录页面处理】
如果返回的页面状态显示以下特征，说明遇到了登录页面：
- URL 包含 login、signin、auth 等关键词
- 标题包含"登录"、"Sign in"等
- content 包含"请先登录"、"需要登录"、"未登录"等提示
- elements 包含用户名/密码输入框

**处理原则**：
- 如果用户提供了账号密码 → 可以执行登录操作
- 如果用户未提供账号密码 → 停止并反馈用户需要登录`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: ['goto', 'state', 'click', 'type', 'back', 'screenshot'],
				},
				url: {
					type: 'string',
					description: 'goto 的目标网址',
				},
				index: {
					type: 'number',
					description: '元素编号（从 state 结果获取）',
				},
				text: {
					type: 'string',
					description: 'type 操作要输入的文本',
				},
			},
			...config,
		});
	}

	async execute(params: Record<string, unknown>): Promise<unknown> {
		const { action } = params;

		switch (action) {
			case 'goto':
				if (!params.url) throw new Error('goto 需要 url 参数');
				return await this.goto(params.url as string);
			case 'state':
				return await this.getState();
			case 'click':
				if (params.index === undefined) throw new Error('click 需要 index 参数');
				return await this.click(params.index as number);
			case 'type':
				if (params.index === undefined) throw new Error('type 需要 index 参数');
				if (!params.text) throw new Error('type 需要 text 参数');
				return await this.type(params.index as number, params.text as string);
			case 'back':
				return await this.goBack();
			case 'screenshot':
				return await this.screenshot();
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 导航到指定 URL
	 */
	private async goto(url: string): Promise<PageState> {
		this.logger.info(`导航到: ${url}`);
		
		// 确保浏览器已启动
		const state = await browserManager.getState();
		if (!state.isRunning) {
			this.logger.info('浏览器未启动，正在启动...');
			await browserManager.launch();
		}
		
		return await browserManager.goto(url);
	}

	/**
	 * 获取当前页面状态
	 */
	private async getState(): Promise<PageState> {
		this.logger.info('获取页面状态');
		return await browserManager.getPageState();
	}

	/**
	 * 点击元素
	 */
	private async click(index: number): Promise<PageState> {
		this.logger.info(`点击元素: ${index}`);
		return await browserManager.click(index);
	}

	/**
	 * 输入文本
	 */
	private async type(index: number, text: string): Promise<PageState> {
		this.logger.info(`输入文本到元素 ${index}: ${text}`);
		return await browserManager.input(index, text);
	}

	/**
	 * 返回上一页
	 */
	private async goBack(): Promise<PageState> {
		this.logger.info('返回上一页');
		return await browserManager.back();
	}

	/**
	 * 截图
	 */
	private async screenshot(): Promise<{ screenshot: string }> {
		this.logger.info('截图');
		const screenshot = await browserManager.screenshot();
		return { screenshot };
	}
}

// 导出工具实例
export const browserTool = new BrowserTool();

// 默认导出（用于工具注册）
export default BrowserTool;
