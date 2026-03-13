/**
 * AI 点击位置测试用例
 * 调用 AI 视觉模型识别点击位置，并在原图上标记
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// AI 配置（从 config.json 读取）
const AI_CONFIG = {
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  apiKey: 'sk-sp-4d918b486781461096452913453a8289',
  model: 'kimi-k2.5'
};

// 测试场景
const TEST_SCENARIOS = [
  {
    name: '点击QQ搜索框',
    description: '请识别QQ聊天窗口顶部的搜索框位置，返回搜索框中心点的坐标。搜索框位于QQ窗口顶部，显示"搜索"文字。'
  },
  {
    name: '点击微信图标',
    description: '请识别屏幕底部任务栏中的微信图标位置，返回微信图标中心点的坐标。微信图标是绿色的，位于任务栏右侧。'
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
        content: '你是一个视觉助手，可以识别图片中的UI元素位置。请分析图片并返回指定元素的点击坐标（x, y）。坐标系以图片左上角为原点(0,0)，右下角为最大值。只返回JSON格式：{"x": number, "y": number, "reason": "string"}'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${scenario.description} 请只返回JSON格式的坐标，不要其他解释。`
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
    max_tokens: 500
  };

  return new Promise((resolve, reject) => {
    const url = new URL(`${AI_CONFIG.baseUrl}/chat/completions`);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const content = response.choices[0].message.content;
          
          // 尝试从响应中提取 JSON
          const jsonMatch = content.match(/\{[^}]*\}/);
          if (jsonMatch) {
            const coords = JSON.parse(jsonMatch[0]);
            resolve(coords);
          } else {
            reject(new Error('无法从AI响应中解析坐标'));
          }
        } catch (error) {
          reject(new Error(`解析AI响应失败: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(requestData));
    req.end();
  });
}

/**
 * 创建标记后的图片（使用简单的HTML/Canvas方式）
 */
function createMarkedImageHtml(imagePath, scenarios, results) {
  const imageBase64 = imageToBase64(imagePath);
  
  const markers = results.map((result, index) => {
    const color = index === 0 ? '#ff0000' : '#00ff00';
    return `
      {
        x: ${result.x},
        y: ${result.y},
        color: '${color}',
        label: '${scenarios[index].name}',
        reason: '${result.reason || '无说明'}'
      }
    `;
  }).join(',');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI 点击位置测试结果</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: Arial, sans-serif;
      background: #1a1a1a;
      color: #fff;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin-bottom: 20px;
    }
    .canvas-container {
      position: relative;
      display: inline-block;
      border: 2px solid #444;
    }
    #canvas {
      display: block;
    }
    .info-panel {
      margin-top: 20px;
      padding: 15px;
      background: #2a2a2a;
      border-radius: 8px;
    }
    .scenario-result {
      margin: 10px 0;
      padding: 10px;
      background: #333;
      border-radius: 4px;
      border-left: 4px solid;
    }
    .scenario-result:nth-child(1) { border-left-color: #ff0000; }
    .scenario-result:nth-child(2) { border-left-color: #00ff00; }
    .legend {
      display: flex;
      gap: 20px;
      margin-bottom: 15px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .legend-color {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid #fff;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>AI 点击位置测试结果</h1>
    
    <div class="legend">
      <div class="legend-item">
        <div class="legend-color" style="background: #ff0000;"></div>
        <span>场景1: 点击QQ搜索框</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #00ff00;"></div>
        <span>场景2: 点击微信图标</span>
      </div>
    </div>
    
    <div class="canvas-container">
      <canvas id="canvas"></canvas>
    </div>
    
    <div class="info-panel">
      <h2>测试结果详情</h2>
      <div id="results"></div>
    </div>
  </div>

  <script>
    const markers = [${markers}];
    const imageSrc = 'data:image/png;base64,${imageBase64}';
    
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // 绘制标记
      markers.forEach((marker, index) => {
        // 绘制十字准星
        ctx.strokeStyle = marker.color;
        ctx.lineWidth = 3;
        const size = 30;
        
        // 横线
        ctx.beginPath();
        ctx.moveTo(marker.x - size, marker.y);
        ctx.lineTo(marker.x + size, marker.y);
        ctx.stroke();
        
        // 竖线
        ctx.beginPath();
        ctx.moveTo(marker.x, marker.y - size);
        ctx.lineTo(marker.x, marker.y + size);
        ctx.stroke();
        
        // 绘制中心点
        ctx.fillStyle = marker.color;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // 绘制外圈
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        
        // 绘制标签背景
        ctx.fillStyle = marker.color;
        ctx.fillRect(marker.x + 15, marker.y - 25, 150, 25);
        
        // 绘制标签文字
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(marker.label, marker.x + 20, marker.y - 8);
        
        // 绘制坐标
        ctx.fillStyle = marker.color;
        ctx.font = '12px Arial';
        ctx.fillText(\`(\${marker.x}, \${marker.y})\`, marker.x + 15, marker.y + 20);
      });
    };
    
    img.src = imageSrc;
    
    // 显示结果详情
    const resultsDiv = document.getElementById('results');
    markers.forEach((marker, index) => {
      const div = document.createElement('div');
      div.className = 'scenario-result';
      div.innerHTML = \`
        <strong>\${marker.label}</strong><br>
        坐标: (\${marker.x}, \${marker.y})<br>
        原因: \${marker.reason}
      \`;
      resultsDiv.appendChild(div);
    });
  </script>
</body>
</html>
  `;

  return html;
}

/**
 * 主测试函数
 */
async function runTest() {
  const imagePath = path.join(__dirname, 'demo-before.png');
  const outputPath = path.join(__dirname, 'ai-click-result.html');
  
  console.log('开始 AI 点击位置测试...');
  console.log('图片路径:', imagePath);
  console.log('');
  
  // 读取图片
  const base64Image = imageToBase64(imagePath);
  console.log('图片已加载，大小:', (base64Image.length / 1024).toFixed(2), 'KB');
  console.log('');
  
  const results = [];
  
  // 执行每个测试场景
  for (let i = 0; i < TEST_SCENARIOS.length; i++) {
    const scenario = TEST_SCENARIOS[i];
    console.log(`\n场景 ${i + 1}: ${scenario.name}`);
    console.log('描述:', scenario.description);
    console.log('正在调用 AI...');
    
    try {
      const coords = await getClickCoordinates(base64Image, scenario);
      console.log('AI 返回坐标:', coords);
      results.push(coords);
    } catch (error) {
      console.error('调用失败:', error.message);
      results.push({ x: 0, y: 0, reason: '调用失败: ' + error.message });
    }
    
    // 添加延迟避免请求过快
    if (i < TEST_SCENARIOS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // 生成结果 HTML
  console.log('\n\n生成结果图片...');
  const html = createMarkedImageHtml(imagePath, TEST_SCENARIOS, results);
  fs.writeFileSync(outputPath, html);
  
  console.log('');
  console.log('========================================');
  console.log('测试完成！');
  console.log('结果文件:', outputPath);
  console.log('请在浏览器中打开查看结果');
  console.log('========================================');
  
  // 输出坐标摘要
  console.log('\n坐标摘要:');
  results.forEach((result, index) => {
    console.log(`${TEST_SCENARIOS[index].name}: (${result.x}, ${result.y})`);
  });
}

// 运行测试
runTest().catch(console.error);
