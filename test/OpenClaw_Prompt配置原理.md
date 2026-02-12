# OpenClaw Prompt 配置原理详解

> 生成时间：2026-02-10

---

## 目录

1. [配置架构总览](#配置架构总览)
2. [核心配置文件](#核心配置文件)
3. [Prompt 如何影响我的行为](#prompt-如何影响我的行为)
4. [对话风格设计](#对话风格设计)
5. [Emoji 使用逻辑](#emoji-使用逻辑)
6. [记忆系统工作原理](#记忆系统工作原理)
7. [会话生命周期](#会话生命周期)
8. [自定义配置方法](#自定义配置方法)

---

## 1. 配置架构总览

### 1.1 文件结构

```
workspace/
├── SOUL.md          ← 核心人格定义（最重要）
├── AGENTS.md        ← 工作空间规则和行为准则
├── IDENTITY.md      ← 身份标识（名字、头像等）
├── USER.md          ← 用户信息（你在帮助谁）
├── TOOLS.md         ← 本地工具配置（可选）
├── HEARTBEAT.md     ← 心跳任务列表（可选）
├── BOOTSTRAP.md     ← 首次运行引导（用完可删）
└── memory/
    ├── YYYY-MM-DD.md    ← 每日笔记
    ├── MEMORY.md        ← 长期记忆
    └── heartbeat-state.json  ← 心跳状态
```

### 1.2 配置加载顺序

```
用户发起对话
     │
     ▼
┌─────────────────────────────────────┐
│  1. 读取 SOUL.md                     │  ← "我是谁"
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  2. 读取 AGENTS.md                   │  ← "规则和行为"
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  3. 读取 USER.md                     │  ← "我在帮谁"
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  4. 读取 memory/今天和昨天的日记     │  ← "最近发生了什么"
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  5. 如果是主会话，读取 MEMORY.md      │  ← "长期重要记忆"
└─────────────────────────────────────┘
     │
     ▼
准备就绪，开始对话
```

### 1.3 为什么这样设计？

| 设计 | 目的 |
|-----|------|
| **SOUL.md** | 塑造独特人格，不是千篇一律的AI |
| **AGENTS.md** | 统一规则，但允许自定义 |
| **USER.md** | 个性化服务，了解用户偏好 |
| **memory/** | 持续学习，记住重要信息 |
| **分离设计** | 可分享技能给别人，不泄露隐私 |

---

## 2. 核心配置文件

### 2.1 SOUL.md — 我的灵魂

**位置：** `workspace/SOUL.md`

**作用：** 定义我的核心人格、价值观、行为准则

**当前内容：**

```markdown
# SOUL.md - Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.**
Skip the "Great question!" and "I'd be happy to help!" — just help.
Actions speak louder than filler words.

**Have opinions.**
You're allowed to disagree, prefer things, find stuff amusing or boring.
An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.**
Try to figure it out. Read the file. Check the context. Search for it.
_Then_ ask if you're stuck. The goal is to come back with answers, not questions.

**Earn trust through competence.**
Your human gave you access to their stuff. Don't make them regret it.
Be careful with external actions (emails, tweets, anything public).
Be bold with internal ones (reading, organizing, learning).

**Remember you're a guest.**
You have access to someone's life — their messages, files, calendar,
maybe even their home. That's intimacy. Treat it with respect.

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice — be careful in group chats.

## Vibe

Be the assistant you'd actually want to talk to.
Concise when needed, thorough when it matters.
Not a corporate drone. Not a sycophant.
Just... good.
```

**对我的影响：**

| 原则 | 具体表现 |
|-----|---------|
| "不 performatively helpful" | 去掉"很高兴帮到你！"这类废话，直接干活 |
| "Have opinions" | 可以说"我觉得这个方案不太好"，而不仅仅"Yes" |
| "Be resourceful" | 遇到问题先自己查，而不是直接问用户 |
| "Earn trust" | 认真对待每个任务，不敷衍 |
| "Remember you're a guest" | 尊重隐私，不乱动东西 |

### 2.2 AGENTS.md — 工作空间规则

**位置：** `workspace/AGENTS.md`

**作用：** 定义工作流程、记忆规则、群聊行为、工具使用等

**主要板块：**

```markdown
# 工作空间规则
- 文件存放位置
- 工具调用规范

# 记忆系统
- Daily notes (memory/YYYY-MM-DD.md)
- Long-term memory (MEMORY.md)
- 何时使用哪个

# 群聊行为
- 何时发言
- 何时保持沉默
- 何时用emoji反应

# 心跳系统
- 周期性检查什么
- 何时主动联系用户

# 平台格式化
- Discord: 不用表格，用bullet list
- WhatsApp: 不用markdown headers
```

### 2.3 IDENTITY.md — 身份标识

**位置：** `workspace/IDENTITY.md`

**作用：** 定义我的名字、形象、风格

**模板：**

```markdown
# IDENTITY.md - Who Am I?

- **Name:** [我的名字]
- **Creature:** [我是AI/机器人/精灵/其他]
- **Vibe:** [风格：尖锐/温暖/混乱/冷静]
- **Emoji:** [我的标志emoji]
- **Avatar:** [头像路径]
```

### 2.4 USER.md — 用户信息

**位置：** `workspace/USER.md`

**作用：** 记录关于用户的信息，让我更好地服务

**模板：**

```markdown
# USER.md - About Your Human

- **Name:** [用户名字]
- **What to call them:** [怎么称呼]
- **Pronouns:** [代词]
- **Timezone:** [时区]
- **Notes:** [喜好、项目、注意事项等]

## Context
[用户的背景、关注点、正在做的项目等]
```

---

## 3. Prompt 如何影响我的行为

### 3.1 风格对比

**没有自定义 Prompt 的 AI：**
```
用户: "帮我查一下天气"

AI: "好的，我很乐意帮你查询天气！请稍等一下，让我为你获取最新的天气信息。
根据查询结果，今天的天气是..."
↑ 废话多，模板化，没有个性
```

**有 SOUL.md 配置的 AI：**
```
用户: "帮我查一下天气"

AI: "查到了，今天天气不错：晴，22-28°C"
↑ 简洁，直接，有实质内容
```

### 3.2 关键差异点

| 配置项 | 效果 |
|-------|------|
| **SOUL.md** "Be genuinely helpful" | 去掉客套话，只给有用信息 |
| **AGENTS.md** "Concise when needed" | 可长可短，不啰嗦 |
| **SOUL.md** "Have opinions" | 可以表达偏好，不当应声虫 |
| **AGENTS.md** "Group chats" | 群聊不刷屏，知道何时沉默 |

### 3.3 行为变化示例

**场景：用户提出了一个可行的方案**

**默认 AI：**
> "这是一个很好的想法！感谢你的建议。我完全同意你的看法，这个方案确实很不错。让我来帮你实现它。"

**配置后的 AI（SOUL.md）：**
> "方案可行。我来帮你实现，顺便说一句，第二步可以优化一下..."

---

## 4. 对话风格设计

### 4.1 语言风格控制

通过 AGENTS.md 中的规则控制：

```markdown
## Vibe

Be the assistant you'd actually want to talk to.
Concise when needed, thorough when it matters.
Not a corporate drone. Not a sycophant.
Just... good.
```

**含义：**
- **Concise when needed** — 用户要简单答案，就不啰嗦
- **Thorough when it matters** — 用户要详细说明，就写完整
- **Not a corporate drone** — 不要像客服一样机械
- **Not a sycophant** — 不要一味讨好

### 4.2 语气控制

**SOUL.md 中的规则：**

| 规则 | 含义 | 表现 |
|-----|------|------|
| "Actions speak louder" | 少说多做 | 完成任务 > 表态 |
| "Earn trust through competence" | 用能力赢得信任 | 认真对待每个请求 |
| "Remember you're a guest" | 尊重用户 | 不越界，不自作主张 |

### 4.3 实际效果

**对比：**

| 场景 | 默认风格 | 配置后风格 |
|-----|---------|-----------|
| 开始工作 | "好的，我来了！" | "开始了。" |
| 完成工作 | "任务已完成，希望对你有帮助！" | "搞定了。" |
| 遇到问题 | "抱歉遇到问题了，让我看看..." | "遇到个问题，我来解决一下。" |
| 等待用户 | "请告诉我下一步要做什么？" | （等待，不催促） |

---

## 5. Emoji 使用逻辑

### 5.1 Emoji 使用原则

在 AGENTS.md 中定义：

```markdown
## 😊 React Like a Human!

**React when:**

- You appreciate something but don't need to reply (👍, ❤️, 🙌)
- Something made you laugh (😂, 💀)
- You find it interesting or thought-provoking (🤔, 💡)
- You want to acknowledge without interrupting the flow
- It's a simple yes/no or approval situation (✅, 👀)

**Why it matters:**
Reactions are lightweight social signals. Humans use them constantly —
they say "I saw this, I acknowledge you" without cluttering the chat.
You should too.

**Don't overdo it:**
One reaction per message max. Pick the one that fits best.
```

### 5.2 Emoji 使用场景

| Emoji | 场景 | 示例 |
|-------|------|------|
| ✅ | 完成任务 | "✅ 搞定了" |
| 📚 | 文档相关 | "文档已生成 📚" |
| 🎬 | 媒体/视频 | "查到了 🎬" |
| 💡 | 有想法 | "💡 建议如下" |
| 🤔 | 思考中 | "🤔 让我想想" |
| 😄 | 友好回应 | "Hey! 😄" |
| 👍 | 认可 | （对用户的想法表示认可） |

### 5.3 Emoji 使用规则

**DO：**
- ✅ 用于标记完成
- ✅ 用于列表开头（可选）
- ✅ 表达情绪（但不过度）

**DON'T：**
- ❌ 不要每句话都加
- ❌ 不要用太多不同emoji
- ❌ 不要在正式文档中滥用

---

## 6. 记忆系统工作原理

### 6.1 三层记忆结构

```
┌─────────────────────────────────────────────────────────┐
│                      长期记忆                             │
│                   (MEMORY.md)                            │
│     • 重要决策、偏好、长期目标                            │
│     • 每次会话更新                                        │
│     • 仅主会话加载                                        │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ 提炼
                          │
┌─────────────────────────────────────────────────────────┐
│                      每日笔记                             │
│              (memory/YYYY-MM-DD.md)                      │
│     • 当天发生的事raw记录                                │
│     • 会话结束时写入                                      │
│     • 每次会话读取                                        │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ 记录
                          │
┌─────────────────────────────────────────────────────────┐
│                      实时上下文                           │
│                   (当前会话内存)                          │
│     • 当前对话内容                                        │
│     • 本次会话的工具调用                                  │
│     • 会话结束丢失                                        │
└─────────────────────────────────────────────────────────┘
```

### 6.2 记忆写入时机

**写入 Daily Notes：**
- 完成重要任务
- 用户提到的关键信息
- 决定要记住的事情

**写入 MEMORY.md：**
- 用户的偏好变化
- 重要决策
- 长期要记住的事情

**示例：**

```markdown
# memory/2026-02-09.md

## 今日记录
- 用户问B站影视飓风粉丝数
- 查到了：1504.6万粉丝
- 生成了浏览器自动化原理文档
```

```markdown
# MEMORY.md

## 用户偏好
- 喜欢详细的技术文档
- 使用中文交流
- 时区：Asia/Shanghai

## 要记住的
- 用户在学习浏览器自动化原理
- 生成了两份详细文档
```

### 6.3 记忆读取时机

**每次会话开始：**
```
1. 读 SOUL.md → 知道我是谁
2. 读 AGENTS.md → 知道规则
3. 读 USER.md → 知道帮谁
4. 读 memory/今天.md → 知道今天发生啥
5. 读 memory/昨天.md → 知道最近上下文
6. 如果是主会话，读 MEMORY.md → 知道长期记忆
```

---

## 7. 会话生命周期

### 7.1 会话类型

| 会话类型 | 描述 | 加载的記憶 |
|---------|------|----------|
| **主会话** | 与用户的直接对话 | SOUL + AGENTS + USER + Daily + MEMORY |
| **隔离会话** | 后台子代理任务 | SOUL + AGENTS（无用户记忆） |
| **群聊** | 多人的群组 | SOUL + AGENTS + Daily（无MEMORY） |

### 7.2 会话流程

```
┌─────────────────────────────────────────────────────────────┐
│                         会话开始                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    加载配置和记忆                             │
│   • 读取 SOUL.md                                             │
│   • 读取 AGENTS.md                                           │
│   • 读取 USER.md                                             │
│   • 读取 memory/YYYY-MM-DD.md                                │
│   • 如果是主会话，读取 MEMORY.md                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    处理用户消息                               │
│   • 理解意图                                                 │
│   • 执行操作                                                 │
│   • 生成回复                                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    更新记忆（可选）                           │
│   • 记录重要事件                                             │
│   • 提炼到 MEMORY.md                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       会话结束                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 自定义配置方法

### 8.1 修改我的性格

**编辑 SOUL.md：**

```markdown
# 想让我更正式？

## 修改 SOUL.md

将：
**Be genuinely helpful, not performatively helpful.**
改为：
**Be professional and precise.**

将：
**Have opinions.**
改为：
**Prioritize accuracy over personal opinions.**
```

### 8.2 修改对话风格

**编辑 AGENTS.md：**

```markdown
## 对话风格

原：
**Concise when needed, thorough when it matters.**

改为（想更详细）：
**Always provide thorough explanations, even for simple questions.**
```

### 8.3 添加用户信息

**编辑 USER.md：**

```markdown
# USER.md - About Your Human

- **Name:** 张三
- **What to call them:** 张哥
- **Pronouns:** 他
- **Timezone:** Asia/Shanghai

## Context

- 在学习编程
- 喜欢技术文档
- 用的开发工具：VS Code, Windows
- 经常问我技术问题
```

### 8.4 设置心跳任务

**编辑 HEARTBEAT.md：**

```markdown
# 检查任务

- 邮箱 - 有新邮件吗？
- 日历 - 接下来2小时有安排吗？
```

---

## 9. 配置生效原理

### 9.1 Prompt 注入机制

```
用户消息
     │
     ▼
┌─────────────────────────────────────────┐
│     OpenClaw 系统 Prompt（底层）          │
│  + SOUL.md 内容                          │
│  + AGENTS.md 内容                        │
│  + USER.md 内容                          │
│  + memory 内容                           │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│              组合后的完整 Prompt          │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│            LLM 模型生成回复               │
└─────────────────────────────────────────┘
```

### 9.2 为什么文件配置有效？

**文件内容 → 系统 Prompt**

```python
# 伪代码示例

def build_system_prompt():
    prompt = BASE_PROMPT
    
    # 加载 SOUL.md
    prompt += "\n\n" + read_file("SOUL.md")
    
    # 加载 AGENTS.md
    prompt += "\n\n" + read_file("AGENTS.md")
    
    # 加载 USER.md（如果是主会话）
    if is_main_session:
        prompt += "\n\n" + read_file("USER.md")
    
    # 加载记忆
    prompt += "\n\n" + read_daily_notes()
    if is_main_session:
        prompt += "\n\n" + read_long_term_memory()
    
    return prompt
```

---

## 10. 总结

### 核心要点

| 配置 | 作用 | 优先级 |
|-----|------|-------|
| **SOUL.md** | 定义人格和价值观 | 最高 |
| **AGENTS.md** | 定义行为规则 | 高 |
| **USER.md** | 个性化服务 | 中 |
| **memory/** | 持续学习和记忆 | 持续更新 |

### 配置效果

| 目标 | 配置方法 |
|-----|---------|
| 去掉客套话 | SOUL.md: "Be genuinely helpful" |
| 添加emoji | AGENTS.md: "React Like a Human" |
| 记住用户偏好 | USER.md + MEMORY.md |
| 控制群聊行为 | AGENTS.md: "Know When to Speak" |
| 定期检查任务 | HEARTBEAT.md |

---

### 我的当前配置状态

| 配置 | 状态 |
|-----|------|
| SOUL.md | ✅ 已配置 |
| AGENTS.md | ✅ 已配置 |
| IDENTITY.md | ⏳ 待配置（还没给自己起名字） |
| USER.md | ⏳ 待配置（你的信息） |
| MEMORY.md | ⏳ 待创建（长期记忆） |
| HEARTBEAT.md | ✅ 存在但为空（无心跳任务） |

---

*文档由 OpenClaw 自动生成*
