/**
 * NutBot 类型定义
 */

// ==================== Provider 相关 ====================

export interface ProviderConfig {
	id: string;
	name?: string;
	type: 'openai' | 'anthropic';
	baseUrl?: string;
	apiKey?: string;
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
	baseUrl?: string;
	models: string[];
	defaultModel: string | null;
	enabled: boolean;
	supportsVision: boolean;
	visionModels?: string[];
	isDefault?: boolean;
}

// ==================== Chat 相关 ====================

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ContentBlock[];
	toolCalls?: ToolCall[];
	tool_calls?: ToolCall[];
	tool_call_id?: string;
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
	type: 'content' | 'finish' | 'tool_use' | 'error' | 'thinking';
	content?: string;
	fullContent?: string;
	reason?: string;
	toolCalls?: ToolCall[];
	toolUse?: ToolUse;
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
		defaultModel?: string | null;
		systemPrompt?: string | null;
		maxIterations?: number;
		timeout?: number;
		debugMode?: boolean;
		temperature?: number | null;
		maxTokens?: number | null;
	};
	sandbox: {
		mode: 'strict' | 'standard' | 'trust';
		custom?: Record<string, unknown>;
	};
	providers: Record<string, ProviderConfig>;
	data: {
		directory: string;
		sessions: string;
		logs: string;
	};
	mcp?: {
		enabled: boolean;
		servers?: McpServerConfig[];
	};
	skills: {
		enabled: boolean;
		directory: string;
		autoload?: boolean;
		includeInPrompt?: boolean;
	};
}

export interface McpServerConfig {
	name: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
}

export interface SkillDefinition {
	name: string;
	description?: string;
	prompt: string;
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
		| 'status';
	status?: string;
	iteration?: number;
	content?: string;
	count?: number;
	tool?: string;
	args?: Record<string, unknown>;
	result?: unknown;
	error?: string;
}

export interface AgentOptions {
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
	sessionId?: string;
	agentId?: string;
}

// ==================== Agent Profile 相关 ====================

export interface AgentProfile {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	systemPrompt?: string;
	maxIterations: number;
	timeout: number;
	tools?: {
		enabled?: string[];
		disabled?: string[];
	};
	createdAt: string;
	updatedAt: string;
	isBuiltin?: boolean;
}

export interface AgentExportData {
	version: number;
	agent: {
		name: string;
		description?: string;
		icon?: string;
		model?: string;
		temperature?: number;
		maxTokens?: number;
		systemPrompt?: string;
		maxIterations?: number;
		timeout?: number;
		tools?: {
			enabled?: string[];
			disabled?: string[];
		};
	};
}

export interface AgentListResponse {
	agents: AgentProfile[];
	currentId?: string;
}

// ==================== Gateway 相关 ====================

export interface Gateway {
	config: any;
	providerManager: any;
	toolRegistry: any;
	agent: any;
	sessionManager: any;
	agentProfiles: any;
	cronManager: any;
	server: any;
	start(): Promise<void>;
	stop(): Promise<void>;
	chat(message: string, options?: any): AsyncGenerator<any>;
	interrupt(reason?: string): Promise<void>;
	executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown>;
	getStatus(): Record<string, unknown>;
}
