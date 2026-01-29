/**
 * NutBot 浏览器扩展类型定义
 * 参考 Playwriter/Moltbot 设计
 */

// 标签页状态
export type TabState = 'idle' | 'connecting' | 'connected' | 'error';

// 标签页信息
export interface TabInfo {
  sessionId?: string;
  targetId?: string;
  state: TabState;
  errorText?: string;
  attachOrder?: number;
}

// 扩展全局状态
export interface ExtensionState {
  tabs: Map<number, TabInfo>;
  connectionState: 'idle' | 'connected' | 'extension-replaced';
  currentTabId?: number;
  errorText?: string;
}

// CDP Target 信息
export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
  browserContextId?: string;
}

// 扩展发送给 Relay 的消息
export interface ExtensionCommandMessage {
  id?: number;
  method: string;
  params?: {
    method?: string;
    sessionId?: string;
    params?: unknown;
    [key: string]: unknown;
  };
}

// Relay 回复给扩展的消息
export interface ExtensionResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
}

// 扩展转发的 CDP 事件
export interface ExtensionEventMessage {
  method: 'forwardCDPEvent';
  params: {
    sessionId?: string;
    method: string;
    params?: unknown;
  };
}

// 扩展日志消息
export interface ExtensionLogMessage {
  method: 'log';
  params: {
    level: string;
    args: string[];
  };
}

// 统一消息类型
export type ExtensionMessage = 
  | ExtensionResponseMessage 
  | ExtensionEventMessage 
  | ExtensionLogMessage
  | { method: 'pong' };
