# Auto-Nuts 🤖

AI驱动的自动化任务执行系统，能够理解自然语言指令并自动操作电脑完成任务。

## 功能特性

- 🧠 **AI驱动**: 使用OpenAI GPT-4 Vision分析屏幕截图并生成操作指令
- 🖱️ **自动化操作**: 基于nut.js实现跨平台的鼠标、键盘操作
- 📸 **智能截图**: 自动截取屏幕并分析当前状态
- 🔄 **循环执行**: 智能循环执行直到任务完成
- 🌍 **跨平台支持**: 支持Windows、macOS、Linux系统
- 📝 **详细日志**: 完整的执行日志和错误处理
- ⚙️ **灵活配置**: 支持自定义配置和参数

## 安装依赖

```bash
npm install
```

## 配置

1. 复制环境变量模板：
```bash
cp env.example .env
```

2. 获取OpenAI API密钥：
   - 访问 [OpenAI API Keys](https://platform.openai.com/api-keys)
   - 登录你的OpenAI账户
   - 点击"Create new secret key"创建新的API密钥
   - 复制生成的密钥

3. 编辑 `.env` 文件，设置你的OpenAI API密钥：
```env
OPENAI_API_KEY=sk-your-actual-api-key-here
OPENAI_MODEL=gpt-4-vision-preview
```

**重要提示**：
- 请确保API密钥有效且有足够的配额
- 不要将API密钥提交到版本控制系统
- 如果遇到网络问题，请检查代理设置

## 使用方法

### 交互式模式（推荐）

```bash
# 启动交互式模式
npm start
# 或使用启动脚本
./start.sh

# 在交互式界面中：
🤖 Auto-Nuts > 打开网页去bilibili看看热搜总结给我
🤖 Auto-Nuts > help          # 查看帮助
🤖 Auto-Nuts > status        # 查看状态
🤖 Auto-Nuts > stop          # 停止当前任务
🤖 Auto-Nuts > exit          # 退出程序
```

### 特殊命令

在交互式模式中，您可以使用以下特殊命令：

- `help` - 显示帮助信息
- `status` - 显示当前任务状态
- `stop` - 停止当前正在执行的任务
- `check` - 检查系统环境和依赖
- `config` - 显示当前配置
- `cleanup` - 清理临时文件和截图
- `test-api` - 测试OpenAI API连接
- `exit` 或 `quit` - 退出程序

### 任务执行

- 直接输入自然语言任务描述即可开始执行
- 任务执行过程中可以随时输入 `stop` 停止
- 支持连续执行多个任务
- 每个任务都有详细的执行日志和结果报告

## 支持的操作类型

- **click**: 点击操作（需要坐标或目标描述）
- **type**: 输入文字
- **scroll**: 滚动操作
- **wait**: 等待指定时间
- **key**: 按键操作
- **move**: 移动鼠标

## 系统要求

### 通用要求
- Node.js 18.0.0 或更高版本
- OpenAI API密钥

### Windows
- Windows 10/11
- 建议以管理员身份运行

### macOS
- macOS 10.15 或更高版本
- 需要在系统偏好设置中授予辅助功能权限

### Linux
- X11 或 Wayland 环境
- 建议安装 xdotool 和 ImageMagick

## 项目结构

```
auto-nuts/
├── src/
│   ├── config/          # 配置管理
│   ├── modules/         # 核心模块
│   │   ├── screenshot.js    # 截图模块
│   │   ├── aiAnalyzer.js    # AI分析模块
│   │   ├── automation.js    # 自动化操作模块
│   │   └── taskEngine.js    # 任务执行引擎
│   ├── utils/           # 工具类
│   │   ├── logger.js        # 日志工具
│   │   ├── errorHandler.js  # 错误处理
│   │   └── platform.js      # 跨平台工具
│   └── index.js         # 主程序入口
├── screenshots/         # 截图存储目录
├── temp/               # 临时文件目录
└── package.json
```

## 工作原理

1. **接收任务**: 用户输入自然语言任务描述
2. **截图分析**: 截取当前屏幕并发送给AI分析
3. **生成指令**: AI分析截图并生成具体的操作指令
4. **执行操作**: 使用nut.js执行鼠标、键盘操作
5. **循环执行**: 重复步骤2-4直到任务完成
6. **生成总结**: 生成任务执行总结

## 注意事项

- 确保有稳定的网络连接以访问OpenAI API
- 某些操作可能需要管理员权限
- 建议在测试环境中先验证功能
- 注意保护个人隐私，避免在敏感信息上使用

## 故障排除

### 权限问题
- **macOS**: 在系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能中添加终端
- **Windows**: 以管理员身份运行
- **Linux**: 确保在图形环境中运行

### API问题
- 检查OpenAI API密钥是否正确
- 确认API配额是否充足
- 检查网络连接

### 截图问题
- 确保屏幕没有被其他应用遮挡
- 检查截图目录权限
- 尝试手动测试截图功能

## 开发

```bash
# 开发模式（自动重启）
npm run dev

# 运行测试
npm test
```

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request！

---

**⚠️ 免责声明**: 本工具仅供学习和研究使用，请遵守相关法律法规，不要用于非法用途。
