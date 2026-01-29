/**
 * NutBot 浏览器扩展 - Background Service Worker
 * 参考 Playwriter/Moltbot 设计
 * 
 * 功能：
 * 1. 用户点击扩展图标时，附加 chrome.debugger 到当前标签页
 * 2. 通过 WebSocket 连接到 NutBot Gateway 的 Relay 服务
 * 3. 转发 CDP 命令和事件
 */

import type { 
  ExtensionState, 
  TabInfo, 
  TabState, 
  ExtensionCommandMessage,
  ExtensionResponseMessage,
  TargetInfo
} from './types.js';

// ============================================================================
// 配置
// ============================================================================

// CDP Relay 端口（与 NutBot Gateway 配置的 browser.cdpRelayPort 一致，默认 18801）
const RELAY_PORT = 18801;
const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}/extension`;

// ============================================================================
// 状态管理
// ============================================================================

const state: ExtensionState = {
  tabs: new Map(),
  connectionState: 'idle',
  currentTabId: undefined,
  errorText: undefined,
};

let ws: WebSocket | null = null;
let nextSessionId = 1;
let messageId = 0;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// 等待响应的请求队列
const pendingRequests = new Map<number, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}>();

// 子会话映射（iframe 等）
const childSessions = new Map<string, { tabId: number; targetId?: string }>();

// ============================================================================
// 日志工具
// ============================================================================

function sendLog(level: string, ...args: unknown[]): void {
  const serialized = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  
  sendMessage({
    method: 'log',
    params: { level, args: serialized },
  });
}

const logger = {
  log: (...args: unknown[]) => { console.log('[NutBot]', ...args); sendLog('log', ...args); },
  debug: (...args: unknown[]) => { console.debug('[NutBot]', ...args); sendLog('debug', ...args); },
  info: (...args: unknown[]) => { console.info('[NutBot]', ...args); sendLog('info', ...args); },
  warn: (...args: unknown[]) => { console.warn('[NutBot]', ...args); sendLog('warn', ...args); },
  error: (...args: unknown[]) => { console.error('[NutBot]', ...args); sendLog('error', ...args); },
};

// ============================================================================
// WebSocket 连接管理
// ============================================================================

function sendMessage(message: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('发送消息失败:', error);
    }
  }
}

async function sendToRelay<T = unknown>(
  method: string, 
  params?: unknown, 
  timeout = 30000
): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay 未连接');
  }

  const id = ++messageId;
  const message = { id, method, params };

  ws.send(JSON.stringify(message));

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`请求超时: ${method}`));
    }, timeout);

    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeoutId);
        resolve(result as T);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });
  });
}

async function ensureConnection(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) {
    return;
  }

  if (state.connectionState === 'extension-replaced') {
    throw new Error('另一个 NutBot 扩展已连接');
  }

  await connect();
}

async function connect(): Promise<void> {
  logger.debug('正在连接到 Relay 服务器:', RELAY_URL);

  // 检查服务器是否可用
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${RELAY_PORT}`, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        logger.debug('Relay 服务器可用');
        break;
      }
    } catch {
      if (attempt === maxAttempts - 1) {
        throw new Error('Relay 服务器不可用');
      }
      logger.debug(`服务器不可用，重试中... (${attempt + 1}/${maxAttempts})`);
      await sleep(1000);
    }
  }

  // 建立 WebSocket 连接
  const socket = new WebSocket(RELAY_URL);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error('连接超时'));
    }, 5000);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error('WebSocket 连接失败'));
    };

    socket.onclose = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (event.code === 4002) {
        reject(new Error('另一个扩展已在使用中'));
      } else {
        reject(new Error(`连接关闭: ${event.reason || event.code}`));
      }
    };
  });

  ws = socket;

  // 设置消息处理
  ws.onmessage = async (event: MessageEvent) => {
    let message: ExtensionCommandMessage;
    try {
      message = JSON.parse(event.data as string);
    } catch {
      logger.error('解析消息失败');
      return;
    }

    // 处理 ping
    if (message.method === 'ping') {
      sendMessage({ method: 'pong' });
      return;
    }

    // 处理响应（我们发起的请求的回复）
    if ('id' in message && typeof message.id === 'number') {
      const pending = pendingRequests.get(message.id);
      if (pending) {
        pendingRequests.delete(message.id);
        const msg = message as unknown as ExtensionResponseMessage;
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }
    }

    // 自动创建初始标签页：NutBot 需要浏览器时，无已附加标签页则自动创建
    if (message.method === 'createInitialTab' && typeof message.id === 'number') {
      try {
        logger.info('NutBot 请求自动创建标签页');
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
        if (!tab.id) throw new Error('创建标签页失败');
        setTabState(tab.id, 'connecting');
        await sleep(100);
        const { targetInfo, sessionId } = await attachTab(tab.id, { skipAttachedEvent: true });
        sendMessage({
          id: message.id,
          result: { success: true, tabId: tab.id, sessionId, targetInfo },
        });
      } catch (error) {
        logger.error('自动创建标签页失败:', error);
        sendMessage({
          id: message.id,
          error: error instanceof Error ? error.message : '创建标签页失败',
        });
      }
      return;
    }

    // 处理 CDP 命令
    if (message.method === 'forwardCDPCommand' && message.params) {
      const response: ExtensionResponseMessage = { id: message.id || 0 };
      try {
        response.result = await handleCDPCommand(message);
      } catch (error) {
        response.error = error instanceof Error ? error.message : String(error);
      }
      sendMessage(response);
    }
  };

  ws.onclose = (event) => {
    handleDisconnect(event.reason, event.code);
  };

  ws.onerror = (event) => {
    logger.error('WebSocket 错误:', event);
  };

  // 注册 debugger 事件监听
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);

  // 启动 ping
  startPing();

  state.connectionState = 'connected';
  logger.info('已连接到 Relay 服务器');
}

function handleDisconnect(reason: string, code: number): void {
  logger.warn(`连接断开: code=${code} reason=${reason}`);

  stopPing();

  chrome.debugger.onEvent.removeListener(onDebuggerEvent);
  chrome.debugger.onDetach.removeListener(onDebuggerDetach);

  // 分离所有标签页
  for (const [tabId] of state.tabs) {
    chrome.debugger.detach({ tabId }).catch(() => {});
  }

  childSessions.clear();
  pendingRequests.clear();
  ws = null;

  if (code === 4001 || code === 4002) {
    state.connectionState = 'extension-replaced';
    state.errorText = '另一个 NutBot 扩展已连接';
  } else {
    state.connectionState = 'idle';
  }

  state.tabs.clear();
  updateAllIcons();
}

function startPing(): void {
  stopPing();
  pingInterval = setInterval(() => {
    sendMessage({ method: 'ping' });
  }, 5000);
}

function stopPing(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// ============================================================================
// CDP 命令处理
// ============================================================================

async function handleCDPCommand(msg: ExtensionCommandMessage): Promise<unknown> {
  const params = msg.params;
  if (!params?.method) {
    throw new Error('缺少 CDP 方法');
  }

  const method = params.method;
  const sessionId = params.sessionId;
  const cdpParams = params.params;

  // 找到目标标签页
  let targetTabId: number | undefined;
  let targetTab: TabInfo | undefined;

  if (sessionId) {
    for (const [tabId, tab] of state.tabs) {
      if (tab.sessionId === sessionId) {
        targetTabId = tabId;
        targetTab = tab;
        break;
      }
    }

    // 检查子会话
    if (!targetTab) {
      const child = childSessions.get(sessionId);
      if (child) {
        targetTabId = child.tabId;
        targetTab = state.tabs.get(child.tabId);
      }
    }
  }

  // 处理特殊命令
  switch (method) {
    case 'Target.setAutoAttach':
      // 对所有已连接标签页应用
      if (!sessionId) {
        const connectedTabs = Array.from(state.tabs.entries())
          .filter(([_, tab]) => tab.state === 'connected')
          .map(([tabId]) => tabId);
        
        for (const tabId of connectedTabs) {
          try {
            await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', cdpParams);
          } catch (e) {
            logger.debug(`为标签页 ${tabId} 设置 auto-attach 失败:`, e);
          }
        }
        return {};
      }
      break;

    case 'Target.createTarget': {
      const url = (cdpParams as { url?: string })?.url || 'about:blank';
      const tab = await chrome.tabs.create({ url, active: false });
      if (!tab.id) throw new Error('创建标签页失败');
      
      setTabState(tab.id, 'connecting');
      await sleep(100);
      const { targetInfo } = await attachTab(tab.id);
      return { targetId: targetInfo.targetId };
    }

    case 'Target.closeTarget': {
      const closeTargetId = (cdpParams as { targetId?: string })?.targetId;
      const closeBrowser = (cdpParams as { closeBrowser?: boolean })?.closeBrowser;
      let tabIdToClose: number | undefined = targetTabId;
      
      // 通过 targetId 查找 tabId
      if (closeTargetId && !tabIdToClose) {
        for (const [tabId, tab] of state.tabs) {
          if (tab.targetId === closeTargetId) {
            tabIdToClose = tabId;
            break;
          }
        }
      }
      
      if (!tabIdToClose) {
        logger.warn(`Target.closeTarget: 未找到 targetId=${closeTargetId} 对应的标签页`);
        return { success: false };
      }
      
      // 获取标签页所在的窗口
      let windowId: number | undefined;
      try {
        const tab = await chrome.tabs.get(tabIdToClose);
        windowId = tab.windowId;
      } catch {
        // 忽略
      }
      
      logger.info(`关闭标签页: tabId=${tabIdToClose} targetId=${closeTargetId} closeBrowser=${closeBrowser}`);
      
      // 先从状态中移除，防止重复处理
      state.tabs.delete(tabIdToClose);
      
      // 先分离 debugger，避免干扰标签页关闭
      try {
        await chrome.debugger.detach({ tabId: tabIdToClose });
        logger.debug(`已分离 debugger: tabId=${tabIdToClose}`);
      } catch (e) {
        logger.debug(`分离 debugger 失败（可能已分离）: ${(e as Error).message}`);
      }
      
      // 如果要关闭整个浏览器窗口
      if (closeBrowser && windowId) {
        try {
          await chrome.windows.remove(windowId);
          logger.info(`浏览器窗口已关闭: windowId=${windowId}`);
          return { success: true, closedWindow: true };
        } catch (e) {
          logger.error(`关闭浏览器窗口失败: ${(e as Error).message}`);
          // 回退到关闭标签页
        }
      }
      
      // 关闭标签页
      try {
        await chrome.tabs.remove(tabIdToClose);
        logger.info(`标签页已关闭: tabId=${tabIdToClose}`);
      } catch (e) {
        logger.error(`关闭标签页失败: ${(e as Error).message}`);
        throw e;
      }
      
      return { success: true };
    }
  }

  // 通用 CDP 命令转发
  if (!targetTabId || !targetTab) {
    throw new Error(`找不到会话 ${sessionId} 对应的标签页`);
  }

  const debuggee: chrome.debugger.DebuggerSession = {
    tabId: targetTabId,
    sessionId: sessionId !== targetTab.sessionId ? sessionId : undefined,
  };

  return await chrome.debugger.sendCommand(debuggee, method, cdpParams);
}

// ============================================================================
// Debugger 事件处理
// ============================================================================

function onDebuggerEvent(
  source: chrome.debugger.DebuggerSession, 
  method: string, 
  params: unknown
): void {
  const tabId = source.tabId;
  if (!tabId) return;

  const tab = state.tabs.get(tabId);
  if (!tab) return;

  logger.debug('CDP 事件:', method, 'from tab:', tabId);

  // 跟踪子会话
  if (method === 'Target.attachedToTarget') {
    const p = params as { sessionId?: string; targetInfo?: TargetInfo };
    if (p.sessionId) {
      childSessions.set(p.sessionId, { tabId, targetId: p.targetInfo?.targetId });
    }
  }

  if (method === 'Target.detachedFromTarget') {
    const p = params as { sessionId?: string };
    if (p.sessionId) {
      childSessions.delete(p.sessionId);
    }
  }

  // 转发事件给 Relay
  sendMessage({
    method: 'forwardCDPEvent',
    params: {
      sessionId: source.sessionId || tab.sessionId,
      method,
      params,
    },
  });
}

function onDebuggerDetach(
  source: chrome.debugger.Debuggee, 
  reason: chrome.debugger.DetachReason
): void {
  const tabId = source.tabId;
  if (!tabId || !state.tabs.has(tabId)) return;

  logger.warn(`Debugger 分离: tabId=${tabId} reason=${reason}`);

  const tab = state.tabs.get(tabId);
  if (tab?.sessionId && tab?.targetId) {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    });
  }

  // 清理子会话
  for (const [sid, child] of childSessions.entries()) {
    if (child.tabId === tabId) {
      childSessions.delete(sid);
    }
  }

  state.tabs.delete(tabId);
  updateIcon(tabId);
}

// ============================================================================
// 标签页管理
// ============================================================================

async function attachTab(
  tabId: number,
  options: { skipAttachedEvent?: boolean } = {}
): Promise<{ targetInfo: TargetInfo; sessionId: string }> {
  const { skipAttachedEvent = false } = options;
  const debuggee = { tabId };

  logger.debug('附加 debugger 到标签页:', tabId);
  await chrome.debugger.attach(debuggee, '1.3');

  await chrome.debugger.sendCommand(debuggee, 'Page.enable');

  const result = await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo') as {
    targetInfo: TargetInfo;
  };

  const targetInfo = result.targetInfo;
  const sessionId = `nutbot-tab-${nextSessionId++}`;
  const attachOrder = nextSessionId;

  state.tabs.set(tabId, {
    sessionId,
    targetId: targetInfo.targetId,
    state: 'connected',
    attachOrder,
  });

  // 通知 Relay（自动创建标签页时由 Relay 从 createInitialTab 响应中下发，不重复发事件）
  if (!skipAttachedEvent) {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    });
  }

  logger.info(`标签页已附加: tabId=${tabId} sessionId=${sessionId}`);
  updateIcon(tabId);

  return { targetInfo, sessionId };
}

function detachTab(tabId: number): void {
  const tab = state.tabs.get(tabId);
  if (!tab) return;

  logger.debug('分离标签页:', tabId);

  if (tab.sessionId && tab.targetId) {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    });
  }

  state.tabs.delete(tabId);

  // 清理子会话
  for (const [sid, child] of childSessions.entries()) {
    if (child.tabId === tabId) {
      childSessions.delete(sid);
    }
  }

  chrome.debugger.detach({ tabId }).catch(() => {});
  updateIcon(tabId);
}

function setTabState(tabId: number, tabState: TabState, errorText?: string): void {
  const existing = state.tabs.get(tabId);
  state.tabs.set(tabId, { ...existing, state: tabState, errorText });
  updateIcon(tabId);
}

// ============================================================================
// 图标管理
// ============================================================================

const icons = {
  connected: {
    '16': 'icons/icon-green-16.png',
    '32': 'icons/icon-green-32.png',
    '48': 'icons/icon-green-48.png',
    '128': 'icons/icon-green-128.png',
  },
  idle: {
    '16': 'icons/icon-gray-16.png',
    '32': 'icons/icon-gray-32.png',
    '48': 'icons/icon-gray-48.png',
    '128': 'icons/icon-gray-128.png',
  },
  connecting: {
    '16': 'icons/icon-gray-16.png',
    '32': 'icons/icon-gray-32.png',
    '48': 'icons/icon-gray-48.png',
    '128': 'icons/icon-gray-128.png',
  },
  error: {
    '16': 'icons/icon-gray-16.png',
    '32': 'icons/icon-gray-32.png',
    '48': 'icons/icon-gray-48.png',
    '128': 'icons/icon-gray-128.png',
  },
};

async function updateIcon(tabId?: number): Promise<void> {
  const tabInfo = tabId ? state.tabs.get(tabId) : undefined;
  const tabState = tabInfo?.state || 'idle';

  const iconSet = icons[tabState] || icons.idle;
  const badgeText = tabState === 'connected' ? 'ON' : 
                    tabState === 'connecting' ? '...' :
                    tabState === 'error' ? '!' : '';
  const badgeColor = tabState === 'connected' ? '#22c55e' : 
                     tabState === 'error' ? '#dc2626' : '#6b7280';
  const title = tabState === 'connected' ? '已连接 - 点击断开' :
                tabState === 'connecting' ? '正在连接...' :
                tabState === 'error' ? `错误: ${tabInfo?.errorText}` :
                '点击启用 NutBot 控制';

  await chrome.action.setIcon({ tabId, path: iconSet });
  await chrome.action.setBadgeText({ tabId, text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
  await chrome.action.setTitle({ tabId, title });
}

async function updateAllIcons(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      await updateIcon(tab.id);
    }
  }
}

// ============================================================================
// 用户交互
// ============================================================================

async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;

  // 检查是否是受限页面
  if (isRestrictedUrl(tab.url)) {
    logger.debug('无法控制受限页面:', tab.url);
    return;
  }

  const tabInfo = state.tabs.get(tab.id);

  // 如果已连接，断开
  if (tabInfo?.state === 'connected') {
    detachTab(tab.id);
    return;
  }

  // 如果正在连接，忽略
  if (tabInfo?.state === 'connecting') {
    return;
  }

  // 连接
  await connectTab(tab.id);
}

async function connectTab(tabId: number): Promise<void> {
  try {
    setTabState(tabId, 'connecting');

    await ensureConnection();
    await attachTab(tabId);

    logger.info(`标签页 ${tabId} 已连接`);
  } catch (error) {
    logger.error(`连接标签页 ${tabId} 失败:`, error);
    setTabState(tabId, 'error', error instanceof Error ? error.message : '未知错误');
  }
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return false;
  const restricted = ['chrome://', 'chrome-extension://', 'devtools://', 'edge://'];
  return restricted.some(prefix => url.startsWith(prefix));
}

// ============================================================================
// 工具函数
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 维持连接循环
// ============================================================================

async function maintainLoop(): Promise<void> {
  while (true) {
    if (ws?.readyState === WebSocket.OPEN) {
      await sleep(1000);
      continue;
    }

    // 如果被替换，等待轮询
    if (state.connectionState === 'extension-replaced') {
      try {
        const response = await fetch(`http://127.0.0.1:${RELAY_PORT}/extension/status`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        const data = await response.json() as { connected: boolean; activeTargets: number };
        if (!data.connected || data.activeTargets === 0) {
          state.connectionState = 'idle';
          state.errorText = undefined;
          logger.debug('扩展插槽已释放');
        }
      } catch {
        // 服务器不可用
      }
      await sleep(3000);
      continue;
    }

    // 始终尝试连接 Relay（便于 NutBot 自动创建标签页时无需用户先点击）
    const connectingTabs = Array.from(state.tabs.entries())
      .filter(([_, t]) => t.state === 'connecting')
      .map(([id]) => id);

    try {
      await ensureConnection();

      // 若有等待中的标签页，重新附加
      for (const tabId of connectingTabs) {
        try {
          await chrome.tabs.get(tabId);
          await attachTab(tabId);
        } catch {
          state.tabs.delete(tabId);
          updateIcon(tabId);
        }
      }
    } catch (error) {
      logger.debug('连接 Relay 失败:', error);
    }

    await sleep(3000);
  }
}

// ============================================================================
// 初始化
// ============================================================================

// 清理已有的 debugger 连接
async function resetDebugger(): Promise<void> {
  const targets = await chrome.debugger.getTargets();
  for (const target of targets) {
    if (target.tabId && target.attached) {
      await chrome.debugger.detach({ tabId: target.tabId }).catch(() => {});
    }
  }
}

// 注册事件监听
chrome.action.onClicked.addListener(onActionClicked);
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.tabs.has(tabId)) {
    detachTab(tabId);
  }
});
chrome.tabs.onActivated.addListener((info) => {
  state.currentTabId = info.tabId;
  updateIcon(info.tabId);
});

// 启动
resetDebugger().then(() => {
  maintainLoop();
  updateAllIcons();
});

logger.info('NutBot 浏览器扩展已启动');
