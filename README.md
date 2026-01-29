# NutBot 🤖

AI 驱动的跨平台全能自动化助手。像钢铁侠的 Jarvis 一样，能看到你的屏幕，操控你的电脑，帮你完成各种任务。

> 个人项目，持续开发中。欢迎 Star ⭐

## 功能特性

- **浏览器自动化** - 自动打开网页、填写表单、点击按钮、提取数据
- **桌面控制** - 操控本地应用（微信、QQ、记事本等），模拟键盘鼠标
- **屏幕理解** - 截图分析，理解界面内容，精确定位元素
- **命令执行** - 运行系统命令，管理文件
- **定时任务** - 设置定时任务，自动执行
- **记忆系统** - 记住你的偏好和习惯，越用越懂你
- **Web UI** - 现代化界面，支持移动端

## 快速开始

```bash
# 克隆项目
git clone https://github.com/N0tsLabs/NutBot.git
cd NutBot

# 安装依赖
yarn install

# 启动服务
yarn dev
```

打开 http://localhost:18800 即可使用。

## 配置

首次运行需要配置 AI Provider（支持 OpenAI 兼容接口）：

1. 打开设置页面
2. 添加 Provider（填入 API 地址和 Key）
3. 选择默认模型

配置文件位于 `~/.nutbot/config.json`。

## 使用示例

```
"打开B站搜索'影视飓风'，告诉我他有多少粉丝"
"帮我查一下今天的天气"
"打开QQ给张三发消息说'下午开会'"
"每天早上9点提醒我喝水"
```

## 技术架构

```
NutBot
├── 后端 (Node.js + TypeScript)
│   ├── Gateway - 统一入口
│   ├── Agent - AI 对话和决策
│   ├── Tools - 工具集（browser/computer/exec/screenshot）
│   ├── Memory - 记忆系统
│   └── Cron - 定时任务
├── 前端 (Vue 3 + Tailwind)
│   └── Web UI
└── 浏览器扩展 (Chrome Extension)
    └── CDP Relay
```

### 核心工具

| 工具 | 功能 |
|-----|-----|
| `browser` | 浏览器自动化（基于 Playwright） |
| `computer` | 桌面控制（基于 nut.js + UI Automation） |
| `screenshot` | 屏幕截图 |
| `exec` | 执行系统命令 |
| `web` | 网络请求 |

## 路线图

### 已完成 ✅
- [x] 多 Provider 支持
- [x] 浏览器自动化
- [x] 桌面控制（Windows UI Automation）
- [x] 记忆系统
- [x] 定时任务
- [x] Web UI

### 开发中 🚧
- [ ] macOS/Linux 桌面控制
- [ ] MCP 协议支持
- [ ] Skills 扩展系统
- [ ] 更多记忆能力（向量检索）

### 计划中 📋
- [ ] 语音交互
- [ ] 多模态输入
- [ ] 插件市场

## 核心依赖

| 库 / 技术 | 用途 |
|-----|-----|
| [Playwright](https://playwright.dev/) | 浏览器自动化 |
| [nut.js](https://nutjs.dev/) | 跨平台桌面自动化（鼠标、键盘） |
| [screenshot-desktop](https://github.com/bencevans/screenshot-desktop) | 跨平台屏幕截图 |
| [sharp](https://sharp.pixelplumbing.com/) | 图像处理（缩放、裁剪） |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) | 浏览器调试协议 |
| [Windows UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/) | Windows 桌面元素精确定位 |
| [macOS Accessibility API](https://developer.apple.com/documentation/accessibility) | macOS 桌面元素读取 |
| [Linux AT-SPI2](https://docs.gtk.org/atspi2/) | Linux 辅助技术接口 |

## License

MIT

---

Made with ❤️ by [N0ts](https://github.com/N0tsLabs)
