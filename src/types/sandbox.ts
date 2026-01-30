/**
 * 沙盒安全系统类型定义
 */

// 沙盒模式
export type SandboxMode = 'strict' | 'standard' | 'trust';

// 操作类型
export type OperationType = 
  | 'click'           // 点击
  | 'type'            // 输入文字
  | 'key'             // 按键
  | 'hotkey'          // 快捷键
  | 'scroll'          // 滚动
  | 'openApp'         // 打开应用
  | 'openUrl'         // 打开网址
  | 'sendMessage'     // 发送消息
  | 'fileCreate'      // 创建文件
  | 'fileModify'      // 修改文件
  | 'fileDelete'      // 删除文件
  | 'fileRead'        // 读取文件
  | 'execCommand'     // 执行命令
  | 'installSoftware' // 安装软件
  | 'systemSettings'  // 系统设置
  | 'payment'         // 支付操作
  | 'unknown';        // 未知操作

// 安全检查结果
export interface SecurityCheckResult {
  allowed: boolean;
  action: 'allow' | 'confirm' | 'block';
  reason?: string;
  message?: string;           // 显示给用户的消息
  confirmMessage?: string;    // 确认对话框的消息
  category?: 'forbidden' | 'sensitive' | 'sandbox';
}

// 操作信息
export interface OperationInfo {
  type: OperationType;
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
  description?: string;
  // 文件操作相关
  filePath?: string;
  // 命令执行相关
  command?: string;
  // 消息发送相关
  recipient?: string;
  messageContent?: string;
}

// 沙盒配置
export interface SandboxConfig {
  mode: SandboxMode;
  
  // 需要确认的操作（按模式不同有不同默认值）
  confirm: {
    click: boolean;
    type: boolean;
    key: boolean;
    hotkey: boolean;
    scroll: boolean;
    openApp: boolean;
    openUrl: boolean;
    sendMessage: boolean;
    fileCreate: boolean;
    fileModify: boolean;
    fileDelete: boolean;
    fileRead: boolean;
    execCommand: boolean;
    installSoftware: boolean;
    systemSettings: boolean;
  };
  
  // AI 行为配置
  ai: {
    explainBeforeAction: 'required' | 'suggested' | 'optional';
    verifyAfterAction: boolean;
    canAskConfirm: boolean;
    autoChooseOnAmbiguity: boolean;
  };
  
  // 超时设置（毫秒，0 = 无超时）
  confirmTimeout: number;
}

// 敏感文件模式
export interface SensitivePattern {
  pattern: RegExp;
  category: string;
  description: string;
}

// 危险命令模式
export interface DangerousCommand {
  pattern: RegExp;
  category: string;
  description: string;
  severity: 'block' | 'confirm';  // block = 绝对禁止, confirm = 需要确认
}

// 预设配置
export const SANDBOX_PRESETS: Record<SandboxMode, SandboxConfig> = {
  // 严格模式：所有操作都需要确认
  strict: {
    mode: 'strict',
    confirm: {
      click: true,
      type: true,
      key: true,
      hotkey: true,
      scroll: false,  // 滚动不需要确认
      openApp: true,
      openUrl: true,
      sendMessage: true,
      fileCreate: true,
      fileModify: true,
      fileDelete: true,
      fileRead: true,
      execCommand: true,
      installSoftware: true,
      systemSettings: true,
    },
    ai: {
      explainBeforeAction: 'required',
      verifyAfterAction: true,
      canAskConfirm: true,
      autoChooseOnAmbiguity: false,
    },
    confirmTimeout: 30000,
  },
  
  // 标准模式：敏感操作需要确认
  standard: {
    mode: 'standard',
    confirm: {
      click: false,
      type: false,
      key: false,
      hotkey: false,
      scroll: false,
      openApp: false,
      openUrl: false,
      sendMessage: true,   // 发送消息需要确认
      fileCreate: false,
      fileModify: false,
      fileDelete: true,    // 删除文件需要确认
      fileRead: false,
      execCommand: false,  // 普通命令不需要（危险命令由安全层拦截）
      installSoftware: true,
      systemSettings: true,
    },
    ai: {
      explainBeforeAction: 'suggested',
      verifyAfterAction: false,
      canAskConfirm: false,  // 不允许 AI 主动确认
      autoChooseOnAmbiguity: false,
    },
    confirmTimeout: 60000,
  },
  
  // 信任模式：只有安全底线需要确认
  trust: {
    mode: 'trust',
    confirm: {
      click: false,
      type: false,
      key: false,
      hotkey: false,
      scroll: false,
      openApp: false,
      openUrl: false,
      sendMessage: false,  // 信任模式下不确认
      fileCreate: false,
      fileModify: false,
      fileDelete: false,   // 信任模式下不确认（但敏感文件仍会拦截）
      fileRead: false,
      execCommand: false,
      installSoftware: false,
      systemSettings: false,
    },
    ai: {
      explainBeforeAction: 'optional',
      verifyAfterAction: false,
      canAskConfirm: false,
      autoChooseOnAmbiguity: true,
    },
    confirmTimeout: 0,  // 无超时
  },
};

// 沙盒模式描述（用于 prompt）
export const SANDBOX_DESCRIPTIONS: Record<SandboxMode, string> = {
  strict: `🔒 严格模式
- 所有操作都需要用户确认
- 每步操作前必须说明意图
- 操作后必须验证结果`,

  standard: `⚖️ 标准模式
- 普通操作直接执行
- 发送消息、删除文件、安装软件需要确认
- 危险命令会被系统拦截`,

  trust: `🚀 信任模式
- 大部分操作直接执行
- 只有安全底线操作需要确认（密钥读取、支付等）
- 遇到歧义会自动选择最可能的选项`,
};
