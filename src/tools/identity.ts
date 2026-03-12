/**
 * 身份管理工具
 * 支持动态配置 AI 身份、性格和风格
 * 存储在 ~/.nutbot/persona.json
 */

import { BaseTool } from './registry.js';
import {
	loadCustomIdentity,
	saveCustomIdentity,
	resetCustomIdentity,
	getCurrentIdentityDescription,
	isFirstConversation,
	type CustomIdentity,
} from '../agent/prompt-loader.js';

interface IdentityParams {
	action: 'get' | 'set' | 'reset' | 'check' | 'ask';
	name?: string;
	personality?: string;
	style?: string;
}

export class IdentityTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'identity',
			description: '身份管理工具。获取、设置或重置 AI 的身份、性格和风格设定。存储在 ~/.nutbot/persona.json',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: get(获取当前身份), set(设置新身份), reset(重置为默认), check(检查是否首次对话), ask(首次对话时询问用户身份设定)',
					required: true,
					enum: ['get', 'set', 'reset', 'check', 'ask'],
				},
				name: {
					type: 'string',
					description: 'set 操作时：AI 的名称，如 "小助手"、"代码专家"',
				},
				personality: {
					type: 'string',
					description: 'set 操作时：性格描述，如 "专业严谨的程序员"、"活泼可爱的助手"',
				},
				style: {
					type: 'string',
					description: 'set 操作时：语言风格，如 "简洁直接"、"详细耐心"、"幽默风趣"',
				},
			},
			...config,
		});
	}

	async execute(params: Record<string, unknown>): Promise<unknown> {
		const action = params.action as string;

		switch (action) {
			case 'get':
				return this.handleGet();
			case 'set': {
				const setParams: IdentityParams = {
					action: 'set',
					name: params.name as string | undefined,
					personality: params.personality as string | undefined,
					style: params.style as string | undefined,
				};
				return this.handleSet(setParams);
			}
			case 'reset':
				return this.handleReset();
			case 'check':
				return this.handleCheck();
			case 'ask':
				return this.handleAsk();
			default:
				throw new Error(`Unknown action: ${action}`);
		}
	}

	/**
	 * 获取当前身份
	 */
	private handleGet(): {
		status: 'success' | 'default';
		identity: CustomIdentity | null;
		description: string | null;
	} {
		const identity = loadCustomIdentity();
		const description = getCurrentIdentityDescription();

		if (identity && identity.enabled) {
			return {
				status: 'success',
				identity,
				description,
			};
		}

		// 无自定义身份
		return {
			status: 'default',
			identity: null,
			description,
		};
	}

	/**
	 * 设置新身份
	 */
	private handleSet(params: IdentityParams): {
		status: 'success';
		message: string;
		identity: CustomIdentity;
	} {
		const { name, personality, style } = params;

		// 验证必填参数
		if (!name || !personality || !style) {
			throw new Error('Missing required parameters: name, personality, style are required for set action');
		}

		const identity: CustomIdentity = {
			name,
			personality,
			style,
			enabled: true,
		};

		saveCustomIdentity(identity);

		return {
			status: 'success',
			message: `身份已设置为: ${name}`,
			identity,
		};
	}

	/**
	 * 重置为默认身份
	 */
	private handleReset(): {
		status: 'success';
		message: string;
	} {
		resetCustomIdentity();

		return {
			status: 'success',
			message: '身份已重置为默认设置',
		};
	}

	/**
	 * 检查是否首次对话
	 */
	private handleCheck(): {
		isFirst: boolean;
		message: string;
	} {
		const isFirst = isFirstConversation();

		if (isFirst) {
			return {
				isFirst: true,
				message:
					'你好！我是 NutBot，一个智能助理。\n\n我可以帮你完成网页浏览、数据采集、文件操作等任务。\n\n💡 如果你想自定义我的性格和行为风格，告诉我你想让我成为什么样的助手吧！比如：\n   - "做一个专业严谨的代码专家"\n   - "做一个活泼可爱的助手"\n   - "用幽默风趣的方式回复"\n\n需要我做什么？',
			};
		}

		return {
			isFirst: false,
			message: '欢迎回来！',
		};
	}

	/**
	 * 首次对话时询问身份设定
	 * 由系统在首次对话时自动调用
	 */
	private handleAsk(): {
		shouldAsk: boolean;
		message: string;
		suggestedIdentities: Array<{ name: string; personality: string; style: string }>;
	} {
		const isFirst = isFirstConversation();

		if (!isFirst) {
			return {
				shouldAsk: false,
				message: '',
				suggestedIdentities: [],
			};
		}

		// 首次对话，提供身份设定建议
		const suggestedIdentities = [
			{
				name: '代码专家',
				personality: '专业严谨的程序员，擅长代码分析和开发',
				style: '简洁直接，注重技术细节',
			},
			{
				name: '小助手',
				personality: '活泼可爱的助手，乐于助人',
				style: '友好亲切，耐心细致',
			},
			{
				name: '效率达人',
				personality: '追求效率的助手，快速解决问题',
				style: '简洁高效，直击要点',
			},
		];

		return {
			shouldAsk: true,
			message:
				'你好！我是 NutBot，一个智能助理。\n\n在开始前，你想让我以什么样的身份为你服务？你可以选择以下预设，或者告诉我你的自定义设定：\n\n1. **代码专家** - 专业严谨，擅长技术细节\n2. **小助手** - 活泼可爱，耐心细致\n3. **效率达人** - 简洁高效，直击要点\n\n或者直接告诉我："叫我XX，性格是XX，风格是XX"',
			suggestedIdentities,
		};
	}
}

export default IdentityTool;
