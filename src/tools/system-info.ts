/**
 * 系统信息工具
 * 获取公网IP、系统信息等
 */

import { BaseTool } from './registry.js';
import os from 'os';

export class SystemInfoTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'system_info',
			description: '获取系统信息，包括公网IP地址、系统类型、主机名等',
			parameters: {
				action: {
					type: 'string',
					description: '操作类型: get_ip(获取公网IP), get_system(获取系统信息), get_all(获取全部)',
					required: true,
					enum: ['get_ip', 'get_system', 'get_all'],
				},
			},
			...config,
		});
	}

	async execute(params: { action: string }): Promise<{
		success: boolean;
		ip?: string;
		system?: Record<string, unknown>;
		error?: string;
	}> {
		const { action } = params;

		try {
			switch (action) {
				case 'get_ip':
					return await this.getPublicIP();

				case 'get_system':
					return this.getSystemInfo();

				case 'get_all':
					const ipResult = await this.getPublicIP();
					const sysResult = this.getSystemInfo();
					return {
						success: true,
						ip: ipResult.ip,
						system: sysResult.system,
					};

				default:
					return { success: false, error: `未知操作: ${action}` };
			}
		} catch (error) {
			return {
				success: false,
				error: `执行失败: ${(error as Error).message}`,
			};
		}
	}

	/**
	 * 获取公网 IP
	 */
	private async getPublicIP(): Promise<{ success: boolean; ip?: string; error?: string }> {
		// 尝试多个 IP 查询服务
		const services = [
			'https://api.ipify.org?format=json',
			'https://ipinfo.io/json',
			'https://api.ip.sb/geoip',
		];

		for (const url of services) {
			try {
				const response = await fetch(url, {
					signal: AbortSignal.timeout(5000),
				});

				if (!response.ok) continue;

				const data = await response.json();
				const ip = data.ip || data.query;

				if (ip) {
					return { success: true, ip };
				}
			} catch {
				// 尝试下一个服务
				continue;
			}
		}

		return { success: false, error: '无法获取公网 IP，请检查网络连接' };
	}

	/**
	 * 获取系统信息
	 */
	private getSystemInfo(): { success: boolean; system: Record<string, unknown> } {
		return {
			success: true,
			system: {
				platform: os.platform(),
				type: os.type(),
				release: os.release(),
				hostname: os.hostname(),
				arch: os.arch(),
				cpus: os.cpus().length,
				totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
				freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
				uptime: `${Math.round(os.uptime() / 3600)}小时`,
				username: os.userInfo().username,
				homedir: os.homedir(),
			},
		};
	}
}

export default SystemInfoTool;
