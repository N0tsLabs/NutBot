/**
 * 浏览器模块统一导出
 * 简化版浏览器管理，合并了 browser-service 和 browser tool 的功能
 */

export { BrowserManager, browserManager } from './manager.js';
export { launchBrowser, findBrowserExecutable, getDefaultConfig, clearSessionRestore, DEFAULT_USER_DATA_DIR, getSystemDefaultBrowser } from './launcher.js';
export { evaluatePage, getPageEvaluatorScript } from './page-evaluator.js';
export type {
	BrowserType,
	BrowserState,
	BrowserConfig,
	PageState,
	PageElement,
	IBrowserManager
} from './types.js';
