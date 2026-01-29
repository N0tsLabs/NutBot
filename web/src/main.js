import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';

// 路由配置
const routes = [
	{ path: '/', name: 'chat', component: () => import('./views/Chat.vue') },
	{ path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
	{ path: '/tools', name: 'tools', component: () => import('./views/Tools.vue') },
	{ path: '/cron', name: 'cron', component: () => import('./views/Cron.vue') },
	{ path: '/logs', name: 'logs', component: () => import('./views/Logs.vue') },
];

const router = createRouter({
	history: createWebHistory(),
	routes,
});

// 创建应用
const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');
