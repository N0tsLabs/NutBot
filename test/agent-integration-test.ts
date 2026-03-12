/**
 * Agent 集成测试
 * 模拟完整的 AI 交互流程，验证决策链
 */

// 模拟工具执行结果
const mockToolResults: Record<string, any> = {
  'browser.goto': {
    success: true,
    url: 'https://www.bilibili.com/',
    title: '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
    elements: [
      '[0] [SEARCH][可输入] textbox: 搜索框',
      '[1] [NAVIGATION] link: 首页',
      '[2] [NAVIGATION] link: 番剧',
      '[3] [NAVIGATION] link: 直播',
      '[4] [BUTTON] button: 搜索',
      '[5] [PROMOTION] link: 下载客户端',
    ],
    content: '首页内容...',
  },
  'browser.type': {
    success: true,
    action: 'type',
    typed: '影视飓风',
    elements: [
      '[0] [SEARCH][可输入] textbox: 影视飓风',
      '[1] [NAVIGATION] link: 首页',
      '[2] [BUTTON] button: 搜索',
    ],
  },
  'browser.press': {
    success: true,
    action: 'press',
    pressed: 'Enter',
    url: 'https://search.bilibili.com/all?keyword=影视飓风',
    elements: [
      '[0] [SEARCH][可输入] textbox: 影视飓风',
      '[1] [BUTTON] button: 搜索',
      '[2] [LINK] link: 【影视飓风】年度最震撼视频',
      '[3] [LINK] link: 【影视飓风】摄影技巧分享',
      '[4] [LINK] link: 【影视飓风】设备评测',
    ],
  },
  'browser.click': {
    success: true,
    action: 'click',
    clicked: '[2] 【影视飓风】年度最震撼视频',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    newTab: true,
    elements: [
      '[0] [BUTTON] button: 播放',
      '[1] [BUTTON] button: 点赞',
      '[2] [BUTTON] button: 收藏',
    ],
  },
};

// 模拟 AI 决策（基于当前上下文）
function simulateAIResponse(
  userInput: string,
  history: any[],
  availableTools: any[]
): { tool: string; params: any; reason: string } | null {
  const lastResult = history.length > 0 ? history[history.length - 1].result : null;
  const lastAction = lastResult?.action;
  const elements = lastResult?.elements || [];

  // 场景 1: 打开网站
  if (userInput.includes('打开') && userInput.includes('Bilibili')) {
    return {
      tool: 'browser',
      params: { action: 'goto', url: 'https://www.bilibili.com' },
      reason: '用户要求打开 Bilibili',
    };
  }

  // 场景 2: 搜索（在 goto 之后）
  if (userInput.includes('搜索')) {
    // 如果已经输入了文本，按回车
    if (lastAction === 'type') {
      return {
        tool: 'browser',
        params: { action: 'press', key: 'Enter' },
        reason: '已输入搜索文本，按 Enter 提交',
      };
    }

    // 否则输入文本
    const searchIndex = elements.findIndex((e: string) => e.includes('[SEARCH]'));
    if (searchIndex >= 0) {
      const match = userInput.match(/搜索\s*([^并]+)/);
      const keyword = match ? match[1].trim() : '';
      return {
        tool: 'browser',
        params: { action: 'type', index: searchIndex, text: keyword },
        reason: `在搜索框索引 ${searchIndex} 输入关键词`,
      };
    }
  }

  // 场景 3: 点击搜索结果
  if (userInput.includes('点击') && userInput.includes('视频')) {
    const linkIndex = elements.findIndex((e: string) =>
      e.includes('[LINK]') && e.includes('视频')
    );
    if (linkIndex >= 0) {
      return {
        tool: 'browser',
        params: { action: 'click', index: linkIndex },
        reason: `点击视频链接索引 ${linkIndex}`,
      };
    }
  }

  // 场景 4: 任务完成
  if (userInput.includes('完成') || userInput.includes('结束')) {
    return null; // 表示任务完成
  }

  return null;
}

// 运行完整流程测试
async function runIntegrationTest() {
  console.log('=== Agent 集成测试 ===\n');
  console.log('测试场景: 打开 Bilibili -> 搜索 影视飓风 -> 点击第一个视频\n');

  const history: any[] = [];
  const steps = [
    { input: '打开 Bilibili', expectedTool: 'browser.goto' },
    { input: '搜索 影视飓风', expectedTool: 'browser.type' },
    { input: '搜索 影视飓风', expectedTool: 'browser.press' },
    { input: '点击第一个视频', expectedTool: 'browser.click' },
    { input: '任务完成', expectedTool: null },
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`\n【步骤 ${i + 1}】用户输入: "${step.input}"`);

    const decision = simulateAIResponse(step.input, history, []);

    if (step.expectedTool === null) {
      if (decision === null) {
        console.log('✅ 任务正确结束');
        passed++;
      } else {
        console.log(`❌ 期望任务结束，但 AI 返回: ${decision.tool}`);
        failed++;
      }
      continue;
    }

    if (!decision) {
      console.log('❌ AI 没有返回决策');
      failed++;
      continue;
    }

    const actualTool = `${decision.tool}.${decision.params.action}`;
    console.log(`AI 决策: ${actualTool}`);
    console.log(`原因: ${decision.reason}`);

    // 验证决策
    if (actualTool === step.expectedTool) {
      console.log('✅ 决策正确');
      passed++;

      // 模拟执行工具并记录结果
      const resultKey = `${decision.tool}.${decision.params.action}`;
      const result = mockToolResults[resultKey] || { success: true };
      history.push({
        input: step.input,
        tool: actualTool,
        params: decision.params,
        result,
      });
    } else {
      console.log(`❌ 期望: ${step.expectedTool}, 实际: ${actualTool}`);
      failed++;
    }
  }

  console.log(`\n=== 测试结果 ===`);
  console.log(`通过: ${passed}/${steps.length}`);
  console.log(`失败: ${failed}/${steps.length}`);

  if (failed === 0) {
    console.log('\n🎉 集成测试通过！');
    console.log('\n完整执行流程:');
    history.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.tool} -> ${h.result.url || 'OK'}`);
    });
  } else {
    console.log('\n⚠️ 存在失败的步骤');
    process.exit(1);
  }
}

// 运行测试
runIntegrationTest().catch(console.error);
