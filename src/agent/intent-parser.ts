/**
 * 意图解析器 - 极简版
 * 只提供基础意图识别，不强制AI按照特定模式工作
 * 所有消息内容由 AI 自主决定，不硬编码
 */

import { logger } from '../utils/logger.js';

const log = logger.child('IntentParser');

export type IntentType = 'greeting' | 'question' | 'browse' | 'search' | 'automation' | 'unknown';

export interface UserIntent {
	type: IntentType;
	originalMessage: string;
	needsPlan: boolean;
	confidence: number;
}

export interface ExecutionPlan {
	summary: string;
	steps: Array<{
		step: number;
		action: string;
		description: string;
	}>;
	needsUserConfirmation: boolean;
}

/**
 * 极简的意图识别
 * 只做基础的分类，让AI自主决定具体操作
 */
export function parse(message: string): UserIntent {
	const lowerMsg = message.toLowerCase().trim();

	// 极简判断
	let type: IntentType = 'unknown';
	let confidence = 0.5;

	// 只有非常明确的情况才做简单分类
	if (/^(你好|hi|hello|嗨|嘿|在吗)/i.test(lowerMsg)) {
		type = 'greeting';
		confidence = 0.9;
	} else if (lowerMsg.includes('?') || lowerMsg.includes('？') || lowerMsg.startsWith('怎么') || lowerMsg.startsWith('如何') || lowerMsg.startsWith('什么')) {
		type = 'question';
		confidence = 0.7;
	}

	// 复杂任务标记
	const needsPlan = message.includes('然后') || message.includes('并且') || message.length > 50;

	log.info(`意图识别: ${type}, confidence: ${confidence}`);

	return {
		type,
		originalMessage: message,
		needsPlan,
		confidence,
	};
}

/**
 * 生成执行计划 - AI自主决定，不需要预设
 * @deprecated 让AI自己决定如何执行，不需要我们预设步骤
 */
export function generatePlan(intent: UserIntent): ExecutionPlan {
	// 返回一个空计划，让AI自己决定怎么执行
	return {
		summary: 'AI自主执行',
		steps: [],
		needsUserConfirmation: false,
	};
}

export default {
	parse,
	generatePlan,
};
