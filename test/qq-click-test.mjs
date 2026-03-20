/**
 * AI 点击 QQ 图标测试用例
 * 调用 AI 视觉模型识别 QQ 图标位置，并在原图上标记后输出图片
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// AI 配置（从 config.json 读取）
const AI_CONFIG = {
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  apiKey: 'sk-sp-4d918b486781461096452913453a8289',
  model: 'kimi-k2.5'
};

// 测试场景
const TEST_SCENARIOS = [
  {
    name: '点击QQ图标',
    description: '请仔细查看任务栏上的所有图标，找到QQ企鹅图标（通常是白色企鹅在蓝色或彩色背景上），返回QQ图标的准确中心坐标。如果找不到QQ图标，请返回 {"action": "not_found", "reason": "未找到QQ图标"}',
    color: '#ff0000'
  }
];

/**
 * 将图片转换为 base64
 */
function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

/**
 * 调用 AI 视觉模型获取点击坐标
 */
async function getClickCoordinates(base64Image, scenario) {
  const requestData = {
    model: AI_CONFIG.model,
    messages: [
      {
        role: 'system',
        content: '你是一个AI机器人助手，能够根据屏幕截图自主决策完成任务。请分析当前屏幕状态，决定如何完成用户的指令。你可以：1) 直接点击某个元素；2) 先输入搜索内容再点击；3) 多步骤操作。返回JSON格式：{"action": "click", "x": 0.5, "y": 0.5, "reason": "说明原因"}。其中x和y是相对坐标（0-1之间），坐标系以图片左上角为原点(0,0)，右下角为(1,1)。'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `任务：${scenario.description}。请分析当前屏幕截图，决定如何完成这个任务。如果需要点击，返回准确的坐标位置。只返回JSON格式，不要其他解释。`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 500,
    stream: false
  };

  // 构建正确的 URL
  let baseURL = AI_CONFIG.baseUrl;
  if (baseURL.endsWith('/v1') || baseURL.endsWith('/v1/')) {
    baseURL = baseURL + '/chat/completions';
  } else {
    baseURL = baseURL + '/v1/chat/completions';
  }

  console.log('  请求URL:', baseURL);
  console.log('  请求模型:', AI_CONFIG.model);

  try {
    const response = await fetch(baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestData)
    });

    console.log('  响应状态:', response.status);
    
    const data = await response.text();
    
    if (!response.ok) {
      console.log('  错误响应:', data.substring(0, 500));
      throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
    }

    const jsonResponse = JSON.parse(data);
    
    if (jsonResponse.error) {
      throw new Error(`API错误: ${jsonResponse.error.message}`);
    }
    
    const content = jsonResponse.choices[0].message.content;
    console.log('  AI原始响应:', content);
    
    // 尝试从响应中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      
      // 尝试修复常见的 AI JSON 错误
      // 修复: "x": 0.941, y": 0.972 -> "x": 0.941, "y": 0.972 (y前面缺少双引号)
      jsonStr = jsonStr.replace(/"x"\s*:\s*([\d.]+)\s*,\s*y"\s*:\s*([\d.]+)/, '"x": $1, "y": $2');
      // 修复: "x": 0.284, "0.483": 0.483 -> "x": 0.284, "y": 0.483
      jsonStr = jsonStr.replace(/"x"\s*:\s*([\d.]+)\s*,\s*"([\d.]+)"\s*:\s*([\d.]+)/, '"x": $1, "y": $2');
      // 修复: "x": 0.279, "0.506" -> "x": 0.279, "y": 0.506
      jsonStr = jsonStr.replace(/"x"\s*:\s*([\d.]+)\s*,\s*"([\d.]+)"/, '"x": $1, "y": $2');
      // 修复: "x":0.283,0.478] -> "x":0.283,"y":0.478}
      jsonStr = jsonStr.replace(/"x"\s*:\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/, '"x": $1, "y": $2}');
      
      try {
        const coords = JSON.parse(jsonStr);
        if (typeof coords.x === 'number' && typeof coords.y === 'number') {
          // 检查是否是相对坐标（0-1之间），如果是则转换为像素坐标
          const imageWidth = 1920;
          const imageHeight = 1080;
          
          // 保存相对坐标，后续根据实际图片尺寸转换
          coords._isRelative = true;
          
          return coords;
        } else {
          throw new Error('AI返回的坐标格式不正确');
        }
      } catch (e) {
        throw new Error(`JSON解析失败: ${e.message}，修复后JSON: ${jsonStr.substring(0, 200)}`);
      }
    } else {
      throw new Error('无法从AI响应中解析坐标');
    }
  } catch (error) {
    if (error.message.includes('fetch failed')) {
      throw new Error(`网络请求失败: ${error.cause?.message || error.message}`);
    }
    throw error;
  }
}

/**
 * 在图片上绘制标记
 */
async function drawMarkersOnImage(imagePath, results) {
  // 加载原图
  const image = await loadImage(imagePath);
  const imageWidth = image.width;
  const imageHeight = image.height;
  
  console.log(`  图片尺寸: ${imageWidth}x${imageHeight}`);
  
  // 创建画布
  const canvas = createCanvas(imageWidth, imageHeight);
  const ctx = canvas.getContext('2d');
  
  // 绘制原图
  ctx.drawImage(image, 0, 0);
  
  // 绘制每个标记
  results.forEach((result, index) => {
    const scenario = TEST_SCENARIOS[index];
    
    // 如果是相对坐标，转换为实际像素坐标
    let x = result.x;
    let y = result.y;
    if (result._isRelative) {
      x = Math.round(result.x * imageWidth);
      y = Math.round(result.y * imageHeight);
      console.log(`  ${scenario.name}: 相对坐标 (${result.x}, ${result.y}) -> 像素坐标 (${x}, ${y})`);
    }
    const color = scenario.color;
    
    // 绘制十字准星
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    const size = 30;
    
    // 横线
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();
    
    // 竖线
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    
    // 绘制中心点
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // 绘制外圈
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    
    // 绘制标签背景
    ctx.fillStyle = color;
    const labelWidth = 180;
    const labelHeight = 50;
    ctx.fillRect(x + 15, y - 35, labelWidth, labelHeight);
    
    // 绘制标签文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(scenario.name, x + 20, y - 18);
    
    // 绘制坐标
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`(${x}, ${y})`, x + 20, y - 5);
  });
  
  // 返回 PNG 数据
  return canvas.toBuffer('image/png');
}

/**
 * 主测试函数
 */
async function runTest() {
  const imagePath = path.join(__dirname, 'qq-test-screenshot.png');
  const outputPath = path.join(__dirname, 'qq-click-result.png');
  
  console.log('========================================');
  console.log('AI 点击 QQ 图标测试');
  console.log('========================================');
  console.log('图片路径:', imagePath);
  console.log('');
  
  // 读取图片
  const base64Image = imageToBase64(imagePath);
  console.log('✓ 图片已加载，大小:', (base64Image.length / 1024).toFixed(2), 'KB');
  console.log('');
  
  const results = [];
  
  // 执行每个测试场景
  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const scenario = TEST_SCENARIOS[i];
    console.log(`\n----------------------------------------`);
    console.log(`场景 ${i + 1}: ${scenario.name}`);
    console.log('----------------------------------------');
    console.log('描述:', scenario.description);
    console.log('');
    
    try {
      const coords = await getClickCoordinates(base64Image, scenario);
      console.log('✓ AI 返回坐标:', JSON.stringify(coords));
      results.push(coords);
    } catch (error) {
      console.error('✗ 调用失败:', error.message);
      results.push({ x: 0, y: 0, reason: '调用失败: ' + error.message });
    }
    
    // 添加延迟避免请求过快
    if (i < TEST_SCENARIOS.length - 1) {
      console.log('\n等待 1 秒...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // 生成标记后的图片
  console.log('\n\n========================================');
  console.log('生成结果图片...');
  console.log('========================================');
  
  try {
    const imageBuffer = await drawMarkersOnImage(imagePath, results);
    fs.writeFileSync(outputPath, imageBuffer);
    console.log('');
    console.log('✓ 结果图片已保存:', outputPath);
  } catch (error) {
    console.error('✗ 生成图片失败:', error.message);
    throw error;
  }
  
  console.log('');
  console.log('========================================');
  console.log('测试完成！');
  console.log('========================================');
  console.log('');
  console.log('坐标摘要:');
  console.log('----------------------------------------');
  results.forEach((result, index) => {
    const status = (result.x === 0 && result.y === 0) ? '✗' : '✓';
    console.log(`${status} ${TEST_SCENARIOS[index].name}: (${result.x}, ${result.y})`);
    if (result.reason) {
      console.log(`   说明: ${result.reason}`);
    }
  });
  console.log('----------------------------------------');
}

// 运行测试
runTest().catch(console.error);
