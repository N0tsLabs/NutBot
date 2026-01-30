/**
 * OCR-SoM 服务
 * 集成 OCR-SoM API，提供屏幕元素识别和标注功能
 */

import { logger } from '../utils/logger.js';
import { configManager } from '../utils/config.js';

export interface OcrElement {
    id: number;
    type: 'text' | 'ui';
    text: string;
    confidence?: number;
    box: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface OcrSomResult {
    success: boolean;
    count: number;
    elements: OcrElement[];
    marked_image?: string; // base64
    error?: string;
    fatal?: boolean; // 是否是致命错误（如 cuDNN 缺失）
}

export interface OcrSomOptions {
    returnImage?: boolean;
    ocrOnly?: boolean;
    detectContours?: boolean;
    minArea?: number;
    maxArea?: number;
    minSize?: number;
    fillRatio?: number;
    saturationThreshold?: number;
}

class OcrSomService {
    private logger = logger.child('OCR-SoM');

    /**
     * 获取 OCR-SoM 服务地址
     */
    private getBaseUrl(): string {
        return configManager.get<string>('ocr.baseUrl', 'http://localhost:5000');
    }

    /**
     * 获取超时时间
     */
    private getTimeout(): number {
        return configManager.get<number>('ocr.timeout', 30000);
    }

    /**
     * 检查服务是否可用
     */
    async checkConnection(): Promise<{ connected: boolean; message: string; info?: Record<string, unknown> }> {
        const baseUrl = this.getBaseUrl();
        this.logger.debug(`检查 OCR-SoM 连接: ${baseUrl}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${baseUrl}/health`, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                return {
                    connected: false,
                    message: `服务返回错误: ${response.status}`,
                };
            }

            const health = await response.json() as Record<string, unknown>;

            // 获取更多信息
            const infoResponse = await fetch(`${baseUrl}/info`);
            const info = await infoResponse.json() as Record<string, unknown>;

            return {
                connected: true,
                message: '连接成功',
                info: {
                    ...health,
                    ...info,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            
            if (message.includes('abort')) {
                return { connected: false, message: '连接超时' };
            }
            if (message.includes('ECONNREFUSED')) {
                return { connected: false, message: '服务未启动' };
            }
            
            return { connected: false, message };
        }
    }

    /**
     * 识别图片中的元素（SoM 标注）
     */
    async analyze(imageBase64: string, options: OcrSomOptions = {}): Promise<OcrSomResult> {
        const baseUrl = this.getBaseUrl();
        const timeout = this.getTimeout();

        this.logger.info('调用 OCR-SoM API...');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            // 构建请求体（注意：服务端期望的字段名是 'image'，不是 'image_base64'）
            const requestBody: Record<string, unknown> = {
                image: imageBase64,
                return_image: options.returnImage ?? true,
                ocr_only: options.ocrOnly ?? false,
                detect_contours: options.detectContours ?? true,
            };

            // 添加可选参数
            if (options.minArea !== undefined) requestBody.min_area = options.minArea;
            if (options.maxArea !== undefined) requestBody.max_area = options.maxArea;
            if (options.minSize !== undefined) requestBody.min_size = options.minSize;
            if (options.fillRatio !== undefined) requestBody.fill_ratio = options.fillRatio;
            if (options.saturationThreshold !== undefined) requestBody.saturation_threshold = options.saturationThreshold;

            const response = await fetch(`${baseUrl}/som`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API 错误: ${response.status} - ${error}`);
            }

            const result = await response.json() as OcrSomResult;
            this.logger.info(`OCR-SoM 完成: ${result.count} 个元素`);

            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('OCR-SoM 调用失败:', message);

            // 检测是否是致命错误（GPU 库缺失等）
            const fatalPatterns = [
                'cudnn',
                'cublas',
                'cuda',
                'nvrtc',
                'dynamic library',
                'PreconditionNotMet',
            ];
            const isFatal = fatalPatterns.some(pattern => 
                message.toLowerCase().includes(pattern.toLowerCase())
            );

            return {
                success: false,
                count: 0,
                elements: [],
                error: message,
                fatal: isFatal,
            };
        }
    }

    /**
     * 仅 OCR 识别（不生成标注图）
     */
    async ocr(imageBase64: string): Promise<OcrSomResult> {
        return this.analyze(imageBase64, { returnImage: false, ocrOnly: true });
    }

    /**
     * 根据编号获取元素坐标（中心点）
     */
    getElementCenter(elements: OcrElement[], id: number): [number, number] | null {
        const element = elements.find(el => el.id === id);
        if (!element) return null;

        const [x1, y1, x2, y2] = element.box;
        return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
    }

    /**
     * 根据文字内容查找元素
     */
    findElementByText(elements: OcrElement[], text: string, fuzzy = true): OcrElement | null {
        if (fuzzy) {
            return elements.find(el => 
                el.text && el.text.toLowerCase().includes(text.toLowerCase())
            ) || null;
        }
        return elements.find(el => el.text === text) || null;
    }

    /**
     * 格式化元素列表（用于发送给 AI）
     */
    formatElements(elements: OcrElement[]): string {
        return elements.map(el => {
            const [x1, y1, x2, y2] = el.box;
            const cx = Math.round((x1 + x2) / 2);
            const cy = Math.round((y1 + y2) / 2);
            const text = el.text ? `"${el.text}"` : '(无文字)';
            return `[${el.id}] ${el.type === 'text' ? '📝' : '🔲'} ${text} @ (${cx}, ${cy})`;
        }).join('\n');
    }
}

// 单例导出
export const ocrSomService = new OcrSomService();
export default ocrSomService;
