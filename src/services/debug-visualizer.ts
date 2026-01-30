/**
 * 调试可视化服务
 * 生成 AI 操作的可视化图片
 */

import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const log = logger.child('DebugVisualizer');

// 调试图片保存目录（改为 screenshots 与截图工具保持一致）
const DEBUG_DIR = path.join(os.homedir(), '.nutbot', 'screenshots', 'debug');

// 确保调试目录存在
function ensureDebugDir(): string {
    if (!fs.existsSync(DEBUG_DIR)) {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }
    return DEBUG_DIR;
}

/**
 * 保存调试图片到文件夹
 */
export async function saveDebugImages(
    step: number,
    images: {
        original?: string;  // base64
        marked?: string;    // base64
        click?: string;     // base64
    },
    actionDescription?: string
): Promise<{ dir: string; files: string[] }> {
    const debugDir = ensureDebugDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const stepDir = path.join(debugDir, `${timestamp}_step${step}`);
    
    if (!fs.existsSync(stepDir)) {
        fs.mkdirSync(stepDir, { recursive: true });
    }
    
    const savedFiles: string[] = [];
    
    try {
        // 保存原始截图
        if (images.original) {
            const filePath = path.join(stepDir, '1_original.png');
            fs.writeFileSync(filePath, Buffer.from(images.original, 'base64'));
            savedFiles.push(filePath);
            log.info(`保存原图: ${filePath}`);
        }
        
        // 保存 OCR-SoM 标注图
        if (images.marked) {
            const filePath = path.join(stepDir, '2_marked.png');
            fs.writeFileSync(filePath, Buffer.from(images.marked, 'base64'));
            savedFiles.push(filePath);
            log.info(`保存标注图: ${filePath}`);
        }
        
        // 保存点击位置图
        if (images.click) {
            const filePath = path.join(stepDir, '3_click.png');
            fs.writeFileSync(filePath, Buffer.from(images.click, 'base64'));
            savedFiles.push(filePath);
            log.info(`保存点击图: ${filePath}`);
        }
        
        // 保存操作描述到 info.txt
        if (actionDescription) {
            const infoPath = path.join(stepDir, 'info.txt');
            fs.writeFileSync(infoPath, `操作: ${actionDescription}\n时间: ${new Date().toLocaleString('zh-CN')}\n`);
        }
        
        log.info(`调试图片已保存到: ${stepDir}`);
        return { dir: stepDir, files: savedFiles };
    } catch (error) {
        log.error('保存调试图片失败:', error);
        return { dir: stepDir, files: savedFiles };
    }
}

/**
 * 获取调试图片目录
 */
export function getDebugDir(): string {
    return ensureDebugDir();
}

/**
 * 清理旧的调试图片（保留最近 N 个）
 */
export function cleanupOldDebugImages(keepCount: number = 50): void {
    try {
        const debugDir = ensureDebugDir();
        const dirs = fs.readdirSync(debugDir)
            .filter(f => fs.statSync(path.join(debugDir, f)).isDirectory())
            .sort()
            .reverse();
        
        // 删除超出保留数量的目录
        for (let i = keepCount; i < dirs.length; i++) {
            const dirPath = path.join(debugDir, dirs[i]);
            fs.rmSync(dirPath, { recursive: true, force: true });
            log.debug(`清理旧调试目录: ${dirs[i]}`);
        }
    } catch (error) {
        log.warn('清理旧调试图片失败:', error);
    }
}

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
