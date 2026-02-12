# NutBot 需求文档：打造 OpenClaw 风格的全智能 AI 自动化助手

> 版本：v1.0
> 日期：2026-02-09
> 状态：初稿

---

## 1. 项目背景与目标

### 1.1 当前问题

通过分析日志和代码，发现以下核心问题：

| 问题分类 | 具体表现 | 影响 |
|---------|---------|------|
| **Prompt 太复杂** | 系统提示词包含大量信息（用户信息、工具列表、操作指南、浏览器上下文等） | AI 难以理解核心任务 |
| **工具调用混乱** | AI 不清楚何时使用 browser/web/exec 等工具 | 错误使用工具导致任务失败 |
| **任务流程理解差** | AI 理解任务的方式有问题，如"打开网页总结数据"直接用 exec 打开然后说"已经打开" | 完全没执行实际任务 |
| **输出风格不自然** | 大量内部日志输出、AI 思考过程冗长 | 用户体验差 |
| **缺少引导式交互** | 不会主动询问、引导用户 | 对话僵硬 |
| **浏览器操作不稳定** | 元素定位经常失败、snapshot 返回大量信息但 AI 无法有效利用 | 自动化成功率低 |

### 1.2 目标

打造一个 **OpenClaw 风格** 的全智能 AI 自动化助手：

1. **自然对话**：像朋友一样交流，主动引导用户
2. **智能理解**：准确理解用户需求，制定执行计划
3. **高效执行**：正确使用工具，高效完成任务
4. **清晰输出**：只输出用户关心的内容，过程简洁
5. **稳定可靠**：浏览器操作稳定，减少失败率

---

## 2. 核心设计原则

### 2.1 对话流程设计

```
用户提出需求
    ↓
【理解阶段】AI 理解需求 → 给出执行计划（简短说明）
    ↓
【执行阶段】按计划执行工具 → 每步结果简洁输出
    ↓
【完成阶段】总结结果 → 询问是否需要其他帮助
```

**关键差异**：
- ❌ 当前：用户说"打开网页总结"，AI 直接执行然后输出内部日志
- ✅ 目标：AI 先说"好的，我先打开网页获取内容，然后总结给你" → 执行 → "已获取到 XXX 数据，总结如下..."

### 2.2 Prompt 设计原则

| 原则 | 说明 |
|-----|------|
| **简洁** | System Prompt 控制在 2000 tokens 以内 |
| **清晰** | 工具说明用简短示例，不用长篇大论 |
| **重点突出** | 核心任务指令放在最前面 |
| **避免冗余** | 不必要的说明全部移除 |

### 2.3 输出控制

| 场景 | 输出内容 |
|-----|---------|
| 开始执行 | "好的，我来帮你 XXX。让我先..." |
| 执行中 | 只输出关键结果（成功/失败/获取到数据） |
| 完成 | 完整总结 + "还需要我帮你做什么吗？" |
| 失败 | 说明原因 + 建议解决方案 |

---

## 3. 需求规格

### 3.1 Prompt 重构

#### 3.1.1 System Prompt 结构

```markdown
你是 NutBot，一个能帮你完成各种任务的 AI 助手。

## 核心指令
1. 先理解用户需求，再执行
2. 遇到不确定的地方，主动询问
3. 复杂任务先给计划，再执行
4. 只输出用户关心的内容

## 工具使用（必要時才用）

【浏览器操作】browser
- goto [URL] → 打开网页
- snapshot → 获取页面内容
- click [ref] → 点击元素
- type [ref] "文字" → 输入文字

【快速搜索】browser.search
- {"action":"search","searchQuery":"关键词"}

【网页内容】web.fetch
- {"action":"fetch","url":"URL"}

【系统命令】exec（仅必要时）
- Windows: Start-Process
- 其他系统用命令执行

## 当前状态
- 时间: {当前时间}
- 位置: {用户位置}
```

#### 3.1.2 工具描述精简

| 工具 | 当前描述 | 精简后描述 |
|-----|---------|-----------|
| browser | 166行详细说明 | 5行核心操作 |
| web | 详细说明 | 2行 |
| exec | 详细说明 | 2行 |

### 3.2 任务理解增强

#### 3.2.1 需求解析器

新增 `IntentParser` 模块，用于理解用户意图：

```typescript
interface UserIntent {
  type: 'browse' | 'search' | 'analyze' | 'create' | 'execute' | 'question';
  target?: string;      // 目标URL/文件等
  action?: string;      // 具体操作
  constraints?: string[]; // 约束条件
  expectResult?: string; // 期望结果
}

function parseIntent(message: string): UserIntent {
  // 解析用户消息，提取意图
}
```

#### 3.2.2 执行计划生成

对于复杂任务，AI 应该先生成执行计划：

```
用户: "打开B站，搜影视飓风，看看有多少粉丝"

AI 理解后:
{
  "plan": [
    {"step": 1, "action": "goto", "target": "https://www.bilibili.com"},
    {"step": 2, "action": "snapshot", "desc": "获取B站首页"},
    {"step": 3, "action": "search", "target": "影视飓风", "desc": "搜索影视飓风"},
    {"step": 4, "action": "click", "target": "搜索结果中的影视飓风"},
    {"step": 5, "action": "snapshot", "desc": "获取个人主页"},
    {"step": 6, "action": "extract", "target": "粉丝数"}
  ]
}
```

### 3.3 输出风格改造

#### 3.3.1 内部日志 vs 用户输出

| 类型 | 发送对象 | 内容 |
|-----|---------|------|
| 内部日志 | 仅控制台 | 迭代、Token、工具调用详情 |
| 用户输出 | WebSocket | 简洁的执行过程和结果 |

#### 3.3.2 用户输出模板

```typescript
// 开始执行
`好的，我来帮你"${task}"。
先${firstStep}...`

// 执行中
`已${action}，获取到${resultSummary}`

// 完成
`完成！${summary}
还有其他需要帮忙的吗？`

// 需要帮助
`为了更好地帮你，我需要确认一下：${question}`
```

### 3.4 浏览器工具改进

#### 3.4.1 Snapshot 增强

**问题**：当前返回 89 个元素，AI 无法有效利用

**解决方案**：
1. **智能过滤**：只返回与任务相关的元素
2. **结构化摘要**：提供页面整体结构说明
3. **关键信息提取**：自动识别并标注关键内容位置

```typescript
interface SnapshotResult {
  url: string;
  title: string;
  summary: string;        // 页面整体摘要
  keyElements: {          // 关键元素
    ref: number;
    type: string;
    text: string;
    importance: 'high' | 'medium' | 'low';
  }[];
  searchBox?: {           // 搜索框信息
    ref: number;
    placeholder: string;
  };
  fullElements?: ElementRef[]; // 按需获取
}
```

#### 3.4.2 元素定位优化

| 当前问题 | 解决方案 |
|---------|---------|
| 选择器点击超时 | 增加备用选择器策略 |
| 坐标点击不准确 | 结合页面布局智能推断 |
| 动态元素定位难 | 使用多个特征组合定位 |

### 3.5 任务完成度判断

#### 3.5.1 多维度检查

```typescript
interface CompletionCheck {
  // 是否获取到目标内容
  hasContent: boolean;
  // 内容是否完整
  isComplete: boolean;
  // 是否需要用户确认
  needUserConfirm: boolean;
  // 下一步建议
  nextAction?: string;
}

function checkCompletion(
  intent: UserIntent,
  toolResults: ToolResult[]
): CompletionCheck
```

#### 3.5.2 失败处理

| 失败类型 | 处理策略 |
|---------|---------|
| 页面打不开 | 尝试备用URL/搜索获取 |
| 元素找不到 | 回退到更宽泛的匹配 |
| 权限不足 | 提示用户 |
| 内容为空 | 说明情况 + 建议替代方案 |

---

## 4. 技术实现

### 4.1 文件结构

```
src/
├── agent/
│   ├── index.ts          # Agent 主逻辑（重构）
│   ├── intent-parser.ts  # 新增：意图解析器
│   └── output-formatter.ts # 新增：输出格式化
├── tools/
│   ├── browser.ts        # 浏览器工具（增强）
│   └── web.ts            # Web 工具（精简）
└── services/
    └── page-analyzer.ts  # 新增：页面分析器
```

### 4.2 核心改动点

#### 4.2.1 Agent.run() 改造

```typescript
async *run(message: string, ...): AsyncGenerator<AgentChunk> {
  // 1. 解析用户意图
  const intent = parseIntent(message);

  // 2. 生成执行计划（复杂任务）
  const plan = intent.needsPlan
    ? await this.generatePlan(intent)
    : null;

  // 3. 输出计划给用户
  if (plan) {
    yield { type: 'plan', content: plan.summary };
  }

  // 4. 执行任务
  yield* this.executePlan(plan || intent);
}
```

#### 4.2.2 输出控制

```typescript
// 只输出用户关心的内容
function formatUserOutput(result: ToolResult): string {
  switch (result.tool) {
    case 'browser':
      if (result.action === 'goto') {
        return `已打开${extractDomain(result.url)}`;
      }
      if (result.action === 'snapshot') {
        return `页面已加载，获取到${result.elementCount}个元素`;
      }
      return '';
    // ...
  }
}
```

### 4.3 配置项

```json
{
  "agent": {
    "enablePlanGeneration": true,  // 生成执行计划
    "showInternalLogs": false,     // 不显示内部日志
    "conciseOutput": true,         // 简洁输出
    "enableGuidance": true         // 启用引导式交互
  },
  "browser": {
    "smartSnapshot": true,         // 智能快照
    "elementLimit": 20,            // 元素数量限制
    "retryAttempts": 3             // 重试次数
  }
}
```

---

## 5. 实施计划

### Phase 1: Prompt 重构（优先级：高）

- [ ] 精简 System Prompt
- [ ] 精简工具描述
- [ ] 添加核心指令部分
- [ ] 测试不同长度的效果

### Phase 2: 输出风格改造（优先级：高）

- [ ] 区分内部日志和用户输出
- [ ] 实现输出模板
- [ ] 移除冗余的迭代日志

### Phase 3: 意图理解增强（优先级：中）

- [ ] 实现 IntentParser
- [ ] 生成执行计划
- [ ] 多轮对话支持

### Phase 4: 浏览器工具增强（优先级：中）

- [ ] 智能 Snapshot
- [ ] 元素定位优化
- [ ] 页面分析器

### Phase 5: 用户体验优化（优先级：低）

- [ ] 引导式交互
- [ ] 主动询问
- [ ] 会话摘要

---

## 6. 验收标准

### 6.1 功能验收

| 场景 | 当前表现 | 期望表现 |
|-----|---------|---------|
| "打开B站搜影视飓风" | 用 exec 打开，然后说"已打开" | 先 goto B站 → snapshot → 搜索 → 获取结果 |
| "帮我总结这个网页" | 不知道如何获取内容 | goto → snapshot → 提取内容 → 总结 |
| "天气怎么样" | 可能调用错误的工具 | 直接返回天气信息 |

### 6.2 体验验收

- [ ] 用户只看到简洁的执行过程和结果
- [ ] 不显示迭代次数、Token 等内部信息
- [ ] AI 会主动引导和询问
- [ ] 任务完成后询问是否需要其他帮助

### 6.3 稳定性验收

- [ ] 浏览器操作成功率 > 90%
- [ ] 页面元素定位准确率 > 85%
- [ ] 无明显的扩展连接超时

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| Prompt 精简后效果变差 | 任务完成率下降 | A/B 测试，逐步调整 |
| 输出太简洁用户不知道进度 | 体验不好 | 保留关键步骤提示 |
| 浏览器兼容性问题 | 自动化失败 | 增加错误处理和回退 |

---

## 8. 附录

### 8.1 OpenClaw 对比示例

```
用户: 打开b站，搜一下影视飓风，看看有多少粉丝了

【OpenClaw】
浏览器服务需要先启动。让我直接帮你搜索一下：
查到了！🎬
影视飓风（主账号）：
- 粉丝数：1504.6 万
- 视频数：940 个
...

【NutBot 当前】
─────────── 迭代 1/30 ───────────
消息数量: 2
┌─ 执行工具: browser
│  参数: {"action":"goto","url":"https://www.bilibili.com"}
...
```

### 8.2 参考资料

- OpenClaw 官方文档
- Moltbot 浏览器操作设计
- Agent 最佳实践
