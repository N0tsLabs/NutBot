import { mouse, keyboard, Point, Button, Key } from '@nut-tree-fork/nut-js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import ErrorHandler from '../utils/errorHandler.js';

/**
 * 自动化操作模块
 */
class AutomationModule {
  constructor() {
    this.platformConfig = config.getPlatformConfig();
    this.setupNutJS();
  }

  /**
   * 设置Nut.js配置
   */
  setupNutJS() {
    mouse.config.autoDelayMs = this.platformConfig.mouseSpeed;
    keyboard.config.autoDelayMs = this.platformConfig.keyboardDelay;
  }

  /**
   * 执行操作指令
   */
  async executeAction(action) {
    return await ErrorHandler.handleAsync(async () => {
      logger.info(`执行操作: ${action.type} - ${action.target}`);

      switch (action.type) {
        case 'click':
          return await this.click(action);
        case 'type':
          return await this.type(action);
        case 'scroll':
          return await this.scroll(action);
        case 'wait':
          return await this.wait(action);
        case 'key':
          return await this.pressKey(action);
        case 'move':
          return await this.moveMouse(action);
        default:
          throw new Error(`不支持的操作类型: ${action.type}`);
      }
    }, `AutomationModule.executeAction(${action.type})`);
  }

  /**
   * 点击操作
   */
  async click(action) {
    const { x, y, button = 'left' } = action.params || {};
    
    if (x !== undefined && y !== undefined) {
      // 坐标点击
      const point = new Point(x, y);
      const buttonType = this.getButtonType(button);
      
      await mouse.setPosition(point);
      await mouse.click(buttonType);
      
      logger.success(`点击坐标 (${x}, ${y})`);
    } else {
      // 基于目标描述的点击（需要AI提供坐标）
      throw new Error('点击操作需要提供x,y坐标');
    }

    // 点击后等待
    await this.sleep(this.platformConfig.clickDelay);
  }

  /**
   * 输入文字
   */
  async type(action) {
    const { text } = action.params || {};
    
    if (!text) {
      throw new Error('输入操作需要提供text参数');
    }

    await keyboard.type(text);
    logger.success(`输入文字: ${text}`);
    
    // 输入后等待
    await this.sleep(200);
  }

  /**
   * 滚动操作
   */
  async scroll(action) {
    const { direction = 'down', amount = 3 } = action.params || {};
    
    const scrollAmount = direction === 'up' ? -amount : amount;
    
    await mouse.scrollUp(scrollAmount);
    logger.success(`滚动 ${direction} ${amount} 次`);
    
    // 滚动后等待
    await this.sleep(300);
  }

  /**
   * 等待操作
   */
  async wait(action) {
    const { duration = 1000 } = action.params || {};
    
    logger.info(`等待 ${duration}ms`);
    await this.sleep(duration);
  }

  /**
   * 按键操作
   */
  async pressKey(action) {
    const { key, modifiers = [] } = action.params || {};
    
    if (!key) {
      throw new Error('按键操作需要提供key参数');
    }

    const keyType = this.getKeyType(key);
    
    // 处理修饰键
    if (modifiers.length > 0) {
      const modifierKeys = modifiers.map(mod => this.getKeyType(mod));
      await keyboard.pressKey(...modifierKeys, keyType);
      await keyboard.releaseKey(...modifierKeys, keyType);
    } else {
      await keyboard.pressKey(keyType);
      await keyboard.releaseKey(keyType);
    }
    
    logger.success(`按下按键: ${key}${modifiers.length > 0 ? ` + ${modifiers.join('+')}` : ''}`);
    
    // 按键后等待
    await this.sleep(100);
  }

  /**
   * 移动鼠标
   */
  async moveMouse(action) {
    const { x, y } = action.params || {};
    
    if (x === undefined || y === undefined) {
      throw new Error('移动鼠标需要提供x,y坐标');
    }

    const point = new Point(x, y);
    await mouse.setPosition(point);
    
    logger.success(`移动鼠标到 (${x}, ${y})`);
    
    // 移动后等待
    await this.sleep(100);
  }

  /**
   * 获取按钮类型
   */
  getButtonType(button) {
    switch (button.toLowerCase()) {
      case 'left':
        return Button.LEFT;
      case 'right':
        return Button.RIGHT;
      case 'middle':
        return Button.MIDDLE;
      default:
        return Button.LEFT;
    }
  }

  /**
   * 获取按键类型
   */
  getKeyType(key) {
    const keyMap = {
      'enter': Key.Enter,
      'tab': Key.Tab,
      'space': Key.Space,
      'backspace': Key.Backspace,
      'delete': Key.Delete,
      'escape': Key.Escape,
      'ctrl': Key.LeftControl,
      'alt': Key.LeftAlt,
      'shift': Key.LeftShift,
      'cmd': Key.LeftCmd,
      'meta': Key.LeftCmd,
      'up': Key.Up,
      'down': Key.Down,
      'left': Key.Left,
      'right': Key.Right,
      'home': Key.Home,
      'end': Key.End,
      'pageup': Key.PageUp,
      'pagedown': Key.PageDown,
      'f1': Key.F1,
      'f2': Key.F2,
      'f3': Key.F3,
      'f4': Key.F4,
      'f5': Key.F5,
      'f6': Key.F6,
      'f7': Key.F7,
      'f8': Key.F8,
      'f9': Key.F9,
      'f10': Key.F10,
      'f11': Key.F11,
      'f12': Key.F12
    };

    return keyMap[key.toLowerCase()] || key;
  }

  /**
   * 获取当前鼠标位置
   */
  async getMousePosition() {
    return await ErrorHandler.handleAsync(async () => {
      const position = await mouse.getPosition();
      return {
        x: position.x,
        y: position.y
      };
    }, 'AutomationModule.getMousePosition');
  }

  /**
   * 获取屏幕尺寸
   */
  async getScreenSize() {
    return await ErrorHandler.handleAsync(async () => {
      // Nut.js没有直接获取屏幕尺寸的方法，使用默认值
      // 实际项目中可能需要使用其他库
      const defaultSizes = {
        windows: { width: 1920, height: 1080 },
        mac: { width: 1440, height: 900 },
        linux: { width: 1920, height: 1080 }
      };

      return defaultSizes[config.platform] || defaultSizes.linux;
    }, 'AutomationModule.getScreenSize');
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 批量执行操作
   */
  async executeActions(actions) {
    const results = [];
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      logger.progress(`执行操作 ${i + 1}/${actions.length}: ${action.type}`);
      
      try {
        const result = await this.executeAction(action);
        results.push({
          action,
          success: true,
          result
        });
      } catch (error) {
        logger.error(`操作失败: ${action.type} - ${error.message}`);
        results.push({
          action,
          success: false,
          error: error.message
        });
        
        // 如果操作失败，可以选择继续或停止
        if (action.critical !== false) {
          throw error;
        }
      }
    }
    
    return results;
  }
}

export default AutomationModule;
