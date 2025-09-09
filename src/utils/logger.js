import chalk from 'chalk';

/**
 * 日志工具类
 */
class Logger {
  constructor() {
    this.levels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };
    this.currentLevel = this.levels.INFO;
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    this.currentLevel = this.levels[level.toUpperCase()] || this.levels.INFO;
  }

  /**
   * 格式化时间戳
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * 输出日志
   */
  log(level, message, ...args) {
    if (this.levels[level] > this.currentLevel) return;

    const timestamp = this.getTimestamp();
    const levelColor = this.getLevelColor(level);
    
    console.log(
      `${chalk.gray(timestamp)} ${levelColor(`[${level}]`)} ${message}`,
      ...args
    );
  }

  /**
   * 获取级别对应的颜色
   */
  getLevelColor(level) {
    switch (level) {
      case 'ERROR':
        return chalk.red.bold;
      case 'WARN':
        return chalk.yellow.bold;
      case 'INFO':
        return chalk.blue.bold;
      case 'DEBUG':
        return chalk.gray.bold;
      default:
        return chalk.white;
    }
  }

  error(message, ...args) {
    this.log('ERROR', message, ...args);
  }

  warn(message, ...args) {
    this.log('WARN', message, ...args);
  }

  info(message, ...args) {
    this.log('INFO', message, ...args);
  }

  debug(message, ...args) {
    this.log('DEBUG', message, ...args);
  }

  /**
   * 成功消息
   */
  success(message, ...args) {
    console.log(chalk.green.bold('✓'), message, ...args);
  }

  /**
   * 进度消息
   */
  progress(message, ...args) {
    console.log(chalk.cyan('→'), message, ...args);
  }
}

export default new Logger();
