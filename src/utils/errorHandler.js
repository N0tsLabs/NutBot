import logger from './logger.js';

/**
 * 错误处理工具类
 */
class ErrorHandler {
  /**
   * 处理异步操作中的错误
   */
  static async handleAsync(fn, context = '') {
    try {
      return await fn();
    } catch (error) {
      this.handleError(error, context);
      throw error;
    }
  }

  /**
   * 处理同步操作中的错误
   */
  static handleSync(fn, context = '') {
    try {
      return fn();
    } catch (error) {
      this.handleError(error, context);
      throw error;
    }
  }

  /**
   * 统一错误处理
   */
  static handleError(error, context = '') {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    };

    logger.error(`错误发生${context ? ` (${context})` : ''}: ${error.message}`);
    
    if (process.env.NODE_ENV === 'development') {
      logger.debug('错误堆栈:', error.stack);
    }

    // 根据错误类型进行分类处理
    if (error.name === 'OpenAIError') {
      this.handleOpenAIError(error);
    } else if (error.name === 'NutError') {
      this.handleNutError(error);
    } else if (error.name === 'ScreenshotError') {
      this.handleScreenshotError(error);
    } else {
      this.handleGenericError(error);
    }
  }

  /**
   * 处理OpenAI相关错误
   */
  static handleOpenAIError(error) {
    if (error.status === 401) {
      logger.error('OpenAI API密钥无效，请检查环境变量 OPENAI_API_KEY');
    } else if (error.status === 429) {
      logger.warn('OpenAI API请求频率限制，请稍后重试');
    } else if (error.status === 500) {
      logger.error('OpenAI服务器错误，请稍后重试');
    }
  }

  /**
   * 处理Nut.js相关错误
   */
  static handleNutError(error) {
    logger.error('自动化操作失败:', error.message);
    logger.warn('请确保应用程序有足够的权限进行屏幕操作');
  }

  /**
   * 处理截图相关错误
   */
  static handleScreenshotError(error) {
    logger.error('截图失败:', error.message);
    logger.warn('请确保系统支持屏幕截图功能');
  }

  /**
   * 处理通用错误
   */
  static handleGenericError(error) {
    logger.error('未知错误:', error.message);
  }

  /**
   * 重试机制
   */
  static async retry(fn, maxAttempts = 3, delay = 1000, context = '') {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxAttempts) {
          logger.error(`重试失败 (${attempt}/${maxAttempts})${context ? ` - ${context}` : ''}`);
          throw error;
        }
        
        logger.warn(`重试中 (${attempt}/${maxAttempts})${context ? ` - ${context}` : ''}: ${error.message}`);
        await this.sleep(delay * attempt);
      }
    }
    
    throw lastError;
  }

  /**
   * 延迟函数
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ErrorHandler;
