# NutBot 步骤更新中间件系统

## 概述

NutBot 前端提供了一个中间件系统，允许你在 AI 执行过程的每个步骤中插入自定义逻辑。这非常适合集成飞书、钉钉、企业微信等通知渠道，将执行过程实时推送到外部系统。

## 核心概念

### 中间件函数签名

```typescript
type StepUpdateMiddleware = (
  type: StepUpdateType,
  chunk: StepChunk,
  context: StepContext
) => void;

type StepUpdateType =
  | 'thinking'    // AI 思考内容更新
  | 'summary'     // 步骤总结内容更新
  | 'tool_start'  // 工具开始执行
  | 'tool_result' // 工具执行完成
  | 'tool_error'; // 工具执行失败

interface StepChunk {
  step?: number;      // 当前步骤序号
  content?: string;   // 内容（thinking/summary）
  tool?: string;      // 工具名称
  action?: string;    // 工具操作
  args?: any;         // 工具参数
  description?: string; // 工具描述
  result?: any;       // 工具执行结果
  error?: string;     // 错误信息
}

interface StepContext {
  sessionId: string;           // 当前会话ID
  messages: Message[];         // 当前消息列表
  currentStep: Step | null;    // 当前步骤信息
  processingSteps: Step[];     // 所有处理中的步骤
  toolExecutions: ToolExec[];  // 工具执行历史
  timestamp: string;           // ISO 时间戳
}
```

## 使用方法

### 1. 注册中间件

```javascript
import { useAppStore } from '../stores/app.js';

const store = useAppStore();

// 定义中间件
const myMiddleware = (type, chunk, context) => {
  console.log(`[步骤更新] ${type}:`, chunk);
  // 在这里发送通知到飞书/钉钉等
};

// 注册中间件
store.registerStepUpdateMiddleware(myMiddleware);
```

### 2. 注销中间件

```javascript
// 当你不再需要时注销
store.unregisterStepUpdateMiddleware(myMiddleware);
```

### 3. 在 Vue 组件中使用

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../stores/app.js';

const store = useAppStore();

onMounted(() => {
  // 注册中间件
  store.registerStepUpdateMiddleware(feishuMiddleware);
});

onUnmounted(() => {
  // 组件卸载时注销
  store.unregisterStepUpdateMiddleware(feishuMiddleware);
});
</script>
```

## 示例：飞书集成

参见 [feishu-example.js](./feishu-example.js) 文件，包含完整的飞书机器人集成示例。

### 快速开始

```javascript
import { initFeishuMiddleware } from './middlewares/feishu-example.js';

// 在应用启动时初始化
const unregister = initFeishuMiddleware({
  webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-url',
  includeToolResults: true,
});

// 需要时可以注销
// unregister();
```

## 触发时机

中间件会在以下时机被触发：

1. **`thinking`** - 当 AI 产生新的思考内容时
2. **`summary`** - 当 AI 产生步骤总结时
3. **`tool_start`** - 当工具开始执行时
4. **`tool_result`** - 当工具执行成功完成时
5. **`tool_error`** - 当工具执行失败时

## 最佳实践

### 1. 异步处理

中间件是同步执行的，如果需要发送网络请求，建议：

```javascript
const middleware = (type, chunk, context) => {
  // 使用 Promise 异步处理，不阻塞主流程
  Promise.resolve().then(async () => {
    await sendToFeishu(formatMessage(type, chunk));
  });
};
```

### 2. 错误处理

中间件执行错误不会影响主流程，但建议自行捕获错误：

```javascript
const middleware = (type, chunk, context) => {
  try {
    // 你的逻辑
  } catch (error) {
    console.error('[中间件错误]', error);
  }
};
```

### 3. 消息队列

如果发送到外部 API 有限流，建议实现消息队列：

```javascript
const messageQueue = [];
let isProcessing = false;

const middleware = (type, chunk, context) => {
  messageQueue.push({ type, chunk, context });
  processQueue();
};

const processQueue = async () => {
  if (isProcessing || messageQueue.length === 0) return;
  isProcessing = true;

  while (messageQueue.length > 0) {
    const msg = messageQueue.shift();
    await sendToExternalAPI(msg);
    await new Promise((r) => setTimeout(r, 500)); // 限流
  }

  isProcessing = false;
};
```

## 扩展其他平台

你可以参考 `feishu-example.js` 创建其他平台的中间件：

- 钉钉机器人
- 企业微信
- Slack
- Discord
- 自定义 Webhook

只需实现相同的中间件函数签名即可。
