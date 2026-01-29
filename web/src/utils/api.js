/**
 * API 请求工具
 * 直接请求后端服务，不依赖 Vite proxy
 */

// 从 store 或配置中获取后端地址
let baseUrl = 'http://127.0.0.1:18800';

/**
 * 设置 API 基础地址
 */
export function setBaseUrl(url) {
	baseUrl = url.replace(/\/$/, ''); // 移除末尾斜杠
}

/**
 * 获取当前 API 基础地址
 */
export function getBaseUrl() {
	return baseUrl;
}

/**
 * 发送 API 请求
 */
export async function request(endpoint, options = {}) {
	const url = `${baseUrl}${endpoint}`;

	const config = {
		headers: {
			'Content-Type': 'application/json',
			...options.headers,
		},
		...options,
	};

	// 如果有 body 且是对象，转为 JSON
	if (config.body && typeof config.body === 'object') {
		config.body = JSON.stringify(config.body);
	}

	const response = await fetch(url, config);

	// 尝试解析 JSON
	const contentType = response.headers.get('content-type') || '';
	let data;

	if (contentType.includes('application/json')) {
		data = await response.json();
	} else {
		data = await response.text();
	}

	if (!response.ok) {
		const message = data?.message || data?.error || `HTTP ${response.status}`;
		throw new Error(message);
	}

	return data;
}

/**
 * GET 请求
 */
export function get(endpoint, options = {}) {
	return request(endpoint, { ...options, method: 'GET' });
}

/**
 * POST 请求
 */
export function post(endpoint, body, options = {}) {
	return request(endpoint, { ...options, method: 'POST', body });
}

/**
 * PUT 请求
 */
export function put(endpoint, body, options = {}) {
	return request(endpoint, { ...options, method: 'PUT', body });
}

/**
 * DELETE 请求
 */
export function del(endpoint, options = {}) {
	return request(endpoint, { ...options, method: 'DELETE' });
}

/**
 * PATCH 请求
 */
export function patch(endpoint, body, options = {}) {
	return request(endpoint, { ...options, method: 'PATCH', body });
}

export default {
	setBaseUrl,
	getBaseUrl,
	request,
	get,
	post,
	put,
	del,
	patch,
};
