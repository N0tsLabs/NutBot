/**
 * AI 视觉识别可操作元素测试
 * 使用视觉模型分析截图，标注可操作元素
 *
 * 自动读取 ~/.nutbot/config.json 中的 API 配置
 */

import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = __dirname;

// 读取 NutBot 配置
function loadConfig() {
	const configPath = join(homedir(), '.nutbot', 'config.json');
	if (!existsSync(configPath)) {
		throw new Error(`配置文件不存在: ${configPath}`);
	}
	return JSON.parse(readFileSync(configPath, 'utf8'));
}

// 获取第一个可用的 provider 配置
function getProvider(config) {
	const providers = config.providers || {};
	for (const [id, provider] of Object.entries(providers)) {
		if (provider.apiKey && provider.baseUrl) {
			return { id, ...provider };
		}
	}
	throw new Error('未找到有效的 API 配置');
}

// 元素类型颜色
const TYPE_COLORS = {
	button: { r: 255, g: 0, b: 0 }, // 红色
	link: { r: 128, g: 0, b: 255 }, // 紫色
	input: { r: 0, g: 255, b: 0 }, // 绿色
	icon: { r: 255, g: 165, b: 0 }, // 橙色
	tab: { r: 0, g: 255, b: 255 }, // 青色
	menu: { r: 255, g: 255, b: 0 }, // 黄色
	checkbox: { r: 255, g: 128, b: 0 }, // 深橙
	dropdown: { r: 0, g: 128, b: 255 }, // 天蓝
	image: { r: 128, g: 128, b: 0 }, // 橄榄
	text: { r: 100, g: 100, b: 255 }, // 淡蓝
	default: { r: 200, g: 200, b: 200 }, // 灰色
};

/**
 * 使用视觉模型分析截图中的可操作元素
 */
async function analyzeWithVision(base64Image, imageWidth, imageHeight, provider) {
	const prompt = `分析这张桌面截图中可点击的 UI 元素。

图片尺寸: ${imageWidth} x ${imageHeight} 像素

返回 JSON 数组，每个元素包含：
- type: button/link/input/icon/tab/menu/checkbox/dropdown
- name: 元素文字
- xPercent: 元素中心点的 X 位置（占图片宽度的百分比，0-100）
- yPercent: 元素中心点的 Y 位置（占图片高度的百分比，0-100）
- widthPercent: 元素宽度（占图片宽度的百分比）
- heightPercent: 元素高度（占图片高度的百分比）

例如：
- 图片正中央的元素: xPercent=50, yPercent=50
- 左上角的元素: xPercent 接近 0, yPercent 接近 0
- 右下角的元素: xPercent 接近 100, yPercent 接近 100

只返回 JSON 数组：`;

	// 选择视觉模型
	const visionModel = provider.visionModels?.[0] || 'gpt-4o';
	console.log(`使用模型: ${visionModel}`);
	console.log(`API: ${provider.baseUrl}`);
	console.log('正在调用 AI 分析截图...');
	
	const startTime = Date.now();

	// 使用 OpenAI 兼容 API
	const response = await fetch(`${provider.baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${provider.apiKey}`,
		},
		body: JSON.stringify({
			model: visionModel,
			max_tokens: 8192,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image_url',
							image_url: {
								url: `data:image/jpeg;base64,${base64Image}`,
							},
						},
						{
							type: 'text',
							text: prompt,
						},
					],
				},
			],
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`API 请求失败: ${response.status} - ${error}`);
	}

	const data = await response.json();
	const elapsed = Date.now() - startTime;
	console.log(`API 响应耗时: ${elapsed}ms`);

	// 解析响应
	const content = data.choices?.[0]?.message?.content || '';
	
	// 调试输出
	console.log('\n--- AI 原始响应 (前 500 字符) ---');
	console.log(content.slice(0, 500));
	console.log('--- 响应结束 ---\n');

	// 尝试提取 JSON
	let rawElements = [];
	try {
		// 尝试直接解析
		rawElements = JSON.parse(content);
	} catch {
		// 尝试从 markdown 代码块中提取
		const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			rawElements = JSON.parse(jsonMatch[1].trim());
		} else {
			// 尝试找到 [ 开始的位置
			const startIdx = content.indexOf('[');
			const endIdx = content.lastIndexOf(']');
			if (startIdx !== -1 && endIdx !== -1) {
				rawElements = JSON.parse(content.slice(startIdx, endIdx + 1));
			}
		}
	}

	// 将百分比坐标转换为像素坐标
	const elements = rawElements.map((el) => {
		// 如果已经是像素坐标，直接返回
		if (el.x !== undefined && el.y !== undefined) {
			return el;
		}
		
		// 从百分比转换为像素（中心点 -> 左上角）
		const centerX = (el.xPercent || 0) / 100 * imageWidth;
		const centerY = (el.yPercent || 0) / 100 * imageHeight;
		const w = (el.widthPercent || 2) / 100 * imageWidth;
		const h = (el.heightPercent || 2) / 100 * imageHeight;
		
		return {
			type: el.type,
			name: el.name,
			x: Math.round(centerX - w / 2),
			y: Math.round(centerY - h / 2),
			width: Math.round(w),
			height: Math.round(h),
		};
	});

	return elements;
}

/**
 * 创建 SVG 叠加层
 */
function createSvgOverlay(elements, width, height) {
	let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

	for (const el of elements) {
		const x = el.x || 0;
		const y = el.y || 0;
		const w = el.width || 50;
		const h = el.height || 20;

		// 跳过无效元素
		if (x < 0 || y < 0 || w <= 0 || h <= 0) continue;
		if (x + w > width || y + h > height) continue;

		// 获取颜色
		const color = TYPE_COLORS[el.type] || TYPE_COLORS.default;
		const strokeColor = `rgb(${color.r}, ${color.g}, ${color.b})`;

		// 绘制矩形边框
		svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" 
                fill="none" stroke="${strokeColor}" stroke-width="2"/>`;

		// 添加标签
		if (el.name) {
			const label = `${el.type}: ${el.name.slice(0, 15)}`;
			const fontSize = Math.max(8, Math.min(12, h / 2));
			const textY = Math.max(y + fontSize + 2, fontSize + 2);

			// 文字背景
			svg += `<rect x="${x}" y="${textY - fontSize}" width="${Math.min(label.length * fontSize * 0.55, w + 50)}" height="${fontSize + 2}" 
                    fill="rgba(0,0,0,0.8)" rx="2"/>`;
			// 文字
			svg += `<text x="${x + 2}" y="${textY}" font-size="${fontSize}" fill="white" 
                    font-family="Arial, sans-serif">${escapeXml(label)}</text>`;
		}
	}

	svg += '</svg>';
	return svg;
}

function escapeXml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * 主函数
 */
async function main() {
	console.log('='.repeat(60));
	console.log('AI 视觉识别可操作元素测试');
	console.log('='.repeat(60));

	// 1. 截图
	console.log('\n[1/4] 截取桌面截图...');
	const screenshotBuffer = await screenshot({ format: 'png' });

	// 获取截图尺寸
	const metadata = await sharp(screenshotBuffer).metadata();
	const imgWidth = metadata.width;
	const imgHeight = metadata.height;
	console.log(`截图尺寸: ${imgWidth} x ${imgHeight}`);

	// 转为 JPEG 减小体积（保持原尺寸）
	console.log('\n[2/4] 转换图片格式...');
	const jpegBuffer = await sharp(screenshotBuffer)
		.jpeg({ quality: 85 })
		.toBuffer();

	console.log(`JPEG 大小: ${(jpegBuffer.length / 1024).toFixed(1)} KB`);

	const base64Image = jpegBuffer.toString('base64');
	
	// 使用原图尺寸
	const compressedWidth = imgWidth;
	const compressedHeight = imgHeight;

	// 2. 加载配置并调用 AI 分析
	console.log('\n[3/4] AI 分析截图...');
	const config = loadConfig();
	const provider = getProvider(config);
	console.log(`使用 Provider: ${provider.id}`);

	let elements = [];
	try {
		elements = await analyzeWithVision(base64Image, compressedWidth, compressedHeight, provider);
		console.log(`AI 识别到 ${elements.length} 个可操作元素`);

		// 统计元素类型
		const typeStats = {};
		for (const el of elements) {
			typeStats[el.type] = (typeStats[el.type] || 0) + 1;
		}
		console.log('\n元素类型统计:');
		for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
			console.log(`  ${type}: ${count}`);
		}

		// 坐标不需要缩放（使用原图尺寸）
	} catch (error) {
		console.error('AI 分析失败:', error.message);
		return;
	}

	// 3. 生成可视化
	console.log('\n[4/4] 生成可视化图片...');
	const svgOverlay = createSvgOverlay(elements, imgWidth, imgHeight);
	const svgBuffer = Buffer.from(svgOverlay);

	const outputPath = join(OUTPUT_DIR, 'ui-elements-ai.png');
	await sharp(screenshotBuffer)
		.composite([{ input: svgBuffer, top: 0, left: 0 }])
		.png()
		.toFile(outputPath);

	console.log('\n' + '='.repeat(60));
	console.log(`✓ 输出图片: ${outputPath}`);
	console.log(`✓ AI 识别到 ${elements.length} 个可操作元素`);
	console.log('='.repeat(60));

	// 打印图例
	console.log('\n颜色图例:');
	console.log('  红色 - button (按钮)');
	console.log('  紫色 - link (链接)');
	console.log('  绿色 - input (输入框)');
	console.log('  橙色 - icon (图标)');
	console.log('  青色 - tab (标签页)');
	console.log('  黄色 - menu (菜单)');

	return outputPath;
}

main().catch(console.error);
