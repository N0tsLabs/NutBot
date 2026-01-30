/**
 * UI Automation 可视化测试
 * 截图桌面并绘制所有检测到的 UI 元素
 */

import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

// 脚本缓存目录
const SCRIPT_DIR = join(tmpdir(), 'nutbot-scripts');
if (!existsSync(SCRIPT_DIR)) {
	mkdirSync(SCRIPT_DIR, { recursive: true });
}

// 输出目录 - 脚本当前目录
const OUTPUT_DIR = __dirname;

// Windows UI Automation PowerShell 脚本 - 深度获取所有元素
const UI_AUTOMATION_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-UIElements {
    param(
        [System.Windows.Automation.AutomationElement]$element,
        [int]$depth = 0,
        [int]$maxDepth = 12
    )
    
    $results = @()
    
    $rect = $null
    try { $rect = $element.Current.BoundingRectangle } catch { return $results }
    
    $ctrlType = ""
    try { $ctrlType = $element.Current.ControlType.ProgrammaticName -replace 'ControlType\\.', '' } catch {}
    
    if ($rect -and $rect.Width -gt 1 -and $rect.Height -gt 1 -and $rect.X -ge -100 -and $rect.Y -ge -100 -and $rect.Width -lt 10000 -and $rect.Height -lt 10000) {
        $name = ""
        $automationId = ""
        $className = ""
        $isEnabled = $true
        $isOffscreen = $false
        
        try { $name = $element.Current.Name } catch {}
        try { $automationId = $element.Current.AutomationId } catch {}
        try { $className = $element.Current.ClassName } catch {}
        try { $isEnabled = $element.Current.IsEnabled } catch {}
        try { $isOffscreen = $element.Current.IsOffscreen } catch {}
        
        $obj = [PSCustomObject]@{
            Name = $name
            Type = $ctrlType
            X = [int]$rect.X
            Y = [int]$rect.Y
            Width = [int]$rect.Width
            Height = [int]$rect.Height
            AutomationId = $automationId
            ClassName = $className
            Depth = $depth
            IsEnabled = $isEnabled
            IsOffscreen = $isOffscreen
        }
        $results += $obj
    }
    
    if ($depth -lt $maxDepth) {
        $children = $null
        try { $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) } catch {}
        if ($children) {
            foreach ($child in $children) {
                $childResults = Get-UIElements -element $child -depth ($depth + 1) -maxDepth $maxDepth
                $results += $childResults
            }
        }
    }
    
    return $results
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$allElements = @()

foreach ($window in $windows) {
    $rect = $null
    try { $rect = $window.Current.BoundingRectangle } catch { continue }
    
    if ($rect -and $rect.Width -gt 10 -and $rect.Height -gt 10 -and $rect.X -gt -5000) {
        $windowElements = Get-UIElements -element $window -depth 0 -maxDepth 12
        $allElements += $windowElements
    }
}

$json = $allElements | ConvertTo-Json -Depth 10 -Compress
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $json
`;

// 不同类型元素的颜色配置
const TYPE_COLORS = {
	Button: { r: 255, g: 0, b: 0 }, // 红色
	MenuItem: { r: 255, g: 165, b: 0 }, // 橙色
	Edit: { r: 0, g: 255, b: 0 }, // 绿色
	Text: { r: 0, g: 0, b: 255 }, // 蓝色
	ListItem: { r: 255, g: 255, b: 0 }, // 黄色
	TreeItem: { r: 255, g: 0, b: 255 }, // 品红
	TabItem: { r: 0, g: 255, b: 255 }, // 青色
	Hyperlink: { r: 128, g: 0, b: 255 }, // 紫色
	CheckBox: { r: 255, g: 128, b: 0 }, // 深橙
	RadioButton: { r: 128, g: 255, b: 0 }, // 黄绿
	ComboBox: { r: 0, g: 128, b: 255 }, // 天蓝
	Window: { r: 128, g: 128, b: 128 }, // 灰色
	Pane: { r: 64, g: 64, b: 64 }, // 深灰
	default: { r: 200, g: 200, b: 200 }, // 浅灰
};

/**
 * 获取 Windows UI 元素
 */
async function getWindowsUIElements() {
	const scriptPath = join(SCRIPT_DIR, 'ui-automation-test.ps1');
	writeFileSync(scriptPath, UI_AUTOMATION_SCRIPT, 'utf8');

	try {
		console.log('正在获取 UI 元素...');
		const startTime = Date.now();

		const { stdout } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
			maxBuffer: 50 * 1024 * 1024,
			timeout: 60000,
			encoding: 'utf8',
		});

		const elapsed = Date.now() - startTime;
		console.log(`UI Automation 耗时: ${elapsed}ms`);

		const data = JSON.parse(stdout);
		const rawElements = Array.isArray(data) ? data : [data];

		// 转换格式
		const elements = rawElements
			.filter((e) => e && e.Width > 0 && e.Height > 0)
			.map((e) => ({
				name: e.Name || '',
				type: (e.Type || 'Unknown').replace('ControlType.', ''),
				x: e.X,
				y: e.Y,
				width: e.Width,
				height: e.Height,
				automationId: e.AutomationId,
				depth: e.Depth || 0,
			}));

		console.log(`获取到 ${elements.length} 个元素`);
		return elements;
	} catch (error) {
		console.error('UI Automation 失败:', error.message);
		return [];
	}
}

// 需要过滤掉的容器类型元素
const CONTAINER_TYPES = ['Window', 'Pane', 'Group', 'Document', 'Custom', 'ToolBar', 'StatusBar', 'List', 'Tab', 'ScrollBar'];

/**
 * 创建 SVG 叠加层
 */
function createSvgOverlay(elements, width, height, scale = 1) {
	let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

	// 过滤掉容器类型，只保留具体元素
	const filteredElements = elements.filter((el) => !CONTAINER_TYPES.includes(el.type));

	// 按深度排序，深度大的后绘制（显示在上层）
	const sortedElements = [...filteredElements].sort((a, b) => a.depth - b.depth);

	for (const el of sortedElements) {
		// 转换坐标（考虑缩放）
		const x = Math.round(el.x * scale);
		const y = Math.round(el.y * scale);
		const w = Math.round(el.width * scale);
		const h = Math.round(el.height * scale);

		// 跳过超出屏幕的元素
		if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
		// 跳过太大的元素
		if (w > width * 0.5 || h > height * 0.5) continue;

		// 获取颜色
		const color = TYPE_COLORS[el.type] || TYPE_COLORS.default;
		const strokeColor = `rgb(${color.r}, ${color.g}, ${color.b})`;

		// 绘制矩形边框，无填充
		svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" 
                fill="none" stroke="${strokeColor}" stroke-width="2"/>`;

		// 添加类型标签（只对有名称的元素）
		if (el.name && el.name.trim()) {
			const label = `${el.type}: ${el.name.slice(0, 15)}`;
			const fontSize = Math.max(8, Math.min(10, h / 2));
			const textY = Math.max(y + fontSize + 2, fontSize + 2);

			// 文字背景
			svg += `<rect x="${x}" y="${textY - fontSize}" width="${Math.min(label.length * fontSize * 0.55, w)}" height="${fontSize + 2}" 
                    fill="rgba(0,0,0,0.8)" rx="2"/>`;
			// 文字
			svg += `<text x="${x + 2}" y="${textY}" font-size="${fontSize}" fill="white" 
                    font-family="Arial, sans-serif">${escapeXml(label)}</text>`;
		}
	}

	svg += '</svg>';
	return svg;
}

/**
 * 转义 XML 特殊字符
 */
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
	console.log('UI Automation 可视化测试');
	console.log('='.repeat(60));

	// 1. 截图
	console.log('\n[1/4] 截取桌面截图...');
	const screenshotBuffer = await screenshot({ format: 'png' });
	console.log(`截图大小: ${(screenshotBuffer.length / 1024 / 1024).toFixed(2)} MB`);

	// 获取截图尺寸
	const metadata = await sharp(screenshotBuffer).metadata();
	const imgWidth = metadata.width;
	const imgHeight = metadata.height;
	console.log(`截图尺寸: ${imgWidth} x ${imgHeight}`);

	// 2. 获取 UI 元素
	console.log('\n[2/4] 获取 UI 元素...');
	const elements = await getWindowsUIElements();

	if (elements.length === 0) {
		console.error('未能获取到任何 UI 元素！');
		return;
	}

	// 统计元素类型
	const typeStats = {};
	for (const el of elements) {
		typeStats[el.type] = (typeStats[el.type] || 0) + 1;
	}
	console.log('\n元素类型统计:');
	for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${type}: ${count}`);
	}

	// 3. 创建可视化叠加层
	console.log('\n[3/4] 生成可视化叠加层...');
	const svgOverlay = createSvgOverlay(elements, imgWidth, imgHeight);

	// 4. 合成图片
	console.log('\n[4/4] 合成输出图片...');
	const svgBuffer = Buffer.from(svgOverlay);

	const outputPath = join(OUTPUT_DIR, 'ui-elements.png');
	await sharp(screenshotBuffer)
		.composite([{ input: svgBuffer, top: 0, left: 0 }])
		.png()
		.toFile(outputPath);

	console.log('\n' + '='.repeat(60));
	console.log(`✓ 输出图片: ${outputPath}`);
	console.log(`✓ 检测到 ${elements.length} 个 UI 元素`);
	console.log('='.repeat(60));

	// 打印图例
	console.log('\n颜色图例:');
	console.log('  红色 - Button (按钮)');
	console.log('  橙色 - MenuItem (菜单项)');
	console.log('  绿色 - Edit (输入框)');
	console.log('  蓝色 - Text (文本)');
	console.log('  黄色 - ListItem (列表项)');
	console.log('  品红 - TreeItem (树形项)');
	console.log('  青色 - TabItem (标签页)');
	console.log('  紫色 - Hyperlink (超链接)');

	return outputPath;
}

main().catch(console.error);
