/**
 * 系统通知工具
 * 支持系统通知和声音提醒
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';

const execAsync = promisify(exec);

// 动态导入类型
type NodeNotifier = typeof import('node-notifier');

export class NotifyTool extends BaseTool {
	private notifier: NodeNotifier | null = null;

	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'notify',
			description: '系统通知工具，支持显示系统通知和播放提示音',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: show(显示通知), sound(播放提示音)',
					required: true,
					enum: ['show', 'sound'],
				},
				title: {
					type: 'string',
					description: '通知标题',
				},
				message: {
					type: 'string',
					description: '通知内容',
				},
				icon: {
					type: 'string',
					description: '通知图标路径（可选）',
				},
				sound: {
					type: 'string',
					description: '声音类型: default(默认), beep(蜂鸣), success(成功), error(错误), warning(警告)',
					enum: ['default', 'beep', 'success', 'error', 'warning'],
				},
				wait: {
					type: 'boolean',
					description: '是否等待用户响应通知（默认 false）',
				},
			},
			...config,
		});
	}

	/**
	 * 延迟加载 node-notifier
	 */
	private async loadNotifier(): Promise<NodeNotifier> {
		if (!this.notifier) {
			try {
				this.notifier = await import('node-notifier');
			} catch {
				// 如果 node-notifier 不可用，使用系统命令
				this.logger.warn('node-notifier 未安装，将使用系统命令');
				return null as unknown as NodeNotifier;
			}
		}
		return this.notifier;
	}

	async execute(
		params: {
			action: string;
			title?: string;
			message?: string;
			icon?: string;
			sound?: string;
			wait?: boolean;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, title, message, icon, sound, wait } = params;

		switch (action) {
			case 'show':
				if (!message) throw new Error('show 操作需要 message 参数');
				return await this.showNotification(title || 'NutBot', message, icon, sound !== 'default', wait);
			case 'sound':
				return await this.playSound(sound || 'default');
			default:
				throw new Error(`未知操作: ${action}`);
		}
	}

	/**
	 * 显示系统通知
	 */
	private async showNotification(
		title: string,
		message: string,
		icon?: string,
		withSound: boolean = true,
		wait: boolean = false
	): Promise<{
		success: boolean;
		title: string;
		message: string;
	}> {
		const notifier = await this.loadNotifier();

		if (notifier) {
			// 使用 node-notifier
			await new Promise<void>((resolve, reject) => {
				notifier.notify(
					{
						title,
						message,
						icon: icon || undefined,
						sound: withSound,
						wait,
					},
					(err) => {
						if (err) reject(err);
						else resolve();
					}
				);
			});
		} else {
			// 使用系统命令
			await this.showSystemNotification(title, message);
		}

		this.logger.info(`显示通知: ${title} - ${message}`);

		return {
			success: true,
			title,
			message,
		};
	}

	/**
	 * 使用系统命令显示通知
	 */
	private async showSystemNotification(title: string, message: string): Promise<void> {
		const escapedTitle = title.replace(/"/g, '\\"');
		const escapedMessage = message.replace(/"/g, '\\"');

		if (systemInfo.isWindows) {
			// Windows: 使用 PowerShell Toast 通知
			const psScript = `
				[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
				[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
				$template = @"
				<toast>
					<visual>
						<binding template="ToastText02">
							<text id="1">${escapedTitle}</text>
							<text id="2">${escapedMessage}</text>
						</binding>
					</visual>
				</toast>
"@
				$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
				$xml.LoadXml($template)
				$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
				[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("NutBot").Show($toast)
			`;

			try {
				await execAsync(`powershell -command "${psScript.replace(/\n/g, ' ')}"`, {
					encoding: 'utf-8',
				});
			} catch {
				// 如果 Toast 失败，使用 BurntToast 或简单的消息框
				try {
					await execAsync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${escapedMessage}', '${escapedTitle}')"`, {
						encoding: 'utf-8',
					});
				} catch {
					this.logger.warn('Windows 通知失败');
				}
			}
		} else if (systemInfo.isMac) {
			// macOS: 使用 osascript
			await execAsync(`osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`);
		} else {
			// Linux: 使用 notify-send
			try {
				await execAsync(`notify-send "${escapedTitle}" "${escapedMessage}"`);
			} catch {
				this.logger.warn('Linux 通知失败，请确保安装了 libnotify-bin');
			}
		}
	}

	/**
	 * 播放提示音
	 */
	private async playSound(soundType: string): Promise<{
		success: boolean;
		sound: string;
	}> {
		if (systemInfo.isWindows) {
			await this.playWindowsSound(soundType);
		} else if (systemInfo.isMac) {
			await this.playMacSound(soundType);
		} else {
			await this.playLinuxSound(soundType);
		}

		this.logger.info(`播放提示音: ${soundType}`);

		return {
			success: true,
			sound: soundType,
		};
	}

	/**
	 * Windows 播放声音
	 */
	private async playWindowsSound(soundType: string): Promise<void> {
		const soundMap: Record<string, string> = {
			default: 'SystemDefault',
			beep: 'SystemExclamation',
			success: 'SystemAsterisk',
			error: 'SystemHand',
			warning: 'SystemExclamation',
		};

		const sound = soundMap[soundType] || 'SystemDefault';

		try {
			await execAsync(`powershell -command "[System.Media.SystemSounds]::${sound.replace('System', '')}.Play()"`, {
				encoding: 'utf-8',
			});
		} catch {
			// 备选：使用 Beep
			await execAsync(`powershell -command "[console]::beep(800,200)"`, {
				encoding: 'utf-8',
			});
		}
	}

	/**
	 * macOS 播放声音
	 */
	private async playMacSound(soundType: string): Promise<void> {
		const soundMap: Record<string, string> = {
			default: 'Ping',
			beep: 'Basso',
			success: 'Glass',
			error: 'Sosumi',
			warning: 'Funk',
		};

		const sound = soundMap[soundType] || 'Ping';

		try {
			await execAsync(`afplay /System/Library/Sounds/${sound}.aiff`);
		} catch {
			// 备选：使用简单的 beep
			await execAsync(`osascript -e 'beep'`);
		}
	}

	/**
	 * Linux 播放声音
	 */
	private async playLinuxSound(soundType: string): Promise<void> {
		const soundMap: Record<string, string> = {
			default: '/usr/share/sounds/freedesktop/stereo/message.oga',
			beep: '/usr/share/sounds/freedesktop/stereo/bell.oga',
			success: '/usr/share/sounds/freedesktop/stereo/complete.oga',
			error: '/usr/share/sounds/freedesktop/stereo/dialog-error.oga',
			warning: '/usr/share/sounds/freedesktop/stereo/dialog-warning.oga',
		};

		const soundFile = soundMap[soundType] || soundMap.default;

		try {
			// 尝试使用 paplay (PulseAudio)
			await execAsync(`paplay ${soundFile}`);
		} catch {
			try {
				// 尝试使用 aplay (ALSA)
				await execAsync(`aplay ${soundFile}`);
			} catch {
				try {
					// 尝试使用简单的 beep
					await execAsync(`echo -e '\\a'`);
				} catch {
					this.logger.warn('Linux 声音播放失败');
				}
			}
		}
	}

	async cleanup(): Promise<void> {
		this.notifier = null;
	}
}

export default NotifyTool;
