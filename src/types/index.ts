/**
 * NutBot 类型定义
 */

// ==================== Provider 相关 ====================

export interface ProviderConfig {
	id: string;
	name?: string;
	type: 'openai' | 'anthropic';
	baseUrl: string;
	apiKey: string;
	models?: string[];
	defaultModel?: string;
	enabled?: boolean;
	timeout?: number;
	headers?: Record<string, string>;
}

export interface ProviderInfo {
	id: string;
	name: string;
	type: string;
	baseUrl: string;
	models: string[];
	defaultModel: string | null;
	enabled: boolean;
	supportsVision: boolean; // Provider 级别（已弃用，用 visionModels）
	visionModels?: string[]; // 支持 Vision 的模型列表
	isDefault?: boolean;
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ContentBlock[];
	toolCalls?: ToolCall[]; // 内部使用 (camelCase)
	tool_calls?: ToolCall[]; // OpenAI API 格式 (snake_case)
	tool_call_id?: string; // tool 消息必须有此字段
	metadata?: Record<string, unknown>;
}

export interface ContentBlock {
	type: 'text' | 'image_url' | 'image';
	text?: string;
	image_url?: { url: string; detail?: string };
	source?: { type: string; media_type: string; data: string };
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	tools?: ToolSchema[];
	toolChoice?: string | object;
	system?: string;
}

export interface ChatChunk {
	type: 'content' | 'finish' | 'tool_use' | 'complete';
	content?: string;
	fullContent?: string;
	reason?: string;
	toolCalls?: ToolCall[];
	toolUse?: ToolUse;
	usage?: { input_tokens: number; output_tokens: number };
}

export interface ToolUse {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

// ==================== Tool 相关 ====================

export interface ToolSchema {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export interface ToolExecuteResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

// ==================== Session 相关 ====================

export interface Session {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: ChatMessage[];
	metadata?: Record<string, unknown>;
}

// ==================== Cron 相关 ====================

export interface CronJob {
	id: string;
	schedule: string;
	task: string;
	enabled: boolean;
	lastRun?: string;
	nextRun?: string;
}

// ==================== Config 相关 ====================

export interface AppConfig {
	server: {
		host: string;
		port: number;
	};
	agent: {
		defaultModel?: string; // 默认模型 (provider/model 格式)
		systemPrompt?: string;
		maxIterations?: number;
	};
	sandbox: {
		mode: 'off' | 'permissive' | 'strict';
	};
	providers: Record<string, ProviderConfig>;
	data: {
		directory: string;
		sessions: string;
		logs: string;
	};
	skills: {
		directory: string;
	};
}

// ==================== API 相关 ====================

export interface ApiResponse<T = unknown> {
	success?: boolean;
	error?: boolean;
	message?: string;
	data?: T;
}

// ==================== Agent 相关 ====================

export interface AgentChunk {
	type:
		| 'thinking'
		| 'content'
		| 'done'
		| 'tools'
		| 'tool_start'
		| 'tool_result'
		| 'tool_error'
		| 'max_iterations'
		| 'terminated'
		| 'error'
		| 'debug_confirm'; // 调试模式：等待用户确认
	iteration?: number;
	content?: string;
	count?: number;
	tool?: string;
	args?: Record<string, unknown>;
	result?: unknown;
	error?: string;
	iterations?: number;
	reason?: string; // 终止原因
	thinking?: string; // AI 思考内容
	// 调试模式数据
	debug?: DebugData;
	confirmId?: string; // 确认 ID，用于关联响应
}

export interface DebugData {
	originalImage?: string; // 原始截图 base64
	markedImage?: string; // OCR-SoM 标注图 base64
	clickImage?: string; // 点击位置预览图 base64
	elements?: DebugElement[]; // OCR-SoM 识别的元素列表
	action?: string; // AI 计划执行的操作
	coordinate?: [number, number]; // 点击坐标
	thinking?: string; // AI 思考内容
}

export interface DebugElement {
	id: number;
	type: 'text' | 'ui';
	text: string;
	box: [number, number, number, number];
}

export interface AgentOptions {
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
	sessionId?: string;
}
