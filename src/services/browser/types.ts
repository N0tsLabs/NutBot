/**
 * 浏览器模块类型定义
 * 简化版，只保留核心类型
 */

import type { BrowserContext, Page } from 'playwright-core';

/** 浏览器类型 */
export type BrowserType = 'chrome' | 'edge' | 'chromium';

/** 浏览器状态 */
export interface BrowserState {
	/** 是否已启动 */
	isRunning: boolean;
	/** 浏览器类型 */
	browserType: BrowserType;
	/** 当前页面 URL */
	currentUrl: string;
	/** 当前页面标题 */
	currentTitle: string;
	/** 当前页面数量 */
	pageCount: number;
}

/** 页面元素 */
export interface PageElement {
	/** 元素索引 */
	index: number;
	/** 元素类型 */
	type: string;
	/** 元素标签名 */
	tag: string;
	/** 元素文本内容 */
	text: string;
	/** 元素名称/标题 */
	name: string;
	/** 元素 class */
	class?: string;
	/** 是否可交互 */
	isInteractive: boolean;
}

/** 页面状态 */
export interface PageState {
	/** 页面 URL */
	url: string;
	/** 页面标题 */
	title: string;
	/** 页面元素列表 */
	elements: PageElement[];
	/** 页面文本内容摘要 */
	content?: string;
	/** 截图（base64） */
	screenshot?: string;
}

/** 浏览器配置 */
export interface BrowserConfig {
	/** 浏览器类型 */
	type: BrowserType;
	/** 用户数据目录 */
	userDataDir: string;
	/** 可执行文件路径 */
	executablePath?: string;
	/** 是否无头模式 */
	headless?: boolean;
	/** 视口宽度 */
	viewportWidth?: number;
	/** 视口高度 */
	viewportHeight?: number;
	/** 默认导航超时 */
	navigationTimeout?: number;
}

/** 浏览器管理器接口 */
export interface IBrowserManager {
	/** 启动浏览器 */
	launch(config?: Partial<BrowserConfig>): Promise<void>;
	/** 关闭浏览器 */
	close(): Promise<void>;
	/** 获取浏览器状态 */
	getState(): BrowserState;
	/** 导航到 URL */
	goto(url: string): Promise<PageState>;
	/** 点击元素 */
	click(elementIndex: number): Promise<PageState>;
	/** 输入文本 */
	input(elementIndex: number, text: string): Promise<PageState>;
	/** 返回上一页 */
	back(): Promise<PageState>;
	/** 获取当前页面状态 */
	getPageState(): Promise<PageState>;
	/** 截图 */
	screenshot(): Promise<string>;
}

/** 内部使用的浏览器上下文包装 */
export interface BrowserContextWrapper {
	context: BrowserContext;
	page: Page;
	config: BrowserConfig;
}
