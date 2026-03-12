/**
 * 简化的页面评估逻辑
 * 直接在页面中执行，提取关键元素信息
 */

/** 元素配置 */
const INTERACTIVE_SELECTORS = [
	'a', 'button', 'input', 'textarea', 'select',
	'[role="button"]', '[role="link"]', '[role="input"]', '[role="textbox"]',
	'[onclick]', '[tabindex]:not([tabindex="-1"])'
];

/** 在页面中执行的评估函数 */
export function evaluatePage() {
	const elements: Array<{
		type: string;
		tag: string;
		text: string;
		name: string;
		class?: string;
		isInteractive: boolean;
	}> = [];

	// 查找所有可交互元素
	const interactiveElements = document.querySelectorAll(INTERACTIVE_SELECTORS.join(', '));

	interactiveElements.forEach((el, index) => {
		const htmlEl = el as HTMLElement;
		
		// 跳过隐藏元素
		if (htmlEl.offsetParent === null) return;
		
		// 获取元素信息
		const tag = el.tagName.toLowerCase();
		const text = (el.textContent || '').trim().substring(0, 100);
		const className = el.className || '';
		
		// 获取元素名称
		let name = '';
		if (el instanceof HTMLAnchorElement) name = el.title || text || el.href;
		else if (el instanceof HTMLButtonElement) name = el.textContent?.trim() || el.value || el.name || 'button';
		else if (el instanceof HTMLInputElement) {
			const label = document.querySelector(`label[for="${el.id}"]`);
			name = el.placeholder || el.name || label?.textContent?.trim() || `input-${el.type}`;
		}
		else if (el instanceof HTMLTextAreaElement) {
			const label = document.querySelector(`label[for="${el.id}"]`);
			name = el.placeholder || label?.textContent?.trim() || 'textarea';
		}
		else if (el instanceof HTMLSelectElement) {
			const label = document.querySelector(`label[for="${el.id}"]`);
			name = label?.textContent?.trim() || 'select';
		}
		else name = text || el.getAttribute('aria-label') || el.getAttribute('title') || '';
		
		// 确定元素类型
		let type = 'element';
		if (tag === 'a' || el.getAttribute('role') === 'link') type = 'link';
		else if (tag === 'button' || el.getAttribute('role') === 'button') type = 'button';
		else if (tag === 'input') {
			const inputType = (el as HTMLInputElement).type;
			type = inputType === 'checkbox' ? 'checkbox' : 
			      inputType === 'radio' ? 'radio' : 
			      inputType === 'submit' ? 'button' : 'input';
		}
		else if (tag === 'textarea') type = 'textarea';
		else if (tag === 'select') type = 'select';
		
		elements.push({
			type,
			tag,
			text,
			name,
			class: className,
			isInteractive: true
		});
	});

	// 获取页面主要内容
	const mainContent = document.querySelector('main, article, .content, #content, [role="main"]');
	const content = mainContent ? 
		mainContent.textContent?.trim().substring(0, 2000) || '' : 
		document.body.textContent?.trim().substring(0, 2000) || '';

	return {
		url: window.location.href,
		title: document.title,
		elements,
		content
	};
}

/** 获取页面评估脚本的字符串形式 */
export function getPageEvaluatorScript(): string {
	// 将常量和函数一起打包，确保在页面上下文中可用
	return `
		(function() {
			const INTERACTIVE_SELECTORS = ${JSON.stringify(INTERACTIVE_SELECTORS)};
			
			${evaluatePage.toString()}
			
			return evaluatePage();
		})()
	`;
}
