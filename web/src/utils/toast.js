/**
 * Toast 通知服务
 * 全局单例，可在任何组件中使用
 */

import { ref } from 'vue';

// Toast 列表（响应式）
export const toasts = ref([]);

let toastId = 0;

/**
 * 添加 Toast
 * @param {string|object} options - 消息内容或配置对象
 * @returns {number} Toast ID
 */
export function addToast(options) {
	const id = ++toastId;
	const toast = {
		id,
		message: typeof options === 'string' ? options : options.message,
		type: options.type || 'info',
		duration: options.duration ?? 3000,
		closable: options.closable ?? true,
		action: options.action,
	};

	toasts.value.push(toast);

	// 自动移除
	if (toast.duration > 0) {
		setTimeout(() => removeToast(id), toast.duration);
	}

	return id;
}

/**
 * 移除 Toast
 * @param {number} id - Toast ID
 */
export function removeToast(id) {
	const index = toasts.value.findIndex((t) => t.id === id);
	if (index > -1) {
		toasts.value.splice(index, 1);
	}
}

/**
 * 清空所有 Toast
 */
export function clearToasts() {
	toasts.value = [];
}

// 快捷方法
export const toast = {
	/**
	 * 成功通知
	 * @param {string} message - 消息内容
	 * @param {object} options - 可选配置
	 */
	success(message, options = {}) {
		return addToast({ ...options, message, type: 'success' });
	},

	/**
	 * 错误通知
	 * @param {string} message - 消息内容
	 * @param {object} options - 可选配置
	 */
	error(message, options = {}) {
		return addToast({ ...options, message, type: 'error', duration: options.duration ?? 5000 });
	},

	/**
	 * 警告通知
	 * @param {string} message - 消息内容
	 * @param {object} options - 可选配置
	 */
	warning(message, options = {}) {
		return addToast({ ...options, message, type: 'warning', duration: options.duration ?? 4000 });
	},

	/**
	 * 信息通知
	 * @param {string} message - 消息内容
	 * @param {object} options - 可选配置
	 */
	info(message, options = {}) {
		return addToast({ ...options, message, type: 'info' });
	},

	/**
	 * 通用添加方法
	 */
	add: addToast,

	/**
	 * 移除指定 Toast
	 */
	remove: removeToast,

	/**
	 * 清空所有
	 */
	clear: clearToasts,
};

export default toast;
