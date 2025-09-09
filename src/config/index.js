import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config();

/**
 * 应用配置类
 */
class Config {
  constructor() {
    this.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4-vision-preview'
    };

    this.app = {
      screenshotQuality: parseInt(process.env.SCREENSHOT_QUALITY) || 80,
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
      taskTimeout: parseInt(process.env.TASK_TIMEOUT) || 300000, // 5分钟
      screenshotsDir: join(__dirname, '../../screenshots'),
      tempDir: join(__dirname, '../../temp')
    };

    this.platform = this.detectPlatform();
  }

  /**
   * 检测当前操作系统平台
   */
  detectPlatform() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return 'windows';
      case 'darwin':
        return 'mac';
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }

  /**
   * 验证配置是否完整
   */
  validate() {
    const errors = [];

    if (!this.openai.apiKey) {
      errors.push('缺少 OPENAI_API_KEY 环境变量');
    }

    if (!existsSync(this.app.screenshotsDir)) {
      errors.push(`截图目录不存在: ${this.app.screenshotsDir}`);
    }

    if (!existsSync(this.app.tempDir)) {
      errors.push(`临时目录不存在: ${this.app.tempDir}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 获取平台特定的配置
   */
  getPlatformConfig() {
    const baseConfig = {
      mouseSpeed: 1000,
      keyboardDelay: 50,
      clickDelay: 100
    };

    switch (this.platform) {
      case 'windows':
        return {
          ...baseConfig,
          mouseSpeed: 800,
          keyboardDelay: 30
        };
      case 'mac':
        return {
          ...baseConfig,
          mouseSpeed: 1200,
          keyboardDelay: 60
        };
      case 'linux':
        return {
          ...baseConfig,
          mouseSpeed: 1000,
          keyboardDelay: 50
        };
      default:
        return baseConfig;
    }
  }
}

export default new Config();
