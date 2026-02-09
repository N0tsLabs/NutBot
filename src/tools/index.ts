/**
 * Tools 模块导出
 */

import { ToolRegistry, BaseTool } from './registry.js';
import { ExecTool, systemInfo, getSystemDescription } from './exec.js';
import { BrowserTool } from './browser.js';
import { ComputerTool } from './computer.js';
import { ScreenshotTool } from './screenshot.js';
import { WebTool } from './web.js';
import { FileTool } from './file.js';
import { OfficeTool } from './office.js';
import { ClipboardTool } from './clipboard.js';
import { HttpTool } from './http.js';
import { NotifyTool } from './notify.js';
import { WindowTool } from './window.js';
import { SystemInfoTool } from './system-info.js';

export {
	ToolRegistry,
	BaseTool,
	ExecTool,
	BrowserTool,
	ComputerTool,
	ScreenshotTool,
	// WebTool 已移除 - 按用户建议，所有浏览器操作统一使用BrowserTool
	FileTool,
	OfficeTool,
	ClipboardTool,
	HttpTool,
	NotifyTool,
	WindowTool,
	SystemInfoTool,
	systemInfo,
	getSystemDescription,
};

export default ToolRegistry;
