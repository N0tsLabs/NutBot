/**
 * Tools 模块导出
 */

import { ToolRegistry, BaseTool } from './registry.js';
import { ExecTool, systemInfo, getSystemDescription } from './exec.js';
import { BrowserTool } from './browser.js';
import { ComputerTool } from './computer.js';
import { ScreenshotTool } from './screenshot.js';
import { FileTool } from './file.js';
import { OfficeTool } from './office.js';
import { ClipboardTool } from './clipboard.js';
import { HttpTool } from './http.js';
import { NotifyTool } from './notify.js';
import { WindowTool } from './window.js';
import { SystemInfoTool } from './system-info.js';
import { IdentityTool } from './identity.js';
import { AppTool } from './app.js';
import { LauncherTool } from './launcher.js';
import { ProcessTool } from './process.js';
import type { ToolSchema } from '../types/index.js';

export {
	ToolRegistry,
	BaseTool,
	ExecTool,
	BrowserTool,
	ComputerTool,
	ScreenshotTool,
	// WebTool 已移除 - 所有网页操作统一使用 BrowserTool
	FileTool,
	OfficeTool,
	ClipboardTool,
	HttpTool,
	NotifyTool,
	WindowTool,
	SystemInfoTool,
	IdentityTool,
	AppTool,
	LauncherTool,
	ProcessTool,
	systemInfo,
	getSystemDescription,
};

// ============================================================================
// 动态工具描述生成
// ============================================================================

/**
 * 参数属性定义
 */
interface ParameterProperty {
	type?: string;
	description?: string;
	enum?: string[];
	items?: {
		type?: string;
	};
}

/**
 * 从工具 schema 生成简洁的工具描述
 * 用于注入到系统提示词中
 */
export function generateToolsDescription(schemas: ToolSchema[]): string {
	if (schemas.length === 0) {
		return '';
	}

	const lines: string[] = ['## 可用工具'];

	for (const schema of schemas) {
		const { name, description, parameters } = schema;

		// 提取方法列表（从 action 参数的 enum 或工具名称）
		const properties = parameters.properties as Record<string, ParameterProperty> | undefined;
		const actionParam = properties?.action;
		const methods = actionParam?.enum || [];

		// 工具标题行
		lines.push(`\n### ${name}`);

		// 描述
		if (description) {
			// 只取第一行作为简短描述
			const shortDesc = description.split('\n')[0].trim();
			if (shortDesc) {
				lines.push(shortDesc);
			}
		}

		// 方法列表
		if (methods.length > 0) {
			lines.push(`**方法**: ${methods.join(', ')}`);
		}

		// 关键参数（只显示必填参数）
		const required = parameters.required || [];
		if (required.length > 0) {
			const params = required
				.map((param) => {
					const prop = properties?.[param];
					if (!prop) return param;
					const desc = prop.description ? ` - ${prop.description.split('。')[0]}` : '';
					return `${param}${desc}`;
				})
				.join(', ');
			lines.push(`**必填**: ${params}`);
		}
	}

	return lines.join('\n');
}

/**
 * 生成工具方法速查表
 * 用于 SYSTEM.md 中的预定义方法列表
 */
export function generateMethodsCheatSheet(schemas: ToolSchema[]): string {
	const lines: string[] = [];

	for (const schema of schemas) {
		const { name, parameters } = schema;
		const properties = parameters.properties as Record<string, ParameterProperty> | undefined;
		const actionParam = properties?.action;
		const methods = actionParam?.enum || [];

		if (methods.length > 0) {
			lines.push(`- **${name}**: ${methods.join(', ')}`);
		}
	}

	return lines.join('\n');
}

/**
 * 获取工具使用提示
 * 根据工具类型返回特定的使用规则
 */
export function getToolUsageHints(schemas: ToolSchema[]): string {
	const hints: string[] = [];

	// 检查是否有 browser 工具
	const browserSchema = schemas.find((s) => s.name === 'browser');
	if (browserSchema) {
		hints.push(`
**Browser 工具使用规则**:
1. 必须先调用 state() 获取页面元素列表
2. 使用返回的元素索引进行 click/type 操作
3. 每次操作后页面索引会重新分配，使用最新列表`);
	}

	// 检查是否有 file 工具
	const fileSchema = schemas.find((s) => s.name === 'file');
	if (fileSchema) {
		hints.push(`
**File 工具使用规则**:
- read: 读取文件内容
- write: 写入文件（覆盖）
- edit: 编辑文件（搜索替换）
- delete: 删除文件（需 confirmDelete: true）`);
	}

	return hints.join('\n');
}

export default ToolRegistry;
