/**
 * 安全检查服务
 * 沙盒系统的核心防线，在执行层拦截危险操作
 */

import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config.js';
import type {
  SandboxMode,
  SandboxConfig,
  OperationType,
  OperationInfo,
  SecurityCheckResult,
  SensitivePattern,
  DangerousCommand,
} from '../types/sandbox.js';
import { SANDBOX_PRESETS } from '../types/sandbox.js';

// ============================================================
// 全局安全规则（硬编码，无法通过配置绕过）
// ============================================================

/**
 * 敏感文件模式 - 这些文件的访问需要强制确认
 */
const SENSITIVE_FILE_PATTERNS: SensitivePattern[] = [
  // 密钥/密码文件
  { pattern: /\.env$/i, category: 'secret', description: '环境变量文件（可能包含密钥）' },
  { pattern: /\.env\.[^/\\]+$/i, category: 'secret', description: '环境变量文件' },
  { pattern: /password/i, category: 'secret', description: '密码文件' },
  { pattern: /credential/i, category: 'secret', description: '凭证文件' },
  { pattern: /secret/i, category: 'secret', description: '密钥文件' },
  { pattern: /\.pem$/i, category: 'secret', description: 'PEM 密钥文件' },
  { pattern: /\.key$/i, category: 'secret', description: '私钥文件' },
  { pattern: /\.pfx$/i, category: 'secret', description: 'PFX 证书文件' },
  { pattern: /\.p12$/i, category: 'secret', description: 'P12 证书文件' },
  { pattern: /id_rsa/i, category: 'secret', description: 'SSH 私钥' },
  { pattern: /id_ed25519/i, category: 'secret', description: 'SSH 私钥' },
  { pattern: /id_ecdsa/i, category: 'secret', description: 'SSH 私钥' },
  { pattern: /\.ssh[/\\]/i, category: 'secret', description: 'SSH 目录' },
  { pattern: /wallet\.dat/i, category: 'secret', description: '加密钱包' },
  { pattern: /keystore/i, category: 'secret', description: '密钥存储' },
  { pattern: /\.gnupg[/\\]/i, category: 'secret', description: 'GPG 密钥目录' },
  { pattern: /\.aws[/\\]credentials/i, category: 'secret', description: 'AWS 凭证' },
  { pattern: /\.kube[/\\]config/i, category: 'secret', description: 'Kubernetes 配置' },
  { pattern: /\.docker[/\\]config\.json/i, category: 'secret', description: 'Docker 配置' },
  { pattern: /\.npmrc$/i, category: 'secret', description: 'NPM 配置（可能包含 token）' },
  { pattern: /\.netrc$/i, category: 'secret', description: '网络凭证文件' },
  
  // 浏览器数据
  { pattern: /Chrome[/\\].*Login Data/i, category: 'browser', description: 'Chrome 登录数据' },
  { pattern: /Chrome[/\\].*Cookies/i, category: 'browser', description: 'Chrome Cookies' },
  { pattern: /Firefox[/\\].*logins\.json/i, category: 'browser', description: 'Firefox 登录数据' },
  { pattern: /Firefox[/\\].*cookies\.sqlite/i, category: 'browser', description: 'Firefox Cookies' },
  { pattern: /Edge[/\\].*Login Data/i, category: 'browser', description: 'Edge 登录数据' },
  
  // 聊天记录
  { pattern: /WeChat[/\\].*\.db/i, category: 'chat', description: '微信数据库' },
  { pattern: /Tencent[/\\].*\.db/i, category: 'chat', description: '腾讯应用数据库' },
  { pattern: /QQ[/\\].*\.db/i, category: 'chat', description: 'QQ 数据库' },
  { pattern: /Telegram[/\\]/i, category: 'chat', description: 'Telegram 数据' },
];

/**
 * 危险命令模式 - 这些命令会被拦截
 */
const DANGEROUS_COMMANDS: DangerousCommand[] = [
  // 绝对禁止（block）
  { pattern: /\bformat\s+[a-z]:/i, category: 'disk', description: '格式化磁盘', severity: 'block' },
  { pattern: /\bdiskpart\b/i, category: 'disk', description: '磁盘分区工具', severity: 'block' },
  { pattern: /\bmkfs\b/i, category: 'disk', description: '创建文件系统', severity: 'block' },
  { pattern: /\bdd\s+if=.*of=\/dev/i, category: 'disk', description: '写入磁盘设备', severity: 'block' },
  { pattern: /\brm\s+-rf\s+\/\s*$/i, category: 'system', description: '删除根目录', severity: 'block' },
  { pattern: /\brm\s+-rf\s+\/\*/i, category: 'system', description: '删除根目录内容', severity: 'block' },
  { pattern: /\bdel\s+\/[sfq].*C:\\Windows/i, category: 'system', description: '删除 Windows 系统文件', severity: 'block' },
  { pattern: /\brd\s+\/s.*C:\\Windows/i, category: 'system', description: '删除 Windows 目录', severity: 'block' },
  { pattern: /\breg\s+delete\s+HKLM\\SYSTEM/i, category: 'registry', description: '删除系统注册表', severity: 'block' },
  { pattern: /\breg\s+delete\s+HKLM\\SOFTWARE\\Microsoft\\Windows/i, category: 'registry', description: '删除 Windows 注册表', severity: 'block' },
  { pattern: /\bbcdedit\b.*\/delete/i, category: 'boot', description: '删除启动项', severity: 'block' },
  { pattern: /\bnetsh\s+firewall\s+set\s+opmode\s+disable/i, category: 'security', description: '禁用防火墙', severity: 'block' },
  { pattern: /\bnetsh\s+advfirewall\s+set\s+.*state\s+off/i, category: 'security', description: '关闭高级防火墙', severity: 'block' },
  
  // 需要确认（confirm）
  { pattern: /\brm\s+-rf\b/i, category: 'delete', description: '强制递归删除', severity: 'confirm' },
  { pattern: /\brm\s+-r\b/i, category: 'delete', description: '递归删除', severity: 'confirm' },
  { pattern: /\bdel\s+\/[sfq]/i, category: 'delete', description: '强制删除', severity: 'confirm' },
  { pattern: /\brd\s+\/s/i, category: 'delete', description: '递归删除目录', severity: 'confirm' },
  { pattern: /DROP\s+(TABLE|DATABASE)/i, category: 'database', description: '删除数据库/表', severity: 'confirm' },
  { pattern: /TRUNCATE\s+TABLE/i, category: 'database', description: '清空数据表', severity: 'confirm' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(;|$)/i, category: 'database', description: '删除所有记录', severity: 'confirm' },
  { pattern: /\bshutdown\b/i, category: 'power', description: '关机', severity: 'confirm' },
  { pattern: /\breboot\b/i, category: 'power', description: '重启', severity: 'confirm' },
  { pattern: /\bpoweroff\b/i, category: 'power', description: '关闭电源', severity: 'confirm' },
  { pattern: /\bhalt\b/i, category: 'power', description: '停机', severity: 'confirm' },
  { pattern: /\bhibernate\b/i, category: 'power', description: '休眠', severity: 'confirm' },
  { pattern: /\blogoff\b/i, category: 'session', description: '注销', severity: 'confirm' },
  { pattern: /\bnet\s+user\b.*\/delete/i, category: 'user', description: '删除用户', severity: 'confirm' },
  { pattern: /\bnet\s+user\b.*\/add/i, category: 'user', description: '添加用户', severity: 'confirm' },
  { pattern: /\buseradd\b/i, category: 'user', description: '添加用户', severity: 'confirm' },
  { pattern: /\buserdel\b/i, category: 'user', description: '删除用户', severity: 'confirm' },
  { pattern: /\bchmod\s+777\b/i, category: 'permission', description: '开放所有权限', severity: 'confirm' },
  { pattern: /\bchown\b.*-R/i, category: 'permission', description: '递归更改所有者', severity: 'confirm' },
];

/**
 * 系统关键路径 - 禁止删除/修改
 */
const SYSTEM_PATHS: RegExp[] = [
  // Windows
  /^C:\\Windows/i,
  /^C:\\Program Files/i,
  /^C:\\Program Files \(x86\)/i,
  /^C:\\ProgramData/i,
  /^C:\\Users\\[^\\]+\\AppData\\Local\\Microsoft/i,
  // macOS
  /^\/System/,
  /^\/Library/,
  /^\/usr/,
  /^\/bin/,
  /^\/sbin/,
  // Linux
  /^\/etc/,
  /^\/var/,
  /^\/boot/,
];

// ============================================================
// 安全检查服务
// ============================================================

class SecurityGuard {
  private logger = logger.child('Security');
  
  /**
   * 获取当前沙盒配置
   */
  getSandboxConfig(): SandboxConfig {
    const mode = configManager.get<SandboxMode>('sandbox.mode', 'standard');
    const preset = SANDBOX_PRESETS[mode] || SANDBOX_PRESETS['standard'];
    const customConfig = configManager.get<Partial<SandboxConfig>>('sandbox.custom', {});
    
    // 深度合并预设和自定义配置，确保嵌套对象不会被覆盖为 undefined
    return {
      ...preset,
      mode,
      confirm: {
        ...preset.confirm,
        ...(customConfig.confirm || {}),
      },
      ai: {
        ...preset.ai,
        ...(customConfig.ai || {}),
      },
      confirmTimeout: customConfig.confirmTimeout ?? preset.confirmTimeout,
    };
  }
  
  /**
   * 获取当前沙盒模式
   */
  getSandboxMode(): SandboxMode {
    return configManager.get<SandboxMode>('sandbox.mode', 'standard');
  }
  
  /**
   * 从工具调用中提取操作信息
   */
  extractOperationInfo(tool: string, args: Record<string, unknown>): OperationInfo {
    const info: OperationInfo = {
      type: 'unknown',
      tool,
      args,
    };
    
    // computer 工具
    if (tool === 'computer') {
      const action = args.action as string;
      info.action = action;
      
      switch (action) {
        case 'left_click':
        case 'right_click':
        case 'double_click':
        case 'middle_click':
        case 'click_element':
          info.type = 'click';
          info.description = `点击 ${args.coordinate || args.element_name || ''}`;
          break;
        case 'type':
          info.type = 'type';
          info.description = `输入文字: "${(args.text as string)?.substring(0, 50)}..."`;
          break;
        case 'key':
          info.type = 'key';
          info.description = `按键: ${args.key}`;
          break;
        case 'hotkey':
          info.type = 'hotkey';
          info.description = `快捷键: ${(args.keys as string[])?.join('+')}`;
          break;
        case 'scroll':
          info.type = 'scroll';
          info.description = `滚动: ${args.direction}`;
          break;
      }
    }
    
    // exec 工具
    else if (tool === 'exec') {
      info.type = 'execCommand';
      info.command = args.command as string;
      info.description = `执行命令: ${info.command?.substring(0, 100)}`;
    }
    
    // browser 工具
    else if (tool === 'browser') {
      const action = args.action as string;
      info.action = action;
      
      if (action === 'goto' || action === 'open') {
        info.type = 'openUrl';
        info.description = `打开网址: ${args.url || ''}`;
      } else if (action === 'type' || action === 'fill') {
        info.type = 'type';
        info.description = `网页输入: "${(args.text as string)?.substring(0, 50)}..."`;
      } else if (action === 'click') {
        info.type = 'click';
        info.description = `网页点击: ref=${args.ref}`;
      }
    }
    
    // 文件操作（如果有的话）
    else if (args.path || args.filePath) {
      const path = (args.path || args.filePath) as string;
      info.filePath = path;
      
      if (args.action === 'delete' || args.action === 'remove') {
        info.type = 'fileDelete';
        info.description = `删除文件: ${path}`;
      } else if (args.action === 'create' || args.action === 'write') {
        info.type = args.action === 'create' ? 'fileCreate' : 'fileModify';
        info.description = `${args.action === 'create' ? '创建' : '修改'}文件: ${path}`;
      } else if (args.action === 'read') {
        info.type = 'fileRead';
        info.description = `读取文件: ${path}`;
      }
    }
    
    return info;
  }
  
  /**
   * 主要安全检查方法
   * 在执行任何操作前调用
   */
  async check(operation: OperationInfo): Promise<SecurityCheckResult> {
    const config = this.getSandboxConfig();
    
    // 第一层：全局禁止检查（硬编码，无法绕过）
    const forbiddenResult = this.checkGloballyForbidden(operation);
    if (forbiddenResult) {
      this.logger.warn(`🚫 操作被禁止: ${forbiddenResult.reason}`);
      return forbiddenResult;
    }
    
    // 第二层：敏感操作检查（即使信任模式也要确认）
    const sensitiveResult = this.checkSensitiveOperation(operation);
    if (sensitiveResult) {
      this.logger.info(`🔐 敏感操作需要确认: ${sensitiveResult.reason}`);
      return sensitiveResult;
    }
    
    // 第三层：沙盒模式检查
    const sandboxResult = this.checkSandboxRules(operation, config);
    if (sandboxResult) {
      this.logger.debug(`📦 沙盒规则要求确认: ${sandboxResult.reason}`);
      return sandboxResult;
    }
    
    // 通过所有检查
    return { allowed: true, action: 'allow' };
  }
  
  /**
   * 检查全局禁止的操作
   */
  private checkGloballyForbidden(operation: OperationInfo): SecurityCheckResult | null {
    // 检查危险命令
    if (operation.command) {
      for (const cmd of DANGEROUS_COMMANDS) {
        if (cmd.pattern.test(operation.command)) {
          if (cmd.severity === 'block') {
            return {
              allowed: false,
              action: 'block',
              reason: cmd.description,
              category: 'forbidden',
              message: `⛔ 系统安全限制：${cmd.description}\n此操作已被系统禁止，无法执行。`,
            };
          }
        }
      }
    }
    
    // 检查系统路径删除
    if (operation.type === 'fileDelete' && operation.filePath) {
      for (const pathPattern of SYSTEM_PATHS) {
        if (pathPattern.test(operation.filePath)) {
          return {
            allowed: false,
            action: 'block',
            reason: '尝试删除系统目录',
            category: 'forbidden',
            message: `⛔ 系统安全限制：不允许删除系统目录\n路径: ${operation.filePath}`,
          };
        }
      }
    }
    
    return null;
  }
  
  /**
   * 检查敏感操作（即使信任模式也要确认）
   */
  private checkSensitiveOperation(operation: OperationInfo): SecurityCheckResult | null {
    // 检查敏感文件访问
    if (operation.filePath) {
      for (const sensitive of SENSITIVE_FILE_PATTERNS) {
        if (sensitive.pattern.test(operation.filePath)) {
          return {
            allowed: false,
            action: 'confirm',
            reason: sensitive.description,
            category: 'sensitive',
            confirmMessage: `🔐 敏感文件访问确认\n\n类型: ${sensitive.category}\n说明: ${sensitive.description}\n路径: ${operation.filePath}\n\n确定要继续吗？`,
          };
        }
      }
    }
    
    // 检查危险命令（需要确认级别）
    if (operation.command) {
      for (const cmd of DANGEROUS_COMMANDS) {
        if (cmd.severity === 'confirm' && cmd.pattern.test(operation.command)) {
          return {
            allowed: false,
            action: 'confirm',
            reason: cmd.description,
            category: 'sensitive',
            confirmMessage: `⚠️ 危险命令确认\n\n类型: ${cmd.category}\n说明: ${cmd.description}\n命令: ${operation.command}\n\n确定要执行吗？`,
          };
        }
      }
    }
    
    // 检查支付/金融操作（通过关键词检测）
    const paymentKeywords = /支付|付款|转账|充值|购买|下单|pay|payment|checkout|transfer/i;
    if (operation.description && paymentKeywords.test(operation.description)) {
      return {
        allowed: false,
        action: 'confirm',
        reason: '检测到可能的支付操作',
        category: 'sensitive',
        confirmMessage: `💳 支付操作确认\n\n${operation.description}\n\n这可能涉及金钱交易，确定要继续吗？`,
      };
    }
    
    return null;
  }
  
  /**
   * 检查沙盒规则
   */
  private checkSandboxRules(
    operation: OperationInfo,
    config: SandboxConfig
  ): SecurityCheckResult | null {
    // 根据操作类型检查是否需要确认
    const needsConfirm = config.confirm[operation.type as keyof typeof config.confirm];
    
    if (needsConfirm) {
      return {
        allowed: false,
        action: 'confirm',
        reason: `沙盒${config.mode}模式要求确认`,
        category: 'sandbox',
        confirmMessage: `📦 操作确认 (${config.mode}模式)\n\n${operation.description || operation.type}\n\n确定要执行吗？`,
      };
    }
    
    return null;
  }
  
  /**
   * 获取沙盒模式的 Prompt 描述
   */
  getSandboxPrompt(): string {
    const mode = this.getSandboxMode();
    const config = this.getSandboxConfig();
    
    const modeDescriptions: Record<SandboxMode, string> = {
      strict: '🔒 严格模式：所有操作都需要用户确认',
      standard: '⚖️ 标准模式：敏感操作需要确认，普通操作直接执行',
      trust: '🚀 信任模式：大部分操作直接执行，只有安全底线需要确认',
    };
    
    let prompt = `## 沙盒安全环境

当前模式：${modeDescriptions[mode]}

### 系统会自动处理以下情况：
1. **危险操作**：格式化磁盘、删除系统文件等会被自动阻止
2. **敏感文件**：访问密钥、密码文件会要求用户确认
3. **危险命令**：rm -rf、shutdown 等会要求用户确认

### 你的职责：
- 理解用户意图，调用正确的工具
- 系统会自动判断是否需要确认，你按正常流程执行即可
- 用户说"直接执行"只是表达期望，实际确认由系统决定`;

    // 根据模式添加 AI 行为指导
    if (config.ai.explainBeforeAction === 'required') {
      prompt += `\n\n### 必须遵守：
- 每次操作前必须说明你要做什么`;
    }
    
    if (!config.ai.canAskConfirm) {
      prompt += `\n- 不要主动询问用户是否确认，系统会自动处理`;
    }
    
    if (config.ai.autoChooseOnAmbiguity) {
      prompt += `\n- 遇到歧义时选择最可能的选项，不要停下来问用户`;
    }
    
    return prompt;
  }
}

// 单例导出
export const securityGuard = new SecurityGuard();
export default securityGuard;
