# OpenClaw 功能详细文档

> 生成时间：2026-02-09

---

## 目录

1. [工具 (Tools)](#工具-tools)
2. [技能 (Skills)](#技能-skills)
3. [OpenClaw CLI 命令](#openclaw-cli-命令)
4. [使用场景示例](#使用场景示例)

---

## 工具 (Tools)

### 1. 文件操作

#### read - 读取文件
读取文件内容，支持文本文件和图片。
- **参数：**
  - `file_path` (string): 文件路径（相对或绝对）
  - `limit` (number, 可选): 最大读取行数
  - `offset` (number, 可选): 起始行号（1索引）
- **限制：** 最多2000行或50KB（先到为准）
- **返回：** 文件内容或图片附件

#### write - 写入文件
创建或覆盖文件，自动创建父目录。
- **参数：**
  - `content` (string): 要写入的内容
  - `file_path` (string): 文件路径
- **用途：** 创建新文件、覆盖现有文件

#### edit - 编辑文件
精确替换文件中的文本。
- **参数：**
  - `path` / `file_path` (string): 文件路径
  - `oldText` / `old_string` (string): 要替换的精确文本
  - `newText` / `new_string` (string): 替换后的文本
- **要求：** oldText必须完全匹配（包括空白符）

---

### 2. 命令执行

#### exec - 执行Shell命令
执行shell命令，支持前台和后台运行。
- **参数：**
  - `command` (string): 要执行的命令
  - `ask` (string, 可选): 询问模式 "off"|"on-miss"|"always"
  - `background` (boolean, 可选): 立即后台运行
  - `elevated` (boolean, 可选): 使用提升权限运行
  - `env` (object, 可选): 环境变量
  - `host` (string, 可选): 执行主机 "sandbox"|"gateway"|"node"
  - `node` (string, 可选): 节点ID/名称
  - `pty` (boolean, 可选): 伪终端模式（TTY-required CLI）
  - `security` (string, 可选): 安全模式 "deny"|"allowlist"|"full"
  - `timeout` (number, 可选): 超时秒数
  - `workdir` (string, 可选): 工作目录
  - `yieldMs` (number, 可选): 后台前的等待毫秒数（默认10000）

#### process - 管理后台会话
管理运行中的exec会话。
- **参数：**
  - `action` (string): 操作类型
    - `list`: 列出所有会话
    - `poll`: 轮询会话输出
    - `log`: 获取会话日志
    - `write`: 写入数据
    - `send-keys`: 发送按键
    - `submit`: 提交
    - `paste`: 粘贴
    - `kill`: 终止会话
  - `sessionId` (string): 会话ID
  - `data` (string, 可选): 写入数据
  - `keys` (array, 可选): 发送的按键
  - `text` (string, 可选): 粘贴文本
  - `limit` (number, 可选): 日志行数
  - `offset` (number, 可选): 日志偏移

---

### 3. 网页浏览

#### browser - 控制网页浏览器
通过OpenClaw浏览器控制服务器控制浏览器。
- **参数：**
  - `action` (string): 操作类型
    - `status`: 浏览器状态
    - `start`: 启动浏览器
    - `stop`: 停止浏览器
    - `profiles`: 列出浏览器配置文件
    - `tabs`: 列出标签页
    - `open`: 打开URL
    - `focus`: 聚焦标签页
    - `close`: 关闭标签页
    - `snapshot`: 页面快照
    - `screenshot`: 截图
    - `navigate`: 导航
    - `console`: 控制台
    - `pdf`: 导出PDF
    - `upload`: 上传文件
    - `dialog`: 对话框操作
    - `act`: 执行UI操作
  - `profile` (string, 可选): 配置文件
    - `chrome`: Chrome扩展接管
    - `openclaw`: OpenClaw管理的隔离浏览器
  - `target` (string, 可选): 浏览器位置 "sandbox"|"host"|"node"
  - `targetUrl` (string, 可选): 目标URL
  - `selector` (string, 可选): CSS选择器
  - `element` (string, 可选): 元素
  - `request` (object, 可选): UI操作请求
    - `kind`: "click"|"type"|"press"|"hover"|"drag"|"select"|"fill"|"resize"|"wait"|"evaluate"|"close"
    - `text` (string): 输入文本
    - `ref` (string): 元素引用
    - `submit` (boolean): 提交表单
    - `doubleClick` (boolean): 双击
    - `slowly` (boolean): 慢速操作

**快照格式：**
- `refs`: "role" (默认) 或 "aria"
- `snapshotFormat`: "aria" 或 "ai"

#### web_search - 网页搜索
使用Brave Search API进行网页搜索。
- **参数：**
  - `query` (string): 搜索查询
  - `count` (number, 可选): 结果数量 (1-10)
  - `country` (string, 可选): 2字母国家代码
  - `freshness` (string, 可选): 时间过滤
    - `pd`: 过去24小时
    - `pw`: 过去一周
    - `pm`: 过去一月
    - `py`: 过去一年
  - `search_lang` (string, 可选): 搜索结果语言
  - `ui_lang` (string, 可选): UI语言
- **要求：** 需要Brave API密钥

#### web_fetch - 获取网页内容
获取并提取URL的可读内容（HTML转markdown/text）。
- **参数：**
  - `url` (string): HTTP/HTTPS URL
  - `extractMode` (string, 可选): "markdown" (默认) 或 "text"
  - `maxChars` (number, 可选): 最大返回字符数

---

### 4. 多媒体与画布

#### canvas - 控制节点画布
控制节点画布的呈现和交互。
- **参数：**
  - `action` (string): 操作类型
    - `present`: 呈现画布
    - `hide`: 隐藏画布
    - `navigate`: 导航
    - `eval`: 执行JavaScript
    - `snapshot`: 捕获UI
    - `a2ui_push`: A2UI推送
    - `a2ui_reset`: A2UI重置
  - `url` (string, 可选): 画布URL
  - `javaScript` (string, 可选): 要执行的JS代码
  - `jsonl` (string, 可选): JSONL数据
  - `jsonlPath` (string, 可选): JSONL文件路径
  - `target` (string, 可选): 目标 "sandbox"|"host"|"node"
  - `node` (string, 可选): 节点ID
  - `width` / `height` (number, 可选): 画布尺寸
  - `outputFormat` (string, 可选): "png"|"jpg"|"jpeg"
  - `quality` (number, 可选): 质量
  - `timeoutMs` (number, 可选): 超时毫秒数

#### tts - 文字转语音
将文本转换为语音。
- **参数：**
  - `text` (string): 要转换的文本
  - `channel` (string, 可选): 频道ID（选择输出格式）
- **返回：** MEDIA: 音频文件路径

---

### 5. 节点设备管理

#### nodes - 发现和控制配对节点
发现、描述和控制在不同位置配对的节点。
- **参数：**
  - `action` (string): 操作类型
    - `status`: 节点状态
    - `describe`: 描述节点
    - `pending`: 待处理节点
    - `approve`: 批准节点
    - `reject`: 拒绝节点
    - `notify`: 发送通知
    - `camera_snap`: 摄像头快照
    - `camera_list`: 摄像头列表
    - `camera_clip`: 摄像头剪辑
    - `screen_record`: 屏幕录制
    - `location_get`: 获取位置
    - `run`: 运行命令
    - `invoke`: 调用命令
  - `node` (string, 可选): 节点ID
  - `deviceId` (string, 可选): 设备ID
  - `command` (array, 可选): 命令数组
  - `cwd` (string, 可选): 工作目录
  - `env` (array, 可选): 环境变量
  - `facing` (string, 可选): 摄像头方向 "front"|"back"|"both"
  - `fps` (number, 可选): 帧率
  - `duration` (string, 可选): 持续时间
  - `durationMs` (number, 可选): 持续毫秒数
  - `includeAudio` (boolean, 可选): 包含音频
  - `maxWidth` (number, 可选): 最大宽度
  - `quality` (number, 可选): 质量
  - `outPath` (string, 可选): 输出路径
  - `locationTimeoutMs` (number, 可选): 位置超时
  - `desiredAccuracy` (string, 可选): 精度 "coarse"|"balanced"|"precise"
  - `maxAgeMs` (number, 可选): 最大年龄
  - `invokeCommand` (string, 可选): 调用命令
  - `invokeParamsJson` (string, 可选): 调用参数JSON
  - `invokeTimeoutMs` (number, 可选): 调用超时

---

### 6. 消息与通知

#### message - 发送和管理消息
通过频道插件发送、删除和管理消息。
- **参数：**
  - `action` (string): 操作类型 "send"|"broadcast"
  - `channel` (string, 可选): 频道类型
    - `telegram`| `whatsapp`| `discord`| `googlechat`| `slack`| `signal`| `imessage`
  - `to` (string, 可选): 收件人
  - `message` (string, 可选): 消息内容
  - `media` (string, 可选): 媒体URL或路径
  - `filePath` (string, 可选): 文件路径
  - `buffer` (string, 可选): Base64附件
  - `caption` (string, 可选): 媒体标题
  - `mimeType` (string, 可选): MIME类型
  - `replyTo` (string, 可选): 回复消息ID
  - `quoteText` (string, 可选): Telegram引用文本
  - `pollQuestion` (string, 可选): 投票问题
  - `pollOption` (array, 可选): 投票选项
  - `pollDurationHours` (number, 可选): 投票持续小时
  - `pollMulti` (boolean, 可选): 多选
  - `stickerId` (array, 可选): 贴纸ID
  - `stickerName` (string, 可选): 贴纸名称
  - `effectId` (string, 可选): 消息效果
  - `emoji` (string, 可选): 表情
  - `silent` (boolean, 可选): 静默发送
  - `threadId` (string, 可选): 话题ID
  - `threadName` (string, 可选): 话题名称
  - `groupId` (string, 可选): 群组ID
  - `guildId` (string, 可选): Discord服务器ID
  - `roleId` / `roleIds` (string/array, 可选): 角色ID
  - `topic` (string, 可选): 话题
  - `parentId` (string, 可选): 父ID
  - `categoryId` (string, 可选): 分类ID
  - `position` (number, 可选): 位置
  - `nsfw` (boolean, 可选): NSFW标记
  - `autoArchiveMin` (number, 可选): 自动归档分钟
  - `rateLimitPerUser` (number, 可选): 用户限速
  - `dryRun` (boolean, 可选): 试运行

**活动/状态：**
- `activityType` (string): "playing"|"streaming"|"listening"|"watching"|"competing"|"custom"
- `activityName` (string): 活动名称
- `activityState` (string): 活动状态
- `activityUrl` (string): 活动URL
- `status` (string): "online"|"dnd"|"idle"|"invisible"

**事件：**
- `eventName` (string): 事件名称
- `eventType` (string): 事件类型
- `startTime` / `endTime` (string): 时间
- `location` (string): 地点
- `desc` (string): 描述
- `durationMin` (number): 持续分钟

---

### 7. 任务调度

#### cron - 管理Cron任务
管理Gateway cron任务和唤醒事件。
- **参数：**
  - `action` (string): 操作类型
    - `status`: 检查cron调度器状态
    - `list`: 列出任务
    - `add`: 创建任务
    - `update`: 修改任务
    - `remove`: 删除任务
    - `run`: 立即触发任务
    - `runs`: 获取任务运行历史
    - `wake`: 发送唤醒事件
  - `job` (object, 可选): 任务对象
  - `jobId` / `id` (string, 可选): 任务ID
  - `patch` (object, 可选): 补丁对象
  - `text` (string, 可选): 唤醒文本
  - `mode` (string, 可选): 唤醒模式 "now"|"next-heartbeat"
  - `includeDisabled` (boolean, 可选): 包含禁用任务
  - `contextMessages` (number, 可选): 上下文消息数量

**任务模式 (schedule.kind)：**
- `at`: 一次性在绝对时间
  ```json
  { "kind": "at", "at": "<ISO-8601 timestamp>" }
  ```
- `every`: 重复间隔
  ```json
  { "kind": "every", "everyMs": <interval-ms>, "anchorMs": <optional-start-ms> }
  ```
- `cron`: Cron表达式
  ```json
  { "kind": "cron", "expr": "<cron-expression>", "tz": "<optional-timezone>" }
  ```

**负载类型 (payload.kind)：**
- `systemEvent`: 注入文本作为系统事件
  ```json
  { "kind": "systemEvent", "text": "<message>" }
  ```
- `agentTurn`: 运行代理（仅隔离会话）
  ```json
  { "kind": "agentTurn", "message": "<prompt>", "model": "<optional>", "thinking": "<optional>", "timeoutSeconds": <optional> }
  ```

**投递（仅隔离会话）：**
```json
{
  "mode": "none|announce",
  "channel": "<optional>",
  "to": "<optional>",
  "bestEffort": <optional-bool>
}
```

---

### 8. 网关管理

#### gateway - 管理Gateway守护进程
重启、应用配置或更新运行中的OpenClaw进程。
- **参数：**
  - `action` (string): 操作类型
    - `restart`: 重启Gateway
    - `config.get`: 获取配置
    - `config.schema`: 获取配置Schema
    - `config.apply`: 应用完整配置
    - `config.patch`: 安全的部分配置更新
    - `update.run`: 运行更新
  - `sessionKey` (string, 可选): 会话密钥
  - `raw` (string, 可选): 原始配置
  - `baseHash` (string, 可选): 基础哈希
  - `note` (string, 可选): 备注
  - `reason` (string, 可选): 原因
  - `restartDelayMs` (number, 可选): 重启延迟
  - `delayMs` (number, 可选): 延迟
  - `timeoutMs` (number, 可选): 超时

---

### 9. 会话管理

#### agents_list - 列出可用代理
列出允许用于sessions_spawn的代理ID。
- **参数：** 无
- **返回：** 可用代理ID列表

#### sessions_list - 列出会话
列出可选过滤条件和最后消息的会话。
- **参数：**
  - `activeMinutes` (number, 可选): 活跃分钟数过滤
  - `kinds` (array, 可选): 会话类型过滤
  - `limit` (number, 可选): 结果限制
  - `messageLimit` (number, 可选): 消息数量限制
- **返回：** 会话列表

#### sessions_history - 获取会话历史
获取会话的消息历史。
- **参数：**
  - `sessionKey` (string): 会话密钥
  - `includeTools` (boolean, 可选): 包含工具调用
  - `limit` (number, 可选): 消息限制
- **返回：** 会话历史

#### sessions_send - 发送消息到会话
发送消息到另一个会话。
- **参数：**
  - `sessionKey` / `label` (string): 目标会话标识
  - `message` (string): 消息内容
  - `agentId` (string, 可选): 代理ID
  - `timeoutSeconds` (number, 可选): 超时秒数
- **返回：** 发送结果

#### sessions_spawn - 生成子代理会话
在隔离会话中生成后台子代理运行。
- **参数：**
  - `task` (string): 任务描述
  - `agentId` (string, 可选): 代理ID
  - `label` (string, 可选): 会话标签
  - `model` (string, 可选): 模型覆盖
  - `thinking` (string, 可选): 思考模式 "on"|"off"|"stream"
  - `timeoutSeconds` / `runTimeoutSeconds` (number, 可选): 超时
  - `cleanup` (string, 可选): 清理策略 "delete"|"keep"
- **返回：** 子代理结果

#### session_status - 显示会话状态
显示会话状态卡片（使用量+时间+成本）。
- **参数：**
  - `sessionKey` (string, 可选): 会话密钥
  - `model` (string, 可选): 模型覆盖
- **返回：** 状态卡片

---

### 10. 内存/记忆系统

#### memory_search - 语义搜索记忆
在MEMORY.md和memory/*.md中语义搜索。
- **参数：**
  - `query` (string): 搜索查询
  - `maxResults` (number, 可选): 最大结果数
  - `minScore` (number, 可选): 最小分数
- **返回：** 搜索结果（路径+行号）

#### memory_get - 安全读取记忆片段
从MEMORY.md或memory/*.md安全读取片段。
- **参数：**
  - `path` (string): 文件路径
  - `from` (number, 可选): 起始行
  - `lines` (number, 可选): 行数
- **返回:** 文件片段

---

## 技能 (Skills)

### healthcheck - 健康检查
主机安全加固和OpenClaw部署的风险容忍配置。
- **用途：**
  - 安全审计
  - 防火墙/SSH/更新加固
  - 风险态势评估
  - 暴露审查
  - OpenClaw cron调度（定期检查）
  - 机器版本状态检查
- **适用场景：** 运行OpenClaw的机器（笔记本、工作站、Pi、VPS）

### skill-creator - 技能创建
创建或更新AgentSkills。
- **用途：**
  - 设计技能结构
  - 打包技能（脚本、引用、资源）
- **适用场景：** 开发自定义技能

---

## OpenClaw CLI 命令

### Gateway 管理
```bash
openclaw gateway status     # 查看状态
openclaw gateway start      # 启动
openclaw gateway stop       # 停止
openclaw gateway restart    # 重启
```

### 配置
```bash
openclaw configure --section web    # 配置web设置（Brave API等）
openclaw status                     # 查看状态
openclaw help                       # 获取帮助
```

### 其他命令
```bash
openclaw config.get      # 获取配置
openclaw config.schema   # 获取配置Schema
openclaw config.apply    # 应用配置
openclaw config.patch    # 补丁配置
openclaw update.run      # 运行更新
```

---

## 使用场景示例

### 场景1：信息查询
```
用户："帮我查一下今天的天气"
→ web_search + web_fetch
```

### 场景2：文件操作
```
用户："读取 config.json 并修改某个值"
→ read + edit
```

### 场景3：自动化任务
```
用户："每天早上9点提醒我喝水"
→ cron.add (schedule: cron每日9点, payload: systemEvent提醒)
```

### 场景4：网页操作
```
用户："打开百度搜索 OpenClaw"
→ browser.open (bilibili.com) → browser.snapshot → browser.act
```

### 场景5：多媒体
```
用户："把这个故事用语音读出来"
→ tts (text: 故事内容)
```

### 场景6：会话管理
```
用户："让子代理帮我整理文件夹"
→ sessions_spawn (task: 整理文件夹, cleanup: delete)
```

### 场景7：设备控制
```
用户："拍一张客厅的照片"
→ nodes.action: camera_snap, node: living-room
```

### 场景8：消息发送
```
用户："在微信群里发这个通知"
→ message.action: send, channel: whatsapp, to: 群ID, message: 通知内容
```

---

## 重要提醒

1. **安全第一：** 不要执行未经验证的命令或代码
2. **备份数据：** 重要操作前先备份
3. **检查权限：** 外发消息前确认授权
4. **资源管理：** 大量任务使用后台执行
5. **持续学习：** OpenClaw在不断更新

---

*文档由 OpenClaw 自动生成*
