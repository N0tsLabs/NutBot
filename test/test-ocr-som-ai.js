/**
 * OCR-SoM + AI 集成测试
 * 
 * 测试流程：
 * 1. 读取截图（demo-before.png）
 * 2. 调用 OCR-SoM API 获取元素标注
 * 3. 把原图 + 标注图 + 元素列表发给 AI
 * 4. AI 决定应该点击哪里来完成任务
 * 
 * 使用前需要：
 * 1. 启动 OCR-SoM 服务：cd ../ocr-som && python server.py
 * 2. 配置 AI：~/.nutbot/config.json 中的 providers
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置
const OCR_SOM_API = 'http://localhost:5000';
const CONFIG_PATH = path.join(os.homedir(), '.nutbot', 'config.json');

/**
 * 读取 NutBot 配置
 */
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error('❌ 未找到配置文件:', CONFIG_PATH);
        console.log('请先运行 NutBot 并配置 AI Provider');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

/**
 * 调用 OCR-SoM API
 */
async function callOcrSom(imagePath) {
    console.log('\n📸 调用 OCR-SoM API...');
    
    const imageBuffer = fs.readFileSync(imagePath);
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer]), 'screenshot.png');
    
    try {
        const response = await fetch(`${OCR_SOM_API}/som`, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            throw new Error(`OCR-SoM API 错误: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ OCR-SoM 识别完成: ${data.count} 个元素`);
        return data;
    } catch (error) {
        console.error('❌ OCR-SoM API 调用失败:', error.message);
        console.log('请确保 OCR-SoM 服务正在运行: cd ../ocr-som && python server.py');
        process.exit(1);
    }
}

/**
 * 调用 AI API
 */
async function callAI(config, messages) {
    // 获取默认 provider 和 model
    const defaultModel = config.agent?.defaultModel;
    if (!defaultModel) {
        console.error('❌ 未配置默认模型 (agent.defaultModel)');
        process.exit(1);
    }
    
    // 解析 provider/model 格式（如 gpt/gpt-5.2）
    let providerName, modelName;
    if (defaultModel.includes('/')) {
        [providerName, modelName] = defaultModel.split('/');
    } else {
        providerName = Object.keys(config.providers)[0];
        modelName = defaultModel;
    }
    
    const providerConfig = config.providers[providerName];
    if (!providerConfig) {
        console.error(`❌ 未找到 Provider: ${providerName}`);
        console.log(`   可用 Providers: ${Object.keys(config.providers).join(', ')}`);
        process.exit(1);
    }
    
    const baseUrl = providerConfig.baseUrl || providerConfig.baseURL;
    if (!baseUrl) {
        console.error(`❌ Provider ${providerName} 没有配置 baseUrl`);
        process.exit(1);
    }
    
    console.log(`\n🤖 调用 AI: ${providerName}/${modelName}`);
    console.log(`   API: ${baseUrl}`);
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: modelName,
            messages,
            max_tokens: 2000,
            temperature: 0.3,
        }),
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`AI API 错误: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * 格式化元素列表（简化显示）
 */
function formatElements(elements) {
    return elements.map(el => {
        const [x1, y1, x2, y2] = el.box;
        const centerX = Math.round((x1 + x2) / 2);
        const centerY = Math.round((y1 + y2) / 2);
        return {
            id: el.id,
            type: el.type,
            text: el.text || '(无文字)',
            center: [centerX, centerY],
            box: el.box,
        };
    });
}

/**
 * 主测试函数
 */
async function main() {
    console.log('═'.repeat(60));
    console.log('  OCR-SoM + AI 集成测试');
    console.log('═'.repeat(60));
    
    // 1. 加载配置
    console.log('\n📂 加载配置...');
    const config = loadConfig();
    console.log(`✅ 配置加载成功`);
    console.log(`   默认模型: ${config.agent?.defaultModel || '未设置'}`);
    console.log(`   Providers: ${Object.keys(config.providers || {}).join(', ') || '无'}`);
    
    // 2. 读取测试图片
    const imagePath = path.join(__dirname, 'demo-before.png');
    if (!fs.existsSync(imagePath)) {
        console.error('❌ 测试图片不存在:', imagePath);
        process.exit(1);
    }
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    console.log(`\n📷 测试图片: ${imagePath}`);
    
    // 3. 调用 OCR-SoM
    const somResult = await callOcrSom(imagePath);
    const elements = formatElements(somResult.elements);
    
    // 打印部分元素
    console.log('\n📋 识别到的元素（前20个）:');
    elements.slice(0, 20).forEach(el => {
        console.log(`   [${el.id}] ${el.type === 'text' ? '📝' : '🔲'} "${el.text}" @ (${el.center.join(', ')})`);
    });
    if (elements.length > 20) {
        console.log(`   ... 还有 ${elements.length - 20} 个元素`);
    }
    
    // 4. 构建 AI 消息
    const task = '在QQ中搜索"坚果小栈"';
    
    const systemPrompt = `你是一个桌面自动化助手。你的任务是分析屏幕截图和 OCR 识别结果，告诉用户应该点击哪里来完成任务。

## 输入信息
1. **原始截图** - 用户屏幕的原始图像
2. **标注截图** - 每个可交互元素都被框出并标上了编号 [0] [1] [2]...
3. **元素列表** - 所有识别到的元素，包含编号、类型、文字内容、坐标

## 输出格式
请分析后给出：
1. 当前屏幕状态描述
2. 要完成任务需要的操作步骤
3. 每一步应该点击哪个编号的元素，以及它的坐标

## 注意
- 编号对应标注图上的数字
- 坐标是 [x, y]，表示元素中心点
- 如果需要输入文字，说明在哪个元素输入什么内容`;

    const userMessage = `## 任务
${task}

## 元素列表
共 ${elements.length} 个元素：
${JSON.stringify(elements, null, 2)}

请分析原始截图和标注截图，告诉我应该如何操作来完成任务。`;

    const messages = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: [
                { type: 'text', text: userMessage },
                { 
                    type: 'text', 
                    text: '\n\n## 原始截图（未标注）' 
                },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${imageBase64}` }
                },
                { 
                    type: 'text', 
                    text: '\n\n## 标注截图（带编号）' 
                },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${somResult.marked_image}` }
                },
            ]
        }
    ];
    
    // 5. 调用 AI
    console.log(`\n🎯 任务: ${task}`);
    console.log('\n⏳ AI 正在分析...\n');
    
    try {
        const aiResponse = await callAI(config, messages);
        
        console.log('─'.repeat(60));
        console.log('🤖 AI 分析结果:');
        console.log('─'.repeat(60));
        console.log(aiResponse);
        console.log('─'.repeat(60));
        
        // 保存标注图供查看
        const markedImagePath = path.join(__dirname, 'demo-marked.png');
        fs.writeFileSync(markedImagePath, Buffer.from(somResult.marked_image, 'base64'));
        console.log(`\n📁 标注图已保存: ${markedImagePath}`);
        
    } catch (error) {
        console.error('❌ AI 调用失败:', error.message);
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('  测试完成');
    console.log('═'.repeat(60));
}

// 运行
main().catch(console.error);
