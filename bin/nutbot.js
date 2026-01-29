#!/usr/bin/env node

/**
 * NutBot CLI 入口
 * 使用 tsx 运行 TypeScript
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 获取命令行参数
const args = process.argv.slice(2);

// 判断是否在开发模式（源码存在）
const srcPath = join(__dirname, '../src/index.ts');
const distPath = join(__dirname, '../dist/index.js');

import { existsSync } from 'fs';

if (existsSync(srcPath)) {
  // 开发模式：使用 tsx 运行 TypeScript
  const child = spawn('npx', ['tsx', srcPath, ...args], {
    stdio: 'inherit',
    shell: true,
    cwd: join(__dirname, '..')
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (existsSync(distPath)) {
  // 生产模式：直接运行编译后的 JS
  import(distPath);
} else {
  console.error('错误: 找不到入口文件。请先运行 npm run build');
  process.exit(1);
}
