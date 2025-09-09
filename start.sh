#!/bin/bash

# Auto-Nuts 启动脚本

echo "🤖 Auto-Nuts - AI驱动的自动化任务执行系统"
echo "=============================================="

# 检查Node.js版本
node_version=$(node -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ 错误: 未找到Node.js，请先安装Node.js 18.0.0或更高版本"
    exit 1
fi

echo "✅ Node.js版本: $node_version"

# 检查是否安装了依赖
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 检查环境变量文件
if [ ! -f ".env" ]; then
    echo "⚠️  警告: 未找到.env文件"
    echo "请复制env.example到.env并配置你的OpenAI API密钥"
    echo "cp env.example .env"
    echo ""
fi

# 启动应用
echo "🚀 启动Auto-Nuts交互式模式..."
echo ""

# 启动交互式模式
node src/index.js

