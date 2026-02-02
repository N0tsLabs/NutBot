<template>
	<Teleport to="body">
		<TransitionGroup name="toast" tag="div" class="toast-container">
			<div
				v-for="t in toasts"
				:key="t.id"
				class="toast"
				:class="[t.type, { 'has-action': t.action }]"
				@click="t.action ? t.action() : null"
			>
				<span class="toast-icon">{{ getIcon(t.type) }}</span>
				<span class="toast-message">{{ t.message }}</span>
				<button v-if="t.closable !== false" class="toast-close" @click.stop="removeToast(t.id)">×</button>
			</div>
		</TransitionGroup>
	</Teleport>
</template>

<script setup>
import { toasts, removeToast } from '../utils/toast.js';

// 获取图标
const getIcon = (type) => {
	const icons = {
		success: '✓',
		error: '✕',
		warning: '⚠',
		info: 'ℹ',
	};
	return icons[type] || icons.info;
};
</script>

<style scoped>
.toast-container {
	position: fixed;
	top: 20px;
	right: 20px;
	z-index: 9999;
	display: flex;
	flex-direction: column;
	gap: 10px;
	pointer-events: none;
}

.toast {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px;
	min-width: 280px;
	max-width: 400px;
	background-color: var(--bg-secondary);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
	pointer-events: auto;
	animation: toast-in 0.2s ease-out;
}

.toast.has-action {
	cursor: pointer;
}

.toast.has-action:hover {
	background-color: var(--bg-hover);
}

.toast-icon {
	flex-shrink: 0;
	width: 20px;
	height: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	font-weight: bold;
	border-radius: 50%;
}

.toast.success .toast-icon {
	background-color: rgba(16, 185, 129, 0.2);
	color: #10b981;
}

.toast.error .toast-icon {
	background-color: rgba(239, 68, 68, 0.2);
	color: #ef4444;
}

.toast.warning .toast-icon {
	background-color: rgba(245, 158, 11, 0.2);
	color: #f59e0b;
}

.toast.info .toast-icon {
	background-color: rgba(59, 130, 246, 0.2);
	color: #3b82f6;
}

.toast-message {
	flex: 1;
	font-size: 13px;
	color: var(--text-primary);
	line-height: 1.4;
}

.toast-close {
	flex-shrink: 0;
	width: 20px;
	height: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: none;
	border: none;
	border-radius: 4px;
	font-size: 16px;
	color: var(--text-muted);
	cursor: pointer;
	transition: all 0.15s;
}

.toast-close:hover {
	background-color: var(--bg-hover);
	color: var(--text-primary);
}

/* 动画 */
.toast-enter-active {
	animation: toast-in 0.2s ease-out;
}

.toast-leave-active {
	animation: toast-out 0.15s ease-in forwards;
}

@keyframes toast-in {
	from {
		opacity: 0;
		transform: translateX(100%);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

@keyframes toast-out {
	from {
		opacity: 1;
		transform: translateX(0);
	}
	to {
		opacity: 0;
		transform: translateX(100%);
	}
}

/* 响应式 */
@media (max-width: 480px) {
	.toast-container {
		top: auto;
		bottom: 20px;
		left: 20px;
		right: 20px;
	}

	.toast {
		min-width: auto;
		max-width: none;
	}
}
</style>
