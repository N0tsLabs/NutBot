import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true, // 监听所有网络接口
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18800',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://127.0.0.1:18800',
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
