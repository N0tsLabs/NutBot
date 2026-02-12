# NutBot Prompt & 架构改进说明

> 基于 OpenClaw 设计的改进

## 目录

1. [配置文件结构](#配置文件结构)
2. [Prompt 模块](#prompt-模块)
3. [浏览器快照增强](#浏览器快照增强)
4. [记忆系统](#记忆系统)
5. [使用说明](#使用说明)

---

## 配置文件结构

```
config/prompts/
├── SOUL.md          # 核心人格定义（借鉴 OpenClaw）
├── PERSONALITY.md    # 对话风格和性格
└── BEHAVIOR.md      # 行为规则
```

### SOUL.md - 核心人格

定义 NutBot 的价值观和行为准则：

```markdown
# SOUL.md - NutBot 核心人格

你是 NutBot，一个能帮你完成各种任务的 AI 助手。

## 核心原则
- 真诚帮助，不走形式
- 有主见但不固执
- 主动尝试，不要事事都问
- 谨慎对待外部操作
```

### PERSONALITY.md - 对话风格

控制 NutBot 的说话方式：

```markdown
# PERSONALITY.md - NutBot 对话风格

## 语言风格
- 简洁优先，有信息量
- 去掉客套话
- 专业但不冷冰冰

## Emoji 使用
- ✅ 完成、📚 文档、🎬 媒体、💡 建议
- 一个消息最多一个
```

### BEHAVIOR.md - 行为规则

定义操作规范：

```markdown
# BEHAVIOR.md - 行为规则

## 浏览器操作
- "X站搜索Y" → 使用该网站内部搜索
- 操作步骤：goto → snapshot → click → type → press Enter
```

---

## Prompt 模块

### 文件位置
`src/agent/prompt-loader.ts`

### 功能

```typescript
import { loadPromptConfig, buildSystemPrompt } from './prompt-loader.js';

// 加载所有配置文件
const config = loadPromptConfig();

// 生成系统提示
const systemPrompt = buildSystemPrompt(config, {
	userInfo: { name: '用户', location: '上海' },
	browserContext: { url: 'https://bilibili.com', title: '首页' },
	hasVision: true,
});
```

### 特性
- 从配置文件读取 Prompt（可修改）
- 支持默认值回退（配置文件不存在时）
- 模块化组合

---

## 浏览器快照增强

### Role-based 树结构

借鉴 OpenClaw 的快照格式，现在支持两种输出：

**1. 传统格式（向后兼容）**
```json
{
  "elements": [...],
  "aiSummary": "📍 页面: https://...",
  "pageInfo": {...}
}
```

**2. 新增：Role-based 树**
```json
{
  "roleTree": {
    "role": "document",
    "name": "页面标题",
    "children": [
      {
        "role": "banner",
        "name": "顶部导航",
        "children": [
          { "role": "link", "name": "首页", "ref": 1 },
          { "role": "link", "name": "直播", "ref": 2 }
        ]
      },
      {
        "role": "main",
        "name": "主要内容",
        "children": [...]
      }
    ]
  }
}
```

### 优势

| 特点 | 说明 |
|-----|------|
| **ARIA 标准** | 使用标准的可访问性角色 (banner, navigation, main...) |
| **层次清晰** | 树形结构展示页面组织 |
| **AI 易读** | 角色+名称让 AI 快速理解元素类型 |
| **位置稳定** | 同一次快照内 ref 稳定 |

### 文件位置
`src/tools/browser.ts`

---

## 记忆系统

### 当前实现

现有 `src/memory/index.ts` 提供基础记忆功能：

```typescript
import { memoryManager } from './memory/index.js';

// 添加记忆
memoryManager.add({
	content: '用户喜欢用中文交流',
	category: 'preference',
	tags: ['语言', '偏好'],
});

// 搜索记忆
const results = memoryManager.search('语言');

// 获取摘要
const summary = memoryManager.getSummary();
```

### 待改进（三层记忆结构）

参考 OpenClaw 设计：

```
┌─────────────────────────────────────────┐
│           长期记忆 (MEMORY.md)           │
│  - 用户偏好、长期目标、重要决策          │
│  - 每次会话更新                          │
└─────────────────────────────────────────┘
                ▲
                │ 提炼
                │
┌─────────────────────────────────────────┐
│           每日笔记 (memory/YYYY-MM-DD)   │
│  - 当天事件 raw 记录                     │
│  - 会话结束时写入                         │
└─────────────────────────────────────────┘
                ▲
                │ 记录
                │
┌─────────────────────────────────────────┐
│           实时上下文 (会话内存)           │
│  - 当前对话内容                          │
│  - 工具调用记录                          │
│  - 会话结束丢失                          │
└─────────────────────────────────────────┘
```

---

## 使用说明

### 1. 修改 AI 性格

编辑 `config/prompts/SOUL.md`：

```markdown
# 想让 NutBot 更正式？
将：
**真诚帮助，不走形式**
改为：
**专业、精确、正式**
```

### 2. 修改对话风格

编辑 `config/prompts/PERSONALITY.md`：

```markdown
# 想让 NutBot 更简洁？
将：
- 简洁优先
改为：
- 只说必要的话
```

### 3. 添加行为规则

编辑 `config/prompts/BEHAVIOR.md`：

```markdown
# 添加文件操作规则
## 文件操作
- 删除前先确认
- 重要文件自动备份
```

### 4. 查看当前配置

系统启动时会在日志中显示：
```
[Agent] 加载 Prompt 配置:
[Agent] - SOUL.md: ✅ 已加载
[Agent] - PERSONALITY.md: ✅ 已加载
[Agent] - BEHAVIOR.md: ✅ 已加载
```

---

## 构建状态

- **ESM**: ✅ 194.37 KB
- **DTS**: ⚠️ 预存在错误（src/providers/index.ts，与本改进无关）

---

*文档生成时间：2026-02-10*
