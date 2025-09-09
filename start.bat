@echo off
chcp 65001 >nul

echo 🤖 Auto-Nuts - AI驱动的自动化任务执行系统
echo ==============================================

REM 检查Node.js版本
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未找到Node.js，请先安装Node.js 18.0.0或更高版本
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set node_version=%%i
echo ✅ Node.js版本: %node_version%

REM 检查是否安装了依赖
if not exist "node_modules" (
    echo 📦 正在安装依赖...
    npm install
    if %errorlevel% neq 0 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
)

REM 检查环境变量文件
if not exist ".env" (
    echo ⚠️  警告: 未找到.env文件
    echo 请复制env.example到.env并配置你的OpenAI API密钥
    echo copy env.example .env
    echo.
)

REM 启动应用
echo 🚀 启动Auto-Nuts交互式模式...
echo.

REM 启动交互式模式
node src/index.js
