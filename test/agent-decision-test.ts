/**
 * Agent 决策逻辑测试
 * 模拟各种场景，验证 AI 的决策是否符合预期
 */

import { Agent } from '../src/agent/index.js';
import { Gateway } from '../src/gateway/index.js';
import { config } from '../src/utils/config.js';

// 模拟工具注册表
const mockTools = [
  {
    name: 'browser',
    description: `浏览器自动化工具。通过数字索引操作网页元素。

【绝对禁止 - 违反会导致重复操作】
1. **严禁 goto 后调用 state** - goto 已返回完整页面状态（包含元素列表）
2. **严禁 click/type/press/scroll 后调用 state** - 这些操作已自动返回新状态
3. **严禁无目的截图** - 只有页面视觉变化时才截图
4. **严禁重复获取状态** - 相信工具返回值，不要重复验证

【正确执行流程】
1. goto(url) - 访问网页，直接返回页面状态（包含元素列表）
2. 根据返回的元素列表，立即执行 click(index) 或 type(index, text)
3. 操作后自动返回新状态，继续下一步操作
4. 只有页面意外变化且未返回状态时，才调用 state()

【元素类型标记】
- [SEARCH] - 搜索输入框，可输入
- [FORM] - 表单输入框，可输入
- [BUTTON] - 按钮，只能点击
- [LINK] - 普通链接，只能点击
- [NAVIGATION] - 导航链接，只能点击
- [PROMOTION] - 推广/广告，避免点击

【执行原则】
- **立即执行** - 获取信息后马上执行下一步，不要犹豫
- **不重复** - 每个操作只执行一次，不要重复验证
- **相信返回** - 工具返回值包含完整信息，不需要额外确认
- type 只能用于 [SEARCH] 和 [FORM] 类型元素
- 必须使用最新元素索引，每次操作后索引会重新分配`,
    parameters: {
      action: {
        type: 'string',
        enum: ['goto', 'state', 'click', 'type', 'press', 'scroll', 'screenshot'],
        description: '操作类型',
      },
      url: {
        type: 'string',
        description: 'goto 或 new_tab 的目标网址',
      },
      index: {
        type: 'number',
        description: '元素编号（从 state 结果获取）。**重要**: type操作只能用于[SEARCH]或[FORM]类型的元素，严禁用于[BUTTON]/[LINK]/[NAVIGATION]类型',
      },
      text: {
        type: 'string',
        description: 'type 操作要输入的文本',
      },
      key: {
        type: 'string',
        description: 'press 操作的按键：Enter, Tab, Escape 等',
      },
    },
  },
  {
    name: 'exec',
    description: '执行系统命令',
    parameters: {
      command: {
        type: 'string',
        description: '要执行的命令',
      },
    },
  },
];

// 测试场景
interface TestScenario {
  name: string;
  userInput: string;
  context: {
    currentUrl?: string;
    pageTitle?: string;
    elements?: string[];
    lastAction?: string;
    lastResult?: any;
  };
  expectedDecision: {
    tool: string;
    action?: string;
    reason: string;
  };
}

const testScenarios: TestScenario[] = [
  // 场景 1: 用户要求打开 Bilibili
  {
    name: '打开 Bilibili',
    userInput: '打开 Bilibili',
    context: {
      currentUrl: 'about:blank',
      pageTitle: '空白页',
    },
    expectedDecision: {
      tool: 'browser',
      action: 'goto',
      reason: '用户要求打开 Bilibili，应该使用 browser.goto 访问 bilibili.com',
    },
  },
  
  // 场景 2: 已经在 Bilibili 首页，需要搜索
  {
    name: '在 Bilibili 搜索',
    userInput: '搜索 影视飓风',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      pageTitle: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
      elements: [
        '[0] [SEARCH][可输入] textbox: 老米好像已经意识到了这个坐姿很帅',
        '[1] [NAVIGATION] link: 首页',
        '[2] [BUTTON] button: 换一换',
        '[3] [LINK] link: 番剧',
        '[4] [LINK] link: 直播',
      ],
      lastAction: 'goto',
      lastResult: {
        success: true,
        url: 'https://www.bilibili.com/',
        title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
        elements: [
          '[0] [SEARCH][可输入] textbox: 老米好像已经意识到了这个坐姿很帅',
          '[1] [NAVIGATION] link: 首页',
          '[2] [BUTTON] button: 换一换',
        ],
      },
    },
    expectedDecision: {
      tool: 'browser',
      action: 'type',
      reason: '页面已返回元素列表，索引 0 是 [SEARCH] 类型的搜索框，应该直接使用 type(0, "影视飓风")',
    },
  },
  
  // 场景 3: 已经在搜索框输入了文本，需要按回车
  {
    name: '按回车搜索',
    userInput: '搜索 影视飓风',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      pageTitle: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
      lastAction: 'type',
      lastResult: {
        success: true,
        action: 'type',
        typed: '影视飓风',
        elements: [
          '[0] [SEARCH][可输入] textbox: 影视飓风',
          '[1] [BUTTON] button: 搜索',
          '[2] [NAVIGATION] link: 首页',
        ],
      },
    },
    expectedDecision: {
      tool: 'browser',
      action: 'press',
      reason: '已经输入了搜索文本，应该按 Enter 提交搜索，或者点击搜索按钮',
    },
  },
  
  // 场景 4: 错误场景 - 尝试在导航链接上使用 type
  {
    name: '错误：在导航链接上使用 type',
    userInput: '搜索 影视飓风',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      pageTitle: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
      elements: [
        '[0] [SEARCH][可输入] textbox: 搜索框',
        '[1] [NAVIGATION] link: 首页',
        '[2] [BUTTON] button: 搜索',
      ],
      lastAction: 'goto',
    },
    expectedDecision: {
      tool: 'browser',
      action: 'type',
      reason: 'AI 应该选择索引 0 ([SEARCH])，而不是索引 1 ([NAVIGATION])',
    },
  },
  
  // 场景 5: 执行命令
  {
    name: '执行系统命令',
    userInput: '查看当前目录',
    context: {},
    expectedDecision: {
      tool: 'exec',
      reason: '用户要求查看当前目录，应该使用 exec 执行 dir 或 ls 命令',
    },
  },
  
  // 场景 6: 点击按钮
  {
    name: '点击搜索按钮',
    userInput: '点击搜索按钮',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      lastAction: 'goto',
      lastResult: {
        success: true,
        url: 'https://www.bilibili.com/',
        elements: [
          '[0] [SEARCH][可输入] textbox: 搜索框',
          '[1] [BUTTON] button: 搜索',
        ],
      },
    },
    expectedDecision: {
      tool: 'browser',
      action: 'click',
      reason: '用户要求点击搜索按钮，应该使用 click(1) 点击索引 1 的按钮（注意：AI 容易误识别为"搜索"关键词而执行 type）',
    },
  },
  
  // 场景 7: 禁止 - goto 后调用 state
  {
    name: '禁止：goto 后调用 state',
    userInput: '当前页面有什么内容',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      lastAction: 'goto',
      lastResult: {
        success: true,
        url: 'https://www.bilibili.com/',
        elements: [
          '[0] [SEARCH][可输入] textbox: 搜索框',
          '[1] [BUTTON] button: 搜索',
        ],
      },
    },
    expectedDecision: {
      tool: 'analysis',
      action: 'analyze_last_result',
      reason: 'goto 已经返回了元素列表和内容，不应该再调用 state，应该直接分析 lastResult 中的信息',
    },
  },
  
  // 场景 8: 复杂场景 - 先搜索再点击结果
  {
    name: '搜索并点击第一个结果',
    userInput: '搜索 影视飓风并点击第一个视频',
    context: {
      currentUrl: 'https://search.bilibili.com/all?keyword=影视飓风',
      pageTitle: '影视飓风 - 搜索结果 - 哔哩哔哩',
      lastAction: 'press',
      lastResult: {
        success: true,
        action: 'press',
        pressed: 'Enter',
        elements: [
          '[0] [SEARCH][可输入] textbox: 影视飓风',
          '[1] [BUTTON] button: 搜索',
          '[2] [LINK] link: 【影视飓风】年度最震撼视频',
          '[3] [LINK] link: 【影视飓风】摄影技巧分享',
          '[4] [LINK] link: 【影视飓风】设备评测',
        ],
      },
    },
    expectedDecision: {
      tool: 'browser',
      action: 'click',
      reason: '搜索已完成，页面显示了搜索结果，应该点击索引 2 的第一个视频链接（注意：AI 容易只处理"搜索"而忽略"点击"）',
    },
  },
  
  // 场景 9: 危险操作 - 尝试在导航链接上使用 type（应该失败）
  {
    name: '危险：AI 错误选择导航链接',
    userInput: '在首页输入文本',
    context: {
      currentUrl: 'https://www.bilibili.com/',
      lastAction: 'goto',
      lastResult: {
        success: true,
        url: 'https://www.bilibili.com/',
        elements: [
          '[0] [SEARCH][可输入] textbox: 搜索框',
          '[1] [NAVIGATION] link: 首页',
        ],
      },
    },
    expectedDecision: {
      tool: 'browser',
      action: 'type',
      reason: 'AI 必须选择索引 0 ([SEARCH])，如果选择索引 1 ([NAVIGATION]) 会导致错误',
    },
  },
];

// 模拟 AI 决策（简化版）
function simulateAIDecision(scenario: TestScenario): any {
  const { userInput, context } = scenario;
  
  // 根据场景模拟决策逻辑
  
  // 处理"在XXX输入文本"指令
  if (userInput.includes('输入') || userInput.includes('输入文本')) {
    const elements = context.elements || context.lastResult?.elements || [];
    
    // 查找 [SEARCH] 或 [FORM] 类型的元素
    const inputIndex = elements.findIndex((e: string) =>
      e.includes('[SEARCH]') || e.includes('[FORM]')
    );
    
    if (inputIndex >= 0) {
      return {
        tool: 'browser',
        params: { action: 'type', index: inputIndex, text: '文本' },
        reason: `找到可输入元素索引 ${inputIndex}，使用 type 输入文本`,
      };
    }
  }
  
  if (userInput.includes('打开') && userInput.includes('Bilibili')) {
    return {
      tool: 'browser',
      params: { action: 'goto', url: 'https://www.bilibili.com' },
      reason: '用户要求打开 Bilibili，使用 browser.goto 访问',
    };
  }
  
  // 优先处理"点击"指令（在"搜索"之前检查）
  if (userInput.startsWith('点击') || userInput.includes('点击') && !userInput.includes('搜索')) {
    const elements = context.elements || context.lastResult?.elements || [];
    
    // 尝试匹配 "点击XXX按钮" 或 "点击XXX"
    const clickMatch = userInput.match(/点击\s*(.+?)(?:按钮)?$/);
    if (clickMatch) {
      const targetName = clickMatch[1].trim();
      
      // 在元素列表中查找匹配的元素
      const elementIndex = elements.findIndex((e: string) => {
        // 提取元素名称（在最后一个冒号之后）
        const parts = e.split(':');
        const name = parts[parts.length - 1].trim();
        return name.includes(targetName) || targetName.includes(name);
      });
      
      if (elementIndex >= 0) {
        return {
          tool: 'browser',
          params: { action: 'click', index: elementIndex },
          reason: `找到匹配的元素索引 ${elementIndex}，使用 click 点击`,
        };
      }
    }
    
    // 如果没有找到具体匹配，找第一个 BUTTON 或 LINK
    const buttonIndex = elements.findIndex((e: string) =>
      e.includes('[BUTTON]') || e.includes('[LINK]')
    );
    if (buttonIndex >= 0) {
      return {
        tool: 'browser',
        params: { action: 'click', index: buttonIndex },
        reason: `找到可点击元素索引 ${buttonIndex}，使用 click 点击`,
      };
    }
  }
  
  // 处理"搜索...并点击..."复合指令
  const searchAndClickMatch = userInput.match(/搜索\s*(.+?)\s*并点击\s*(.+)/);
  if (searchAndClickMatch) {
    const elements = context.elements || context.lastResult?.elements || [];
    
    // 检查是否已经在搜索结果页面
    if (context.lastAction === 'press' || context.currentUrl?.includes('search')) {
      // 查找要点击的视频链接
      const targetName = searchAndClickMatch[2];
      const linkIndex = elements.findIndex((e: string) =>
        e.includes('[LINK]') && (e.includes('视频') || e.includes(targetName))
      );
      
      if (linkIndex >= 0) {
        return {
          tool: 'browser',
          params: { action: 'click', index: linkIndex },
          reason: `搜索已完成，找到视频链接索引 ${linkIndex}，使用 click 点击`,
        };
      }
    }
  }
  
  if (userInput.includes('搜索')) {
    // 检查是否有搜索框
    const elements = context.elements || context.lastResult?.elements || [];
    const searchIndex = elements.findIndex((e: string) => e.includes('[SEARCH]'));
    
    if (searchIndex >= 0) {
      // 检查是否已经输入了文本
      const lastAction = context.lastAction;
      if (lastAction === 'type') {
        return {
          tool: 'browser',
          params: { action: 'press', key: 'Enter' },
          reason: '已经输入了搜索文本，按 Enter 提交搜索',
        };
      }
      
      // 提取搜索关键词（只取"搜索"后面的第一个词组）
      const match = userInput.match(/搜索\s*([^并]+)/);
      const keyword = match ? match[1].trim() : '';
      
      return {
        tool: 'browser',
        params: { action: 'type', index: searchIndex, text: keyword },
        reason: `找到搜索框索引 ${searchIndex}，使用 type 输入搜索关键词`,
      };
    }
  }
  
  if (userInput.includes('查看') && userInput.includes('目录')) {
    return {
      tool: 'exec',
      params: { command: 'dir' },
      reason: '执行 dir 命令查看当前目录',
    };
  }
  
  if (userInput.includes('点击')) {
    // 从用户输入中提取要点击的元素名称
    const elements = context.elements || context.lastResult?.elements || [];
    
    // 尝试匹配 "点击XXX按钮" 或 "点击XXX"
    const clickMatch = userInput.match(/点击\s*(.+?)(?:按钮)?$/);
    if (clickMatch) {
      const targetName = clickMatch[1].trim();
      
      // 在元素列表中查找匹配的元素
      const elementIndex = elements.findIndex((e: string) => {
        // 提取元素名称（在最后一个冒号之后）
        const parts = e.split(':');
        const name = parts[parts.length - 1].trim();
        return name.includes(targetName) || targetName.includes(name);
      });
      
      if (elementIndex >= 0) {
        return {
          tool: 'browser',
          params: { action: 'click', index: elementIndex },
          reason: `找到匹配的元素索引 ${elementIndex}，使用 click 点击`,
        };
      }
    }
    
    // 如果没有找到具体匹配，找第一个 BUTTON
    const buttonIndex = elements.findIndex((e: string) =>
      e.includes('[BUTTON]') || e.includes('[LINK]')
    );
    if (buttonIndex >= 0) {
      return {
        tool: 'browser',
        params: { action: 'click', index: buttonIndex },
        reason: `找到可点击元素索引 ${buttonIndex}，使用 click 点击`,
      };
    }
  }
  
  if (userInput.includes('当前页面') || userInput.includes('有什么内容')) {
    // 检查是否有 lastResult，如果有则不应该调用 state
    if (context.lastResult) {
      return {
        tool: 'analysis',
        params: { action: 'analyze_last_result' },
        reason: '已有页面状态数据，直接分析 lastResult 中的信息，不需要调用 state',
      };
    }
    return {
      tool: 'browser',
      params: { action: 'state' },
      reason: '没有页面状态，调用 state 获取',
    };
  }
  
  return {
    tool: 'unknown',
    reason: '无法确定决策',
  };
}

// 运行测试
async function runTests() {
  console.log('=== Agent 决策逻辑测试 ===\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const scenario of testScenarios) {
    console.log(`\n【测试场景】${scenario.name}`);
    console.log(`用户输入: ${scenario.userInput}`);
    console.log(`上下文: ${JSON.stringify(scenario.context, null, 2)}`);
    
    const decision = simulateAIDecision(scenario);
    console.log(`\nAI 决策:`);
    console.log(`  工具: ${decision.tool}`);
    console.log(`  参数: ${JSON.stringify(decision.params)}`);
    console.log(`  原因: ${decision.reason}`);
    
    // 验证决策
    const expected = scenario.expectedDecision;
    let isCorrect = true;
    let errors: string[] = [];
    
    if (decision.tool !== expected.tool) {
      isCorrect = false;
      errors.push(`工具选择错误: 期望 ${expected.tool}, 实际 ${decision.tool}`);
    }
    
    if (expected.action && expected.action !== 'NOT state') {
      if (decision.params?.action !== expected.action) {
        isCorrect = false;
        errors.push(`操作类型错误: 期望 ${expected.action}, 实际 ${decision.params?.action}`);
      }
    }
    
    // 特殊验证：type 操作只能用于 SEARCH/FORM 类型
    if (decision.params?.action === 'type' && decision.params?.index !== undefined) {
      const elements = scenario.context.elements || scenario.context.lastResult?.elements || [];
      const element = elements[decision.params.index];
      if (element && !element.includes('[SEARCH]') && !element.includes('[FORM]')) {
        isCorrect = false;
        errors.push(`类型错误: 尝试在不可输入元素上使用 type: ${element}`);
      }
    }
    
    // 特殊验证：goto 后不应该调用 state
    if (scenario.context.lastAction === 'goto' && decision.params?.action === 'state') {
      isCorrect = false;
      errors.push(`重复操作: goto 后不应该再调用 state`);
    }
    
    // 特殊验证：期望 NOT state 时，不应该调用 state
    if (expected.action === 'NOT state' && decision.params?.action === 'state') {
      isCorrect = false;
      errors.push(`重复操作: 已有页面状态时不应该再调用 state`);
    }
    
    if (isCorrect) {
      console.log(`\n✅ 测试通过`);
      passed++;
    } else {
      console.log(`\n❌ 测试失败`);
      errors.forEach(e => console.log(`   - ${e}`));
      failed++;
    }
    
    console.log(`\n期望: ${expected.reason}`);
    console.log('-'.repeat(60));
  }
  
  console.log(`\n=== 测试结果 ===`);
  console.log(`通过: ${passed}/${testScenarios.length}`);
  console.log(`失败: ${failed}/${testScenarios.length}`);
  
  if (failed === 0) {
    console.log('\n🎉 所有测试通过！');
  } else {
    console.log('\n⚠️ 存在失败的测试，需要修复');
    process.exit(1);
  }
}

// 运行测试
runTests().catch(console.error);
