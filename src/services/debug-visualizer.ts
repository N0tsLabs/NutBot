/**
 * 调试可视化服务
 * 生成 AI 操作的可视化图片
 */

import sharp from 'sharp';
import { logger } from '../utils/logger.js';

const log = logger.child('DebugVisualizer');

export interface ClickVisualization {
    originalImage: string;  // base64
    markedImage?: string;   // OCR-SoM 标注图 base64
    clickImage: string;     // 点击位置图 base64
    elements?: Array<{
        id: number;
        type: string;
        text: string;
        box: [number, number, number, number];
    }>;
}

/**
 * 在图片上绘制点击位置
 */
export async function drawClickPosition(
    imageBase64: string,
    coordinate: [number, number],
    label?: string
): Promise<string> {
    const [x, y] = coordinate;
    
    try {
        // 解码 base64 图片
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const metadata = await sharp(imageBuffer).metadata();
        const { width = 1920, height = 1080 } = metadata;
        
        // 创建 SVG 叠加层
        const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <!-- 半透明遮罩 -->
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.25)"/>
            
            <!-- 点击位置亮区（圆形） -->
            <defs>
                <mask id="spotlight">
                    <rect width="100%" height="100%" fill="white"/>
                    <circle cx="${x}" cy="${y}" r="120" fill="black"/>
                </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.25)" mask="url(#spotlight)"/>
            
            <!-- 红色十字准星 -->
            <line x1="${x - 50}" y1="${y}" x2="${x + 50}" y2="${y}" stroke="#ff0000" stroke-width="4"/>
            <line x1="${x}" y1="${y - 50}" x2="${x}" y2="${y + 50}" stroke="#ff0000" stroke-width="4"/>
            
            <!-- 红色圆圈 -->
            <circle cx="${x}" cy="${y}" r="40" fill="none" stroke="#ff0000" stroke-width="4"/>
            <circle cx="${x}" cy="${y}" r="60" fill="none" stroke="rgba(255,0,0,0.5)" stroke-width="2"/>
            <circle cx="${x}" cy="${y}" r="80" fill="none" stroke="rgba(255,0,0,0.3)" stroke-width="1"/>
            
            <!-- 标签背景 -->
            ${label ? `
            <rect x="${Math.min(x + 80, width - 300)}" y="${Math.max(y - 50, 10)}" 
                  width="280" height="40" rx="6" fill="rgba(220,0,0,0.95)"/>
            <text x="${Math.min(x + 95, width - 285)}" y="${Math.max(y - 20, 40)}" 
                  font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="white">
                🎯 ${escapeXml(label.substring(0, 25))}
            </text>
            ` : ''}
            
            <!-- 坐标显示 -->
            <rect x="${x - 50}" y="${y + 70}" width="100" height="28" rx="4" fill="rgba(0,0,0,0.85)"/>
            <text x="${x}" y="${y + 90}" text-anchor="middle" 
                  font-family="Arial, sans-serif" font-size="16" fill="white">
                (${x}, ${y})
            </text>
        </svg>`;
        
        // 合成图片
        const outputBuffer = await sharp(imageBuffer)
            .composite([{
                input: Buffer.from(svg),
                top: 0,
                left: 0,
            }])
            .png()
            .toBuffer();
        
        return outputBuffer.toString('base64');
    } catch (error) {
        log.error('生成点击位置图失败:', error);
        // 返回原图
        return imageBase64;
    }
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * 在图片上绘制元素高亮
 */
export async function drawElementHighlight(
    imageBase64: string,
    elementId: number,
    elements: Array<{ id: number; box: [number, number, number, number]; text?: string }>
): Promise<string> {
    const element = elements.find(e => e.id === elementId);
    if (!element) {
        return imageBase64;
    }
    
    const [x1, y1, x2, y2] = element.box;
    const cx = Math.round((x1 + x2) / 2);
    const cy = Math.round((y1 + y2) / 2);
    
    return drawClickPosition(imageBase64, [cx, cy], element.text || `元素 #${elementId}`);
}

export default {
    drawClickPosition,
    drawElementHighlight,
};
