/**
 * 剪贴板工具
 * 支持文本和图片的剪贴板操作
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export class ClipboardTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'clipboard',
			description: '剪贴板工具，支持读写文本和图片',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: read(读取文本), write(写入文本), read_image(读取图片), write_image(写入图片)',
					required: true,
					enum: ['read', 'write', 'read_image', 'write_image'],
				},
				text: {
					type: 'string',
					description: 'write 操作的文本内容',
				},
				imagePath: {
					type: 'string',
					description: 'write_image 操作的图片路径，或 read_image 操作的保存路径',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			text?: string;
			imagePath?: string;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, text, imagePath } = params;

		switch (action) {
			case 'read':
				return await this.readText();
			case 'write':
				if (!text) throw new Error('write 操作需要 text 参数');
				return await this.writeText(text);
			case 'read_image':
				return await this.readImage(imagePath);
			case 'write_image':
				if (!imagePath) throw new Error('write_image 操作需要 imagePath 参数');
				return await this.writeImage(imagePath);
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 读取剪贴板文本
	 */
	private async readText(): Promise<{
		success: boolean;
		text: string;
		length: number;
	}> {
		let text = '';

		if (systemInfo.isWindows) {
			// Windows: 使用 PowerShell
			const { stdout } = await execAsync('powershell -command "Get-Clipboard"', {
				encoding: 'utf-8',
			});
			text = stdout.trim();
		} else if (systemInfo.isMac) {
			// macOS: 使用 pbpaste
			const { stdout } = await execAsync('pbpaste');
			text = stdout;
		} else {
			// Linux: 尝试 xclip 或 xsel
			try {
				const { stdout } = await execAsync('xclip -selection clipboard -o');
				text = stdout;
			} catch {
				try {
					const { stdout } = await execAsync('xsel --clipboard --output');
					text = stdout;
				} catch {
					throw new Error('Linux 系统需要安装 xclip 或 xsel: sudo apt install xclip');
				}
			}
		}

		this.logger.info(`读取剪贴板: ${text.length} 字符`);

		return {
			success: true,
			text,
			length: text.length,
		};
	}

	/**
	 * 写入文本到剪贴板
	 */
	private async writeText(text: string): Promise<{
		success: boolean;
		length: number;
	}> {
		if (systemInfo.isWindows) {
			// Windows: 使用 PowerShell，处理特殊字符
			const escapedText = text.replace(/'/g, "''");
			await execAsync(`powershell -command "Set-Clipboard -Value '${escapedText}'"`, {
				encoding: 'utf-8',
			});
		} else if (systemInfo.isMac) {
			// macOS: 使用 pbcopy
			const proc = exec('pbcopy');
			proc.stdin?.write(text);
			proc.stdin?.end();
			await new Promise<void>((resolve, reject) => {
				proc.on('close', (code) => {
					if (code === 0) resolve();
					else reject(new Error(`pbcopy 退出码: ${code}`));
				});
			});
		} else {
			// Linux: 尝试 xclip 或 xsel
			try {
				const proc = exec('xclip -selection clipboard');
				proc.stdin?.write(text);
				proc.stdin?.end();
				await new Promise<void>((resolve, reject) => {
					proc.on('close', (code) => {
						if (code === 0) resolve();
						else reject(new Error(`xclip 退出码: ${code}`));
					});
				});
			} catch {
				try {
					const proc = exec('xsel --clipboard --input');
					proc.stdin?.write(text);
					proc.stdin?.end();
					await new Promise<void>((resolve, reject) => {
						proc.on('close', (code) => {
							if (code === 0) resolve();
							else reject(new Error(`xsel 退出码: ${code}`));
						});
					});
				} catch {
					throw new Error('Linux 系统需要安装 xclip 或 xsel: sudo apt install xclip');
				}
			}
		}

		this.logger.info(`写入剪贴板: ${text.length} 字符`);

		return {
			success: true,
			length: text.length,
		};
	}

	/**
	 * 读取剪贴板图片
	 */
	private async readImage(savePath?: string): Promise<{
		success: boolean;
		hasImage: boolean;
		path?: string;
		size?: number;
	}> {
		// 生成临时文件路径
		const outputPath = savePath || path.join(os.tmpdir(), `clipboard_${Date.now()}.png`);

		try {
			if (systemInfo.isWindows) {
				// Windows: 使用 PowerShell 保存剪贴板图片
				const psScript = `
					Add-Type -AssemblyName System.Windows.Forms
					$img = [System.Windows.Forms.Clipboard]::GetImage()
					if ($img -ne $null) {
						$img.Save('${outputPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
						Write-Output "saved"
					} else {
						Write-Output "no_image"
					}
				`;
				const { stdout } = await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, {
					encoding: 'utf-8',
				});

				if (stdout.trim() === 'no_image') {
					return {
						success: true,
						hasImage: false,
					};
				}
			} else if (systemInfo.isMac) {
				// macOS: 使用 pngpaste
				try {
					await execAsync(`pngpaste "${outputPath}"`);
				} catch {
					// 如果 pngpaste 不可用，尝试使用 osascript
					const { stdout } = await execAsync(`osascript -e 'clipboard info'`);
					if (!stdout.includes('«class PNGf»') && !stdout.includes('TIFF')) {
						return {
							success: true,
							hasImage: false,
						};
					}
					throw new Error('macOS 图片剪贴板需要安装 pngpaste: brew install pngpaste');
				}
			} else {
				// Linux: 使用 xclip
				try {
					await execAsync(`xclip -selection clipboard -t image/png -o > "${outputPath}"`);
				} catch {
					return {
						success: true,
						hasImage: false,
					};
				}
			}

			// 检查文件是否创建成功
			const exists = await fs.pathExists(outputPath);
			if (!exists) {
				return {
					success: true,
					hasImage: false,
				};
			}

			const stat = await fs.stat(outputPath);
			if (stat.size === 0) {
				await fs.remove(outputPath);
				return {
					success: true,
					hasImage: false,
				};
			}

			this.logger.info(`读取剪贴板图片: ${outputPath} (${stat.size} 字节)`);

			return {
				success: true,
				hasImage: true,
				path: outputPath,
				size: stat.size,
			};
		} catch (error) {
			// 清理可能创建的空文件
			if (await fs.pathExists(outputPath)) {
				await fs.remove(outputPath);
			}
			throw error;
		}
	}

	/**
	 * 写入图片到剪贴板
	 */
	private async writeImage(imagePath: string): Promise<{
		success: boolean;
		path: string;
	}> {
		const normalizedPath = path.resolve(imagePath);

		const exists = await fs.pathExists(normalizedPath);
		if (!exists) {
			throw new Error(`图片文件不存在: ${normalizedPath}`);
		}

		if (systemInfo.isWindows) {
			// Windows: 使用 PowerShell
			const psScript = `
				Add-Type -AssemblyName System.Windows.Forms
				$img = [System.Drawing.Image]::FromFile('${normalizedPath.replace(/\\/g, '\\\\')}')
				[System.Windows.Forms.Clipboard]::SetImage($img)
			`;
			await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, {
				encoding: 'utf-8',
			});
		} else if (systemInfo.isMac) {
			// macOS: 使用 osascript
			await execAsync(`osascript -e 'set the clipboard to (read (POSIX file "${normalizedPath}") as TIFF picture)'`);
		} else {
			// Linux: 使用 xclip
			try {
				await execAsync(`xclip -selection clipboard -t image/png -i "${normalizedPath}"`);
			} catch {
				throw new Error('Linux 系统需要安装 xclip: sudo apt install xclip');
			}
		}

		this.logger.info(`写入图片到剪贴板: ${normalizedPath}`);

		return {
			success: true,
			path: normalizedPath,
		};
	}

	async cleanup(): Promise<void> {
		// 无需清理
	}
}

export default ClipboardTool;
