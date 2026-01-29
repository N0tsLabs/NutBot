/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // VSCode 深色主题色板
        vscode: {
          // 背景色
          'bg-dark': '#1e1e1e',
          'bg-sidebar': '#252526',
          'bg-input': '#3c3c3c',
          'bg-hover': '#2a2d2e',
          'bg-active': '#37373d',
          'bg-selection': '#264f78',
          
          // 边框
          'border': '#3c3c3c',
          'border-active': '#007acc',
          
          // 文字
          'text': '#d4d4d4',
          'text-muted': '#808080',
          'text-light': '#cccccc',
          
          // 强调色
          'accent': '#007acc',
          'accent-hover': '#1177bb',
          'accent-light': '#0e639c',
          
          // 状态色
          'success': '#4ec9b0',
          'error': '#f14c4c',
          'warning': '#cca700',
          'info': '#3794ff',
        },
        // 保留原有的 amber 色（用于高亮）
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        }
      }
    },
  },
  plugins: [],
}
