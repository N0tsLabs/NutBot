# NutBot 浏览器扩展

让 NutBot 控制您的浏览器标签页，保留登录状态。

## 功能

- 通过 Chrome DevTools Protocol (CDP) 控制用户的浏览器
- 保留所有网站的登录状态
- 无需关闭已打开的浏览器
- 用户手动点击启用，完全可控

## 安装

### 1. 构建扩展

```bash
cd browser-extension
npm install
npm run build
```

### 2. 加载扩展

1. 打开 Chrome/Edge，访问 `chrome://extensions`（或 `edge://extensions`）
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `browser-extension` 目录

### 3. 创建图标

在 `icons/` 目录下需要以下图标文件：

- `icon-gray-16.png` - 灰色图标 16x16（未连接状态）
- `icon-gray-32.png` - 灰色图标 32x32
- `icon-gray-48.png` - 灰色图标 48x48
- `icon-gray-128.png` - 灰色图标 128x128
- `icon-green-16.png` - 绿色图标 16x16（已连接状态）
- `icon-green-32.png` - 绿色图标 32x32
- `icon-green-48.png` - 绿色图标 48x48
- `icon-green-128.png` - 绿色图标 128x128

## 使用

1. 确保 NutBot Gateway 已启动（CDP Relay 服务会自动启动在端口 18801）
2. 在要控制的标签页上点击扩展图标
3. 图标变为绿色并显示 "ON" 表示已连接
4. NutBot 现在可以控制该标签页

## 工作原理

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户的浏览器                             │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │  NutBot 扩展      │  使用 chrome.debugger API                │
│  │                  │  附加到用户选定的标签页                    │
│  └────────┬─────────┘                                          │
│           │ WebSocket                                           │
└───────────┼─────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│                    NutBot CDP Relay                            │
│                    (端口 18801)                                │
│                                                               │
│  /extension  ←──→  转发 CDP 命令/事件  ←──→  /cdp             │
│  (扩展连接)                                    (Playwright)    │
└───────────────────────────────────────────────────────────────┘
            ▲
            │ Playwright connectOverCDP
            │
┌───────────┴───────────┐
│      NutBot Agent     │
│      browser tool     │
└───────────────────────┘
```

## 配置

在 NutBot 配置中可以设置：

```json
{
  "browser": {
    "mode": "extension",
    "cdpRelayPort": 18801
  }
}
```

### 浏览器模式

- `extension` - 通过扩展连接用户的浏览器（默认，保留登录状态）
- `managed` - 启动独立的浏览器实例
- `cdp` - 连接到已运行的调试端口

## 安全说明

- 扩展使用 Chrome Debugger API，只能控制用户明确启用的标签页
- CDP Relay 服务只监听 localhost (127.0.0.1)
- 所有通信都在本地进行，不会暴露到网络

## 故障排除

### 扩展图标显示 "!" 或连接失败

1. 检查 NutBot Gateway 是否已启动
2. 检查端口 18801 是否被占用
3. 查看浏览器扩展的后台页面日志（右键扩展图标 → 审查弹出内容）

### 无法控制某些页面

以下页面不能被控制：
- `chrome://` 页面
- `chrome-extension://` 页面
- `edge://` 页面
- Chrome Web Store 页面
