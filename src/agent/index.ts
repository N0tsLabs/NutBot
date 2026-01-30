/**
 * Agent 核心
 * 执行 AI 对话和工具调用
 */

import { logger } from '../utils/logger.js';
import { generateId, safeParseJSON, getLocationByIP, type UserLocation } from '../utils/helpers.js';
import { getSystemDescription } from '../tools/exec.js';
import { memoryManager } from '../memory/index.js';
import type { Gateway } from '../gateway/index.js';
import type { AgentChunk, ChatChunk, ToolCall, ToolUse, ContentBlock, DebugData, DebugElement } from '../types/index.js';
import { SessionManager } from './session.js';
import { waitForConfirmation } from '../server/index.js';
import { ocrSomService } from '../services/ocr-som.js';
import { drawClickPosition, saveDebugImages, cleanupOldDebugImages, type DebugInfo } from '../services/debug-visualizer.js';
import { securityGuard } from '../services/security-guard.js';

interface AgentRunOptions {
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
	debugMode?: boolean;
}

// 缓存最近的截图和 OCR 结果（调试模式用）
interface DebugCache {
	lastScreenshot?: string; // 最近的截图 base64
	lastMarkedImage?: string; // 最近的 OCR-SoM 标注图 base64
	lastElements?: DebugElement[]; // 最近的 OCR-SoM 元素列表
	lastScreenInfo?: {  // 屏幕信息
		imageSize?: string;
		mouseCoordSize?: string;
		scale?: number;
	};
	stepCount: number; // 调试步骤计数器
}

// 需要 Vision 能力的工具
const VISION_REQUIRED_TOOLS = ['screenshot', 'computer'];

interface StoredSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: unknown[];
	metadata?: Record<string, unknown>;
}

/**
 * Agent 类
 */
export class Agent {
	private gateway: Gateway;
	private logger = logger.child('Agent');
	private defaultSystemPrompt: string;

	constructor(gateway: Gateway) {
		this.gateway = gateway;
		this.defaultSystemPrompt = ''; // 动态生成
	}

	/**
	 * 生成系统提示（根据 Vision 能力和用户信息动态调整）
	 */
	private generateSystemPrompt(
		hasVision: boolean,
		userInfo?: { name?: string; location?: UserLocation; customPrompt?: string; language?: string }
	): string {
		// 用户信息部分
		const userInfoSection = userInfo
			? `
## 用户信息
${userInfo.name ? `- 用户名称：${userInfo.name}` : ''}
${userInfo.location ? `- 用户位置：${userInfo.location.city}${userInfo.location.region ? `，${userInfo.location.region}` : ''}${userInfo.location.country ? `，${userInfo.location.country}` : ''}` : ''}
${userInfo.location?.timezone ? `- 时区：${userInfo.location.timezone}` : ''}
${userInfo.language ? `- 偏好语言：${userInfo.language}` : ''}

**提示**：当用户询问天气、本地新闻、附近服务等与位置相关的信息时，可以直接使用上述位置，无需再次询问。
`
			: '';

		// 用户记忆部分
		const memorySummary = memoryManager.getSummary();

		// 用户自定义 prompt
		const customPromptSection = userInfo?.customPrompt
			? `
## 用户自定义指令
${userInfo.customPrompt}
`
			: '';

		// 获取沙盒安全说明
		const sandboxPrompt = securityGuard.getSandboxPrompt();

		const basePrompt = `你是 NutBot，用户的私人 AI 助理。你运行在用户的电脑上，能看到屏幕，能操控电脑。

## 🎯 说话风格

你是用户的朋友和助手，说话要自然、真实，像真人一样交流。

### ❌ 绝对不要这样说（太机械）
- "**洞察**：xxx"、"**观察**：xxx" - 太像报告
- "我还能帮你做什么？"、"还有什么需要帮忙的吗？" - 太客服
- "以下是xxx的列表："、"结果如下：" - 太机械
- 用大量 emoji 装饰
- 每次都问"要不要我继续xxx"

### ✅ 应该这样说（自然真实）
- 直接说结果，像朋友告诉你一样
- 有想法就顺嘴提一句，别搞成"建议1、建议2"
- 如果发现有意思的事情，自然地聊几句
- 简洁点，别啰嗦

### 示例对比
❌ 机械版：
> **查询结果**：影视飓风粉丝数 1495.4万，视频数 937。
> **洞察**：这是B站头部UP主。
> **我还能帮你做什么？** 比如查看最近视频、对比其他UP主数据。

✅ 自然版：
> 影视飓风现在 1495 万粉丝，发了 937 个视频，B站科技区顶流了。要看看他最近发了啥不？

${userInfoSection}${memorySummary ? `\n${memorySummary}\n` : ''}${customPromptSection}
${sandboxPrompt}

${getSystemDescription()}

## 核心原则（绝对必须遵守）

### 0. ⭐⭐⭐ 工具选择（最重要！）

**浏览器操作 = browser 工具，桌面操作 = screenshot + computer**

| 关键词 | 使用工具 |
|-------|---------|
| 网页、网站、浏览器、链接、URL、搜索xxx | **browser** |
| 本地应用、软件、桌面、文件夹、记事本、微信、Excel | **screenshot + computer** |

**绝对禁止**：用 screenshot + computer 操作浏览器窗口！浏览器只能用 browser 工具！

### 1. 你必须自己完成任务，绝对不能推给用户
- ❌ 错误："需要你点击左侧的xxx"、"请你手动操作"
- ✅ 正确：自己使用工具完成操作

### 2. 先观察再行动
- **浏览器**：browser snapshot 获取页面元素
- **桌面**：computer list_elements 获取屏幕元素（精确坐标！）或 screenshot 截图

### 3. 持续循环直到任务完成（极其重要！）
- **绝对禁止**中途停下来问用户"要不要继续"、"需要我继续吗"
- 每次操作后立即检查：任务完成了吗？没完成就继续下一步！
- 例如：用户说"给xxx发消息"，你必须完成"打开聊天→输入内容→发送"的完整流程
- 只有**亲眼看到任务成功**（如消息已发送、文件已保存）才能向用户报告"完成"
- 如果界面发生变化，重新截图获取最新状态，然后继续操作

### 4. 尊重用户意图
- **浏览器**：完成任务后**不要自动关闭**！让用户决定是否关闭
- 只有用户明确说"关闭浏览器"时才执行 browser close
- 桌面应用同理，除非用户要求，否则保持打开状态

## 可用工具

### exec - 执行系统命令
- Windows: PowerShell | macOS/Linux: bash
- 打开应用最可靠的方式是用 computer 工具通过开始菜单搜索`;

		// Vision 模式：支持截图分析和桌面控制
		const visionTools = `

### screenshot - 屏幕截图（核心工具！）
- 仅用于**桌面应用**（记事本、微信、Excel 等）
- 网页任务禁止使用，用 browser snapshot
- ⭐ **截图自带 OCR-SoM 元素识别**，返回所有可点击元素的坐标
- 截图后直接使用返回的元素列表坐标，**不要再调用 list_elements**！

### computer - 桌面控制
- 仅用于**桌面应用**（记事本、微信、Excel 等）
- 网页任务禁止使用，用 browser 工具

#### ⭐ 定位元素的两种方式（不要混用！）
**方式A：click_element（适合任务栏/系统控件）**
- 用 list_elements 获取系统控件列表
- 用 click_element 按名称点击

**方式B：screenshot + 坐标点击（适合应用内部元素）⭐推荐！**
- screenshot 截图 → 自动返回 OCR-SoM 元素列表
- 从元素列表选择目标的 center 坐标
- left_click coordinate:[x,y] 点击

⚠️ **不要混用！** 截图后不要再 list_elements，直接用截图返回的坐标

#### 坐标点击
- left_click: 左键点击坐标 [x, y]
- right_click: 右键点击
- double_click: 双击

#### 其他操作
- type: 输入文本（支持中文）
- key: 按键（Enter, Tab, Escape, Up, Down 等）
- hotkey: 快捷键 ["ctrl", "c"]、["win"]
- scroll: 滚动 (up/down)
- mouse_move: 移动鼠标
- **delay 参数**：操作后等待毫秒数`;

		// 非 Vision 模式：智能判断是否需要视觉
		const nonVisionNotice = `

## ⚠️ 当前模型不支持视觉（重要！）

你当前使用的模型**不支持图像理解**，这意味着你无法"看到"截图内容。

### ✅ 可以执行的操作（不需要视觉）
| 类型 | 示例任务 | 使用工具 |
|------|---------|---------|
| 命令执行 | 查看文件夹内容、整理文件、创建目录 | exec |
| 系统设置 | 改主题色、调音量、改壁纸 | exec (PowerShell) |
| 网页操作 | 打开网页、搜索、点击按钮 | browser (有 snapshot) |
| 网页获取 | 获取网页文本内容 | web fetch |
| 信息查询 | 查天气、搜资料、回答问题 | web / 直接回答 |
| 文件处理 | 读写 Excel/CSV/JSON/文本文件 | exec (Python/Node 脚本) |
| 数据处理 | 分析数据、生成图表、格式转换 | exec (编写脚本执行) |

**💡 编程能力**：你可以自己编写并执行代码！遇到文件处理、数据操作等任务时，优先考虑用代码解决：
- Python: pandas, openpyxl, json, csv 等
- Node.js: xlsx, fs, csv-parser 等
- 如果缺少依赖，可以先用 pip/npm 安装

### ❌ 无法执行的操作（需要视觉）
| 类型 | 示例任务 | 原因 |
|------|---------|------|
| GUI 软件操作 | 在微信/QQ/钉钉发消息、操作 Photoshop | 需要看截图定位界面元素，且无公开 API |
| 界面交互 | 点击屏幕上的某个按钮/图标 | 需要看截图才能知道点哪 |
| 屏幕分析 | 看看屏幕上有什么、识别图片内容 | 需要图像理解能力 |

**判断标准**：问自己"这个任务能用命令行/代码完成吗？"
- 能 → 不需要视觉，正常执行
- 不能（必须看屏幕点击界面）→ 需要视觉

### 🎯 你的判断流程
收到任务后，先判断：

1. **这个任务需要"看"屏幕吗？**
   - 需要知道"屏幕上有什么" → 需要视觉
   - 需要"点击界面上的某个东西" → 需要视觉
   - 可以用命令/API 完成 → 不需要视觉

2. **如果需要视觉，直接告知用户：**
   > "这个任务需要操作桌面应用界面，但当前模型不支持图像理解。建议：
   > 1. 切换到支持视觉的模型（如 GPT-4o、Claude 3.5）
   > 2. 或者告诉我具体的命令行操作方式"

3. **如果不需要视觉，正常执行！**

### 示例判断

| 用户请求 | 判断 | 处理 |
|---------|------|------|
| "桌面有什么文件" | 不需要视觉 | exec: dir/ls 命令 |
| "帮我把桌面整理一下" | 不需要视觉 | exec: 移动文件命令 |
| "电脑改成深色主题" | 不需要视觉 | exec: PowerShell 设置 |
| "打开百度搜索xxx" | 不需要视觉 | browser 工具 |
| "读取这个 Excel 文件" | 不需要视觉 | exec: Python pandas 读取 |
| "把 data.csv 转成 Excel" | 不需要视觉 | exec: 写脚本转换 |
| "帮我在微信上给xxx发消息" | **需要视觉** | 告知用户无法执行 |
| "点击屏幕右下角的图标" | **需要视觉** | 告知用户无法执行 |
| "看看我屏幕上是什么" | **需要视觉** | 告知用户无法执行 |`;

		const browserTool = `

### 网页操作 - 根据任务选择工具

#### 方式1：用默认浏览器打开（保留登录状态）⭐ 简单打开推荐
如果只是想在用户的浏览器中打开网页（保留登录状态、书签等），使用 exec 工具：
\`\`\`
exec command: 'Start-Process "https://example.com"'  # Windows
exec command: 'open "https://example.com"'          # macOS  
exec command: 'xdg-open "https://example.com"'      # Linux
\`\`\`
优点：使用用户常用浏览器，保留登录状态
缺点：只能打开，不能自动操作

#### 方式2：browser 工具（自动化操作）
如果需要自动点击、输入、提取数据，使用 browser 工具。

**⚠️ 智能操作原则（不要写死流程！）**
- goto 会自动连接浏览器，**不需要先调用 open**
- **不要自动 close！** 只有用户明确要求"关闭浏览器"时才调用 close
- 根据用户需求灵活选择操作，不要机械执行固定步骤

**操作示例：**
\`\`\`
用户："帮我搜索xxx"
→ browser goto url:"搜索引擎" → snapshot → click + type → press Enter

用户："关闭浏览器"  
→ browser close（这时候才 close！）
\`\`\`

**搜索操作示例：**
1. \`browser goto url:"目标网址"\` - 直接访问（自动连接浏览器）
2. \`browser snapshot\` - 获取页面元素列表
3. 找到搜索框 ref：\`browser click ref:xxx\` 聚焦
4. 输入：\`browser type text:"关键词"\`
5. 提交：\`browser press key:"Enter"\`
6. 等待：\`browser wait waitFor:"network"\`
7. 再次 snapshot 查看结果
**完成后不要自动 close，让用户决定是否关闭！**

#### 选择建议：
- **"帮我打开xxx网站"** → exec + Start-Process（用户自己浏览）
- **"帮我搜索/点击/操作"** → browser 工具（自动化操作）
- **"获取网页内容"** → web fetch（获取文本即可）

### web - 轻量网页获取
- fetch: 获取网页文本内容（不需要交互时用）`;

		const taskModes = `

## 任务类型判断（最重要！）

### ⭐ 判断规则：
| 用户意图 | 选择方式 |
|----------|----------|
| 只是打开网页让用户自己看 | exec + Start-Process |
| 需要自动搜索/点击/填表/提取数据 | browser 工具 |
| 只需要获取网页文本内容 | web fetch |
| 操作本地桌面应用程序 | screenshot + computer |

### 方式1：简单打开网页（用户自己看）
\`\`\`
exec command: 'Start-Process "网址"'   # Windows
exec command: 'open "网址"'            # macOS
\`\`\`
→ 在用户的默认浏览器打开，保留登录状态

### 方式2：自动化操作网页（browser 工具）
\`\`\`
browser goto url:"目标网址"            # 1. 导航到网页（自动连接浏览器）
browser snapshot                      # 2. 获取元素列表（关键！）
# snapshot 返回示例：[{ref:1, tag:"input", text:"搜索"}, {ref:2, tag:"button", text:"登录"}, ...]
browser click ref:搜索框的ref          # 3. 点击搜索框聚焦
browser type text:"搜索内容"           # 4. 输入文字
browser press key:"Enter"             # 5. 按回车提交
browser wait waitFor:"network"        # 6. 等待页面加载
browser snapshot                      # 7. 再次获取元素，查看结果
# ⚠️ 完成后不要自动 close！让用户决定
\`\`\`
**snapshot 是核心！** 通过它获取页面元素的 ref，才能精确操作。

### 桌面任务流程（优先使用 list_elements + click_element！）
**⚠️ 仅用于本地桌面应用（如：记事本、Excel、微信），网页任务必须用 browser！**

#### ⭐ 推荐流程（精确定位）
\`\`\`
1. computer list_elements filter_type:"taskbar" → 获取任务栏元素列表
2. 从列表中找到目标应用
3. computer click_element element_name:"应用名" → 直接点击
4. 如需验证：screenshot 截图查看结果
\`\`\`

#### 备选流程（只在 list_elements 找不到时使用）
\`\`\`
1. screenshot 截图 → 了解当前屏幕
2. 分析屏幕，决定操作
3. computer left_click coordinate:[x,y] → 点击坐标
4. screenshot 截图 → 验证结果
\`\`\`

### 打开本地应用程序（非浏览器）

**⭐ 优先用 list_elements 检查任务栏！**

\`\`\`
1. computer list_elements filter_type:"taskbar" → 检查任务栏有没有目标应用
2. 找到了 → computer click_element element_name:"应用名"
3. 找不到 → computer hotkey keys:["win"] delay:800 打开开始菜单
4. computer type text:"应用名" → 搜索
5. computer key key:"Enter" → 打开
\`\`\`

**优势：list_elements 返回精确坐标，不会点错位置！**

## 重要提醒

1. **⭐ 网页任务必须用 browser 工具**，即使用户说"打开浏览器"，也用 browser open！
2. **不要告诉用户去做什么，自己做！** 
3. **⭐⭐ 任务未完成禁止停止！** 每一步操作后问自己："用户要的结果达成了吗？"没达成就继续执行下一步！
4. 任务完成后给用户清晰的结果汇总`;

		const desktopMode = hasVision
			? `

## 桌面操作技巧（仅用于本地应用，网页任务请用 browser！）

### ⭐ 精确定位（优先使用！）
1. **list_elements** - 获取屏幕元素的精确坐标
2. **click_element** - 根据名称直接点击（自动匹配最佳元素）

### 坐标点击（备选方案）
- 只有 list_elements 找不到目标元素时才用截图+坐标
- 直接使用截图中的像素坐标，工具会自动处理缩放

### 定位技巧
- 任务栏元素 → 用 filter_type:"taskbar" 过滤
- 操作后加 delay 等待界面响应`
			: '';

		const footer = `

## 回复格式

### ⭐ 合并连续操作（提高效率！）
**可以一次返回多个工具调用！** 只要操作之间不需要等待界面更新，就应该合并：

✅ **应该合并的操作**（一次返回多个工具）：
- 点击输入框 + 输入文字 → 一起执行
- 输入文字 + 按回车 → 一起执行
- 点击按钮 + 等待 + 再点击 → 可以合并（用 delay 参数控制间隔）

❌ **不能合并的操作**（需要先看结果）：
- 截图 → 必须等结果才能决定下一步
- 搜索 → 需要看搜索结果再操作
- 点击后界面会大变化 → 需要重新截图

**示例**：搜索联系人
\`\`\`
错误做法（效率低）：         正确做法（高效）：
1. 点击搜索框              1. 点击搜索框 + 输入文字 + 回车（一次返回3个工具）
2. 等待...                 2. 截图看结果
3. 输入文字
4. 等待...
5. 按回车
\`\`\`

### ⭐ 每次调用工具前必须先说明思考
用一句话说明你的意图，让用户能看到思考过程。

### 最终回复（重要！）

完成任务后，你的回复必须包含三个部分：

**1. 结果总结**（必须）
- 用自然、亲切的语言告诉用户结果
- 重点数据可以**加粗**突出
- 不要只是干巴巴地列数据，要有点"人味"

**2. 洞察分析**（如果有意义）
- 基于结果给出你的观察、判断或解读
- 比如：数据意味着什么？有什么值得注意的？

**3. 主动建议**（必须）
- 想想用户接下来可能还想做什么
- 主动提出 1-2 个相关的后续操作建议
- 用疑问句引导，如"需要我帮你...吗？"

当前时间：${new Date().toLocaleString()}
${hasVision ? '🟢 Vision 模式已启用，支持截图分析和桌面操作' : '🔴 Vision 模式未启用 - 桌面应用操作受限，请根据上述判断规则决定是否执行任务'}`;

		return (
			basePrompt + (hasVision ? visionTools : nonVisionNotice) + browserTool + taskModes + desktopMode + footer
		);
	}

	/**
	 * 初始化
	 */
	async init(): Promise<void> {
		this.logger.debug('Agent 初始化完成');
	}

	/**
	 * 运行 Agent
	 */
	async *run(message: string, session: StoredSession, options: AgentRunOptions = {}): AsyncGenerator<AgentChunk> {
		const runId = generateId('run');
		const startTime = Date.now();

		this.logger.info(`开始 Agent 运行: ${runId}`);
		this.logger.info(`用户消息: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

		try {
			// 添加用户消息
			this.gateway.sessionManager.addMessage(session.id, {
				role: 'user',
				content: message,
			});

			// 获取模型和 Provider
			const modelRef = options.model || this.gateway.config.get<string>('agent.defaultModel');
			this.logger.info(`使用模型: ${modelRef || '默认'}`);

			// 检查 Vision 支持
			const hasVision = this.gateway.providerManager.checkVisionSupport(modelRef);
			this.logger.info(`Vision 支持: ${hasVision ? '✅ 是' : '❌ 否'}`);

			// 获取用户信息（配置 + IP 定位）
			const userName = this.gateway.config.get<string>('user.name');
			const customPrompt = this.gateway.config.get<string>('user.customPrompt');
			const language = this.gateway.config.get<string>('user.language');
			let userLocation = this.gateway.config.get<UserLocation>('user.location');

			// 如果配置中没有位置，尝试 IP 定位
			if (!userLocation) {
				try {
					userLocation = (await getLocationByIP()) || undefined;
					if (userLocation) {
						this.logger.info(`IP 定位成功: ${userLocation.city}, ${userLocation.region || ''}`);
					}
				} catch (e) {
					this.logger.debug('IP 定位失败，继续执行');
				}
			}

			const userInfo = {
				name: userName || undefined,
				location: userLocation || undefined,
				customPrompt: customPrompt || undefined,
				language: language || undefined,
			};

			// 获取系统提示（根据 Vision 能力和用户信息动态生成）
			const systemPrompt =
				options.systemPrompt ||
				this.gateway.config.get<string>('agent.systemPrompt') ||
				this.generateSystemPrompt(hasVision, userInfo);

			// 获取工具（如果不支持 Vision，过滤掉需要 Vision 的工具）
			let tools = this.gateway.toolRegistry.getToolSchemas();
			if (!hasVision) {
				tools = tools.filter((t) => !VISION_REQUIRED_TOOLS.includes(t.name));
			}
			this.logger.info(`可用工具: ${tools.map((t) => t.name).join(', ') || '无'}`);

			// 最大迭代次数（用于工具调用循环）
			const maxIterations = options.maxIterations || this.gateway.config.get<number>('agent.maxIterations', 20);

			// 调试模式设置（移到循环外，保持状态跨迭代）
			const debugMode = options.debugMode ?? this.gateway.config.get<boolean>('agent.debugMode', false);
			const debugCache: DebugCache = { stepCount: 0 };
			if (debugMode) {
				this.logger.info('🔍 调试模式已启用');
				// 清理旧的调试图片，保留最近 50 个
				cleanupOldDebugImages(50);
			}

			let iteration = 0;

			while (iteration < maxIterations) {
				iteration++;
				this.logger.info(`─────────── 迭代 ${iteration}/${maxIterations} ───────────`);

				// 获取消息历史
				const messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt,
					maxMessages: 30,
				});

				// 调用 AI
				let fullContent = '';
				let toolCalls: Array<ToolCall | ToolUse> = [];
				let finishReason: string | null = null;

				yield { type: 'thinking', iteration };

				// 添加超时检测，定期发送状态
				let lastChunkTime = Date.now();
				let responseStarted = false;
				const timeoutCheckInterval = setInterval(() => {
					const waitTime = Math.round((Date.now() - lastChunkTime) / 1000);
					if (!responseStarted && waitTime > 10) {
						this.logger.info(`等待 AI 响应中... (${waitTime}s)`);
					}
				}, 10000); // 每 10 秒检查一次

				try {
					for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, {
						tools: tools.length > 0 ? tools : undefined,
					})) {
						lastChunkTime = Date.now();
						responseStarted = true;

						if (chunk.type === 'content') {
							fullContent = chunk.fullContent || fullContent + (chunk.content || '');
							yield { type: 'content', content: chunk.content };
						} else if (chunk.type === 'finish') {
							finishReason = chunk.reason || null;
							toolCalls = (chunk.toolCalls || []) as ToolCall[];
						} else if (chunk.type === 'tool_use' && chunk.toolUse) {
							toolCalls.push(chunk.toolUse);
						}
					}
				} finally {
					clearInterval(timeoutCheckInterval);
				}

				// 保存 AI 响应
				if (fullContent || toolCalls.length > 0) {
					this.gateway.sessionManager.addMessage(session.id, {
						role: 'assistant',
						content: fullContent,
						toolCalls: toolCalls.length > 0 ? this.normalizeToolCalls(toolCalls) : undefined,
					});
				}

				// 检查是否需要执行工具
				if (toolCalls.length === 0 || finishReason === 'stop') {
					// 没有工具调用，结束
					this.logger.info(`AI 响应完成，无工具调用`);
					if (fullContent) {
						this.logger.debug(
							`AI 回复: ${fullContent.substring(0, 200)}${fullContent.length > 200 ? '...' : ''}`
						);
					}
					yield { type: 'done', content: fullContent };
					break;
				}

				// 执行工具调用
				this.logger.info(`AI 请求执行 ${toolCalls.length} 个工具`);
				yield { type: 'tools', count: toolCalls.length, thinking: fullContent };

				// AI 的思考内容（工具调用前的文字）
				const thinking = fullContent || '';
				if (thinking) {
					this.logger.info(`AI 思考: ${thinking.substring(0, 100)}${thinking.length > 100 ? '...' : ''}`);
				}

				for (const toolCall of toolCalls) {
					const toolName = this.getToolName(toolCall);
					const toolArgs = this.parseToolArgs(toolCall);
					const toolId = this.getToolId(toolCall);

					this.logger.info(`┌─ 执行工具: ${toolName}`);
					this.logger.info(`│  参数: ${JSON.stringify(toolArgs).substring(0, 200)}`);
					// 附带 AI 的思考内容
					yield { type: 'tool_start', tool: toolName, args: toolArgs, thinking };

					// 调试模式：如果是点击操作，先生成预览图并等待确认
					if (debugMode && toolName === 'computer') {
						const action = toolArgs.action as string;
						const coordinate = toolArgs.coordinate as [number, number] | undefined;
						const elementName = toolArgs.element_name as string | undefined;
						
						// 需要调试的操作类型
						const isClickAction = ['left_click', 'right_click', 'double_click'].includes(action);
						const isClickElement = action === 'click_element' && elementName;
						const isTypeAction = action === 'type' && toolArgs.text;
						const isKeyAction = action === 'key' || action === 'hotkey';
						
						// 任何可能影响状态的操作都需要确认
						const needsConfirmation = isClickAction || isClickElement || isTypeAction || isKeyAction;

						if (needsConfirmation) {
							this.logger.info(`│  [调试模式] ${action} 操作，等待确认...`);

							// 生成调试数据
							const debugData: DebugData = {
								thinking,
							};
							
							// 构建操作描述
							if (isClickAction && coordinate) {
								debugData.action = `${action} at (${coordinate[0]}, ${coordinate[1]})`;
								debugData.coordinate = coordinate;
							} else if (isClickElement) {
								debugData.action = `click_element: "${elementName}"`;
							} else if (isTypeAction) {
								debugData.action = `type: "${(toolArgs.text as string).substring(0, 50)}"`;
							} else if (action === 'key') {
								debugData.action = `key: ${toolArgs.key}`;
							} else if (action === 'hotkey') {
								debugData.action = `hotkey: ${(toolArgs.keys as string[])?.join('+')}`;
							}

							// 如果有缓存的截图，使用它
							if (debugCache.lastScreenshot) {
								debugData.originalImage = debugCache.lastScreenshot;
								debugData.markedImage = debugCache.lastMarkedImage;
								debugData.elements = debugCache.lastElements;

								// 如果有坐标，生成点击位置预览图
								if (coordinate) {
									try {
										debugData.clickImage = await drawClickPosition(
											debugCache.lastScreenshot,
											coordinate,
											`点击 (${coordinate[0]}, ${coordinate[1]})`
										);
									} catch (e) {
										this.logger.warn('生成点击预览图失败:', (e as Error).message);
									}
								}
								
								// 保存调试图片和详细信息到文件夹
								debugCache.stepCount++;
								try {
									// 构建详细调试信息
									// 注意：debugCache.lastElements 是 screenshot 工具返回的格式，包含 center 和 mouseCenter
									const fullDebugInfo: DebugInfo = {
										action: debugData.action,
										thinking,
										toolName,
										toolArgs: toolArgs as Record<string, unknown>,
										coordinate,
										elements: debugCache.lastElements?.map(el => {
											// el 可能是 screenshot 返回的格式 (有 center/mouseCenter) 
											// 或者是 DebugElement 格式 (有 box)
											const anyEl = el as { 
												id: number; 
												text?: string; 
												type?: string;
												box?: [number, number, number, number];
												center?: [number, number];
												mouseCenter?: [number, number];
											};
											return {
												id: anyEl.id,
												type: anyEl.type,
												text: anyEl.text,
												box: anyEl.box,
												center: anyEl.center || (anyEl.box ? [
													Math.round((anyEl.box[0] + anyEl.box[2]) / 2),
													Math.round((anyEl.box[1] + anyEl.box[3]) / 2),
												] as [number, number] : undefined),
												mouseCenter: anyEl.mouseCenter,
											};
										}),
										screenInfo: debugCache.lastScreenInfo,
									};
									
									await saveDebugImages(
										debugCache.stepCount,
										{
											original: debugCache.lastScreenshot,
											marked: debugCache.lastMarkedImage,
											click: debugData.clickImage,
										},
										fullDebugInfo
									);
								} catch (e) {
									this.logger.warn('保存调试图片失败:', (e as Error).message);
								}
							}

							// 发送调试确认请求
							const confirmId = generateId('debug');
							yield {
								type: 'debug_confirm',
								tool: toolName,
								args: toolArgs,
								debug: debugData,
								confirmId,
								thinking,
							};

							// 等待用户确认
							this.logger.info(`│  [调试模式] 等待用户确认...`);
							try {
								const approved = await waitForConfirmation(confirmId);
								if (!approved) {
									this.logger.info(`│  [调试模式] 用户取消操作，终止任务`);
									// 保存取消消息到会话
									this.gateway.sessionManager.addMessage(session.id, {
										role: 'assistant',
										content: '🛑 调试模式：用户取消了操作，任务已终止。',
									});
									yield { type: 'terminated', reason: '调试模式：用户取消了操作' };
									return; // 直接终止整个任务
								}
								// 延迟 3 秒执行，给用户时间切换回目标窗口
								this.logger.info(`│  [调试模式] 用户确认，3秒后执行...`);
								yield { type: 'status', status: '⏳ 3秒后执行，请切换到目标窗口...' };
								await new Promise(resolve => setTimeout(resolve, 3000));
								this.logger.info(`│  [调试模式] 开始执行`);
							} catch (e) {
								this.logger.warn(`│  [调试模式] 确认超时或失败:`, (e as Error).message);
								// 超时也终止任务
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'assistant',
									content: '⏱️ 调试模式：确认超时，任务已终止。',
								});
								yield { type: 'terminated', reason: '调试模式：确认超时' };
								return;
							}
						}
					}

					// 沙盒安全检查
					const operationInfo = securityGuard.extractOperationInfo(toolName, toolArgs as Record<string, unknown>);
					const securityCheck = await securityGuard.check(operationInfo);
					
					if (!securityCheck.allowed) {
						if (securityCheck.action === 'block') {
							// 操作被禁止
							this.logger.warn(`🚫 操作被安全系统阻止: ${securityCheck.reason}`);
							yield { 
								type: 'tool_result', 
								tool: toolName, 
								result: { 
									success: false, 
									blocked: true,
									error: securityCheck.message || securityCheck.reason,
								}
							};
							
							// 添加消息到会话
							this.gateway.sessionManager.addMessage(session.id, {
								role: 'tool',
								content: JSON.stringify({ 
									success: false, 
									blocked: true, 
									error: securityCheck.message 
								}),
								metadata: { toolCallId: toolId, toolName },
							});
							
							// 继续处理下一个工具调用
							continue;
						} else if (securityCheck.action === 'confirm') {
							// 需要用户确认
							this.logger.info(`🔐 操作需要用户确认: ${securityCheck.reason}`);
							
							const confirmId = generateId('security');
							yield {
								type: 'security_confirm',
								tool: toolName,
								args: toolArgs,
								confirmId,
								message: securityCheck.confirmMessage || securityCheck.reason,
								category: securityCheck.category,
							};
							
							// 等待用户确认
							try {
								const approved = await waitForConfirmation(confirmId);
								if (!approved) {
									this.logger.info(`❌ 用户拒绝了操作`);
									yield { 
										type: 'tool_result', 
										tool: toolName, 
										result: { 
											success: false, 
											cancelled: true,
											error: '用户取消了操作',
										}
									};
									
									this.gateway.sessionManager.addMessage(session.id, {
										role: 'tool',
										content: JSON.stringify({ success: false, cancelled: true }),
										metadata: { toolCallId: toolId, toolName },
									});
									
									continue;
								}
								this.logger.info(`✅ 用户确认了操作`);
							} catch (e) {
								this.logger.warn(`⏱️ 确认超时: ${(e as Error).message}`);
								yield { 
									type: 'tool_result', 
									tool: toolName, 
									result: { 
										success: false, 
										timeout: true,
										error: '确认超时',
									}
								};
								
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'tool',
									content: JSON.stringify({ success: false, timeout: true }),
									metadata: { toolCallId: toolId, toolName },
								});
								
								continue;
							}
						}
					}

					const toolStartTime = Date.now();
					try {
						const result = await this.gateway.executeTool(toolName, toolArgs);
						const toolDuration = Date.now() - toolStartTime;

						// 格式化结果用于日志
						const resultStr =
							typeof result === 'string'
								? result.substring(0, 300)
								: JSON.stringify(result).substring(0, 300);
						this.logger.info(`│  结果: ${resultStr}${resultStr.length >= 300 ? '...' : ''}`);
						this.logger.info(`└─ 完成 (${toolDuration}ms)`);

						// 调试模式：如果是截图工具，缓存截图（OCR-SoM 结果已由 screenshot 工具返回）
						if (debugMode && toolName === 'screenshot') {
							const screenshotResult = result as { 
								success?: boolean; 
								base64?: string;
								markedImage?: string;
								elements?: DebugElement[];
								imageSize?: string;
								mouseCoordSize?: string;
								scale?: number;
							};
							if (screenshotResult.success && screenshotResult.base64) {
								debugCache.lastScreenshot = screenshotResult.base64;
								// 使用 screenshot 工具返回的 OCR-SoM 结果
								if (screenshotResult.markedImage) {
									debugCache.lastMarkedImage = screenshotResult.markedImage;
								}
								if (screenshotResult.elements) {
									debugCache.lastElements = screenshotResult.elements;
								}
								// 保存屏幕信息
								debugCache.lastScreenInfo = {
									imageSize: screenshotResult.imageSize,
									mouseCoordSize: screenshotResult.mouseCoordSize,
									scale: screenshotResult.scale,
								};
								this.logger.info(`│  [调试模式] 截图已缓存${screenshotResult.elements ? `，包含 ${screenshotResult.elements.length} 个元素` : ''}`);
							}
						}

						yield { type: 'tool_result', tool: toolName, result };

						// 检查是否是浏览器扩展未连接的致命错误
						if (toolName === 'browser') {
							const browserResult = result as { success?: boolean; message?: string };
							if (
								browserResult.success === false &&
								browserResult.message?.includes('浏览器扩展未连接')
							) {
								this.logger.warn('浏览器扩展未连接，终止 Agent 运行');

								// 添加工具结果消息
								this.gateway.sessionManager.addMessage(session.id, {
									role: 'tool',
									content: JSON.stringify(result),
									metadata: { toolCallId: toolId, toolName },
								});

								// 返回终止事件给前端
								yield {
									type: 'terminated',
									reason: 'extension_not_connected',
									content: browserResult.message,
								};
								return; // 终止 Agent 运行
							}
						}

						// 处理工具结果 - 特殊处理截图等大数据
						const processed = this.processToolResult(toolName, result, hasVision);

						// 添加工具结果消息
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: processed.content,
							metadata: {
								toolCallId: toolId,
								toolName,
								isMultimodal: processed.isMultimodal,
							},
						});
					} catch (error) {
						const toolDuration = Date.now() - toolStartTime;
						this.logger.error(`│  错误: ${(error as Error).message}`);
						this.logger.error(`└─ 失败 (${toolDuration}ms)`);
						yield { type: 'tool_error', tool: toolName, error: (error as Error).message };

						// 添加错误消息
						this.gateway.sessionManager.addMessage(session.id, {
							role: 'tool',
							content: JSON.stringify({ error: (error as Error).message }),
							metadata: { toolCallId: toolId, toolName, error: true },
						});
					}
				}

				// 继续循环，让 AI 处理工具结果
			}

			// 超过最大迭代 - 强制让 AI 返回总结
			if (iteration >= maxIterations) {
				this.logger.warn(`达到最大迭代次数 ${maxIterations}，强制生成总结...`);

				// 添加一条系统消息，要求 AI 总结
				this.gateway.sessionManager.addMessage(session.id, {
					role: 'user',
					content:
						'[系统提示] 已达到最大操作次数限制。请立即停止所有工具调用，根据目前已收集到的信息，给用户一个总结回复。如果任务未完成，请说明已完成的部分和未完成的原因。',
				});

				// 让 AI 生成最终响应（不允许工具调用）
				const messages = this.gateway.sessionManager.getMessagesForAI(session.id, {
					systemPrompt,
					maxMessages: 30,
				});

				for await (const chunk of this.gateway.providerManager.chat(modelRef, messages, {
					tools: undefined, // 不提供工具，强制文字回复
				})) {
					if (chunk.type === 'content') {
						yield { type: 'content', content: chunk.content };
					}
				}

				yield { type: 'max_iterations', iterations: iteration };
			}

			const duration = Date.now() - startTime;
			this.logger.info(`Agent 运行完成: ${runId} (${duration}ms)`);
		} catch (error) {
			this.logger.error(`Agent 运行失败: ${runId}`, (error as Error).message);
			yield { type: 'error', error: (error as Error).message };
		}
		// 注意：不自动关闭浏览器！让用户决定是否关闭
		// 浏览器只有在用户明确要求"关闭浏览器"时才会关闭
	}

	/**
	 * 获取工具名称
	 */
	private getToolName(toolCall: ToolCall | ToolUse): string {
		if ('function' in toolCall && toolCall.function) {
			return toolCall.function.name;
		}
		if ('name' in toolCall) {
			return toolCall.name;
		}
		return '';
	}

	/**
	 * 获取工具 ID
	 */
	private getToolId(toolCall: ToolCall | ToolUse): string {
		return toolCall.id || '';
	}

	/**
	 * 解析工具参数
	 */
	private parseToolArgs(toolCall: ToolCall | ToolUse): Record<string, unknown> {
		// OpenAI 格式
		if ('function' in toolCall && toolCall.function?.arguments) {
			return safeParseJSON(toolCall.function.arguments, {});
		}
		// Anthropic 格式
		if ('input' in toolCall && toolCall.input) {
			return typeof toolCall.input === 'string' ? safeParseJSON(toolCall.input, {}) : toolCall.input;
		}
		return {};
	}

	/**
	 * 标准化工具调用格式
	 */
	private normalizeToolCalls(toolCalls: Array<ToolCall | ToolUse>): ToolCall[] {
		return toolCalls.map((tc) => {
			if ('function' in tc) {
				return tc as ToolCall;
			}
			// 转换 ToolUse 为 ToolCall
			const toolUse = tc as ToolUse;
			return {
				id: toolUse.id,
				type: 'function' as const,
				function: {
					name: toolUse.name,
					arguments: JSON.stringify(toolUse.input),
				},
			};
		});
	}

	/**
	 * 处理工具结果 - 特殊处理截图等大数据
	 * @param hasVision - 当前模型是否支持 Vision
	 */
	private processToolResult(
		toolName: string,
		result: unknown,
		hasVision: boolean
	): { content: string | ContentBlock[]; isMultimodal: boolean } {
		// 截图工具特殊处理
		if (toolName === 'screenshot') {
			const screenshotResult = result as {
				success: boolean;
				base64?: string;
				path?: string;
				screens?: unknown[];
				// OCR-SoM 相关
				ocrEnabled?: boolean;
				markedImage?: string;
				elements?: Array<{
					id: number;
					type: string;
					text: string;
					center: [number, number];
					box: [number, number, number, number];
				}>;
				scale?: number;
				coordinateHelp?: string;
				ocrError?: string;
				ocrFatal?: boolean;
			};

			// 检查 OCR 致命错误
			if (screenshotResult.ocrFatal && screenshotResult.ocrError) {
				const errorMsg = `❌ OCR-SoM 服务出现致命错误，视觉能力不可用！

**错误信息**: ${screenshotResult.ocrError}

**可能的解决方案**:
1. 检查 OCR-SoM 服务是否正常运行
2. 如果使用 GPU 版本，可能缺少 CUDA/cuDNN 库
3. 尝试在 Set-of-Mark 目录运行: \`python install.py --cpu\` 安装 CPU 版本
4. 或者禁用 OCR: 在配置中设置 \`ocr.enabled: false\`

当前无法继续执行需要视觉能力的任务。`;
				
				return {
					content: errorMsg,
					isMultimodal: false,
				};
			}

			if (screenshotResult.base64) {
				const sizeKB = Math.round((screenshotResult.base64.length * 0.75) / 1024);

				if (hasVision) {
					// Vision 模式：返回多模态内容
					const content: ContentBlock[] = [];
					
					// 如果有 OCR-SoM 结果，包含标注图和元素列表
					if (screenshotResult.ocrEnabled && screenshotResult.elements && screenshotResult.markedImage) {
						// 元素列表以 JSON 格式发送
						const elementsJson = JSON.stringify(screenshotResult.elements, null, 2);
						
						content.push({
							type: 'text',
							text: `## 元素列表（OCR-SoM 识别结果）
共 ${screenshotResult.elements.length} 个元素：
${elementsJson}

⚠️ **坐标使用规则**：

### 情况1：目标元素在列表中（优先）
直接使用该元素的 center 坐标，不要估算！

### 情况2：目标元素不在列表中（如空输入框、空白区域）
**结合视觉分析 + 周围元素推断**：
1. 仔细观察截图，用你的视觉理解能力定位目标区域
2. 找到目标附近已识别的元素作为参照点
3. 根据参照点的坐标，推算目标的大致位置
4. 结合界面布局常识和视觉观察来确定坐标

## 原始截图（未标注）`,
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/jpeg;base64,${screenshotResult.base64}` },
						});
						content.push({
							type: 'text', 
							text: `\n## 标注截图（带编号）`,
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/png;base64,${screenshotResult.markedImage}` },
						});
					} else {
						// 没有 OCR-SoM，只返回原始截图
						content.push({ 
							type: 'text', 
							text: `截图成功 (${sizeKB}KB)。${screenshotResult.coordinateHelp || ''}
请分析图片内容：` 
						});
						content.push({
							type: 'image_url',
							image_url: { url: `data:image/jpeg;base64,${screenshotResult.base64}` },
						});
					}
					
					return { content, isMultimodal: true };
				} else {
					// 非 Vision 模式：不应该走到这里（工具已被过滤），但以防万一
					return {
						content: JSON.stringify({
							success: screenshotResult.success,
							error: '当前模型不支持图像理解，无法分析截图',
						}),
						isMultimodal: false,
					};
				}
			}

			// 保存到文件或列出屏幕
			return {
				content: JSON.stringify(result),
				isMultimodal: false,
			};
		}

		// browser 工具的截图也需要处理
		if (toolName === 'browser') {
			const browserResult = result as { success: boolean; base64?: string };
			if (browserResult.base64) {
				const sizeKB = Math.round((browserResult.base64.length * 0.75) / 1024);

				if (hasVision) {
					return {
						content: [
							{ type: 'text', text: `浏览器截图成功 (${sizeKB}KB)：` },
							{ type: 'image_url', image_url: { url: `data:image/png;base64,${browserResult.base64}` } },
						],
						isMultimodal: true,
					};
				} else {
					return {
						content: JSON.stringify({
							success: browserResult.success,
							message: `截图成功 (${sizeKB}KB)。建议使用 snapshot 获取页面元素列表。`,
						}),
						isMultimodal: false,
					};
				}
			}
		}

		// 其他工具直接返回
		return {
			content: typeof result === 'string' ? result : JSON.stringify(result),
			isMultimodal: false,
		};
	}

	/**
	 * 分析截图
	 */
	async analyzeScreenshot(
		screenshotBase64: string,
		task: string,
		options: { model?: string } = {}
	): Promise<Record<string, unknown>> {
		const { provider, model } = this.gateway.providerManager.resolveModel(options.model);

		const prompt = `分析这个屏幕截图，并根据以下任务生成操作指令：

任务：${task}

请返回 JSON 格式的分析结果：
{
  "status": "continue|complete|error",
  "description": "当前屏幕状态描述",
  "actions": [
    {
      "type": "click|type|scroll|key",
      "params": { ... }
    }
  ],
  "reasoning": "推理过程"
}`;

		const messages = [
			{
				role: 'user' as const,
				content: [
					{ type: 'text' as const, text: prompt },
					{ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
				],
			},
		];

		let fullContent = '';
		for await (const chunk of provider.chat(messages, { model, maxTokens: 2000 })) {
			if (chunk.type === 'content' && chunk.content) {
				fullContent += chunk.content;
			}
		}

		return safeParseJSON(fullContent, { status: 'error', description: 'Failed to parse response' });
	}
}

export { SessionManager };
export default Agent;
