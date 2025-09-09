import screenshot from 'screenshot-desktop';
import { promises as fs } from 'fs';
import path from 'path';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import ErrorHandler from '../utils/errorHandler.js';

/**
 * 屏幕截图模块
 */
class ScreenshotModule {
  constructor() {
    this.screenshotsDir = config.app.screenshotsDir;
    this.quality = config.app.screenshotQuality;
    this.ensureDirectories();
  }

  /**
   * 确保目录存在
   */
  async ensureDirectories() {
    try {
      await fs.mkdir(this.screenshotsDir, { recursive: true });
    } catch (error) {
      logger.error('创建截图目录失败:', error.message);
    }
  }

  /**
   * 截取屏幕截图
   */
  async capture(options = {}) {
    return await ErrorHandler.handleAsync(async () => {
      const {
        format = 'png',
        quality = this.quality,
        filename = this.generateFilename()
      } = options;

      logger.info('正在截取屏幕截图...');

      const screenshotOptions = {
        format,
        quality
      };

      // 根据平台调整截图选项
      if (config.platform === 'mac') {
        screenshotOptions.screen = 0; // 主屏幕
      }

      const imageBuffer = await screenshot(screenshotOptions);
      
      const filePath = path.join(this.screenshotsDir, filename);
      await fs.writeFile(filePath, imageBuffer);

      logger.success(`截图已保存: ${filePath}`);
      
      return {
        filePath,
        buffer: imageBuffer,
        size: imageBuffer.length,
        format,
        quality
      };
    }, 'ScreenshotModule.capture');
  }

  /**
   * 生成唯一的文件名
   */
  generateFilename() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `screenshot-${timestamp}.png`;
  }

  /**
   * 清理旧的截图文件
   */
  async cleanup(maxAge = 24 * 60 * 60 * 1000) { // 24小时
    return await ErrorHandler.handleAsync(async () => {
      const files = await fs.readdir(this.screenshotsDir);
      const now = Date.now();
      let cleanedCount = 0;

      for (const file of files) {
        if (!file.startsWith('screenshot-')) continue;

        const filePath = path.join(this.screenshotsDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`清理了 ${cleanedCount} 个旧截图文件`);
      }

      return cleanedCount;
    }, 'ScreenshotModule.cleanup');
  }

  /**
   * 获取截图信息
   */
  async getScreenshotInfo(filePath) {
    return await ErrorHandler.handleAsync(async () => {
      const stats = await fs.stat(filePath);
      return {
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        exists: true
      };
    }, 'ScreenshotModule.getScreenshotInfo');
  }

  /**
   * 删除指定截图
   */
  async deleteScreenshot(filePath) {
    return await ErrorHandler.handleAsync(async () => {
      await fs.unlink(filePath);
      logger.info(`已删除截图: ${filePath}`);
    }, 'ScreenshotModule.deleteScreenshot');
  }

  /**
   * 获取所有截图文件
   */
  async getAllScreenshots() {
    return await ErrorHandler.handleAsync(async () => {
      const files = await fs.readdir(this.screenshotsDir);
      const screenshots = [];

      for (const file of files) {
        if (file.startsWith('screenshot-') && file.endsWith('.png')) {
          const filePath = path.join(this.screenshotsDir, file);
          const info = await this.getScreenshotInfo(filePath);
          screenshots.push(info);
        }
      }

      return screenshots.sort((a, b) => b.modified - a.modified);
    }, 'ScreenshotModule.getAllScreenshots');
  }
}

export default ScreenshotModule;
