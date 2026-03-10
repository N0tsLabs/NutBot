/**
 * NutBot 任务系统类型定义
 */

/** 任务状态 */
export type TaskStatus =
  | 'pending'      // 待执行
  | 'analyzing'    // 分析中
  | 'planning'     // 规划中
  | 'executing'    // 执行中
  | 'reviewing'    // 检验中
  | 'completed'    // 已完成
  | 'failed';     // 失败

/** 步骤状态 */
export type StepStatus =
  | 'pending'      // 待执行
  | 'running'      // 执行中
  | 'completed'    // 完成
  | 'failed';      // 失败

/** 任务类型 */
export type TaskType =
  | 'search'       // 搜索
  | 'browse'       // 浏览网页
  | 'desktop'      // 桌面操作
  | 'execute'      // 执行命令
  | 'question'     // 问答
  | 'unknown';     // 未知

/** 单个任务步骤 */
export interface TaskStep {
  id: string;
  order: number;                    // 步骤序号
  description: string;              // 步骤描述
  tool: string;                    // 使用的工具
  params: Record<string, unknown>; // 工具参数
  status: StepStatus;              // 步骤状态
  result?: StepResult;             // 执行结果
  error?: string;                  // 错误信息
  startedAt?: string;              // 开始时间
  completedAt?: string;            // 完成时间
}

/** 步骤执行结果 */
export interface StepResult {
  success: boolean;
  data?: unknown;
  content?: string;
  message?: string;
}

/** 任务计划 */
export interface TaskPlan {
  id: string;
  type: TaskType;                  // 任务类型
  originalInput: string;            // 用户原始输入
  successCriteria: string;          // 成功标准
  steps: TaskStep[];               // 步骤列表
  currentStepIndex: number;         // 当前步骤索引
  status: TaskStatus;               // 任务状态
  createdAt: string;                // 创建时间
  updatedAt: string;                // 更新时间
  completedAt?: string;             // 完成时间
}

/** 检验结果 */
export interface ReviewResult {
  passed: boolean;
  reason: string;                   // 检验原因
  data?: unknown;                   // 提取的数据
  nextAction?: 'continue' | 'retry' | 'complete';
  message?: string;                 // 反馈给用户的消息
}

/** Analyzer 输出 */
export interface AnalyzerOutput {
  type: TaskType;
  successCriteria: string;
  steps: Omit<TaskStep, 'id' | 'status' | 'result' | 'error' | 'startedAt' | 'completedAt'>[];
}

/** Executor 输出 */
export interface ExecutorOutput {
  stepResults: StepResult[];
  hasMoreSteps: boolean;
}

/** Reviewer 输入 */
export interface ReviewerInput {
  taskPlan: TaskPlan;
  executorOutput: ExecutorOutput;
}

/** 任务执行上下文 */
export interface TaskContext {
  sessionId: string;
  taskPlan: TaskPlan;
  messages: ContextMessage[];
  metadata: Record<string, unknown>;
}

/** 上下文消息 */
export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: string;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: StepResult;
}

/** Agent 配置 */
export interface AgentConfig {
  model: string;
  maxIterations: number;
  timeout: number;
  temperature: number;
}

/** 任务调度器事件 */
export type TaskEvent =
  | { type: 'task:start'; taskPlan: TaskPlan }
  | { type: 'task:step-start'; step: TaskStep }
  | { type: 'task:step-complete'; step: TaskStep }
  | { type: 'task:step-error'; step: TaskStep; error: string }
  | { type: 'task:review'; taskPlan: TaskPlan }
  | { type: 'task:complete'; taskPlan: TaskPlan; result: ReviewResult }
  | { type: 'task:failed'; taskPlan: TaskPlan; error: string };

/** 任务调度器接口 */
export interface ITaskScheduler {
  startTask(input: string, context: TaskContext): AsyncGenerator<TaskEvent>;
  pauseTask(taskId: string): void;
  resumeTask(taskId: string): void;
  cancelTask(taskId: string): void;
  getTask(taskId: string): TaskPlan | undefined;
}

/** Analyzer 接口 */
export interface IAnalyzer {
  analyze(input: string, context?: TaskContext): Promise<AnalyzerOutput>;
}

/** Executor 接口 */
export interface IExecutor {
  execute(plan: TaskPlan, context: TaskContext): AsyncGenerator<ExecutorOutput>;
}

/** Reviewer 接口 */
export interface IReviewer {
  review(input: ReviewerInput): Promise<ReviewResult>;
}
