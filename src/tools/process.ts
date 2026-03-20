/**
 * 进程管理工具
 * 管理系统进程，支持列出、查找、结束进程
 * 跨平台支持 Windows/macOS/Linux
 */

import { BaseTool } from './registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { systemInfo } from './exec.js';

const execAsync = promisify(exec);

interface ProcessInfo {
	pid: number;
	name: string;
	cpu?: number;
	memory?: number; // MB
	memoryPercent?: number;
	user?: string;
	command?: string;
	created?: string;
}

interface ProcessListResult {
	processes: ProcessInfo[];
	count: number;
	totalMemory?: number;
	totalCpu?: number;
}

export class ProcessTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'process',
			description: `进程管理工具，支持列出、查找、结束系统进程

【适用场景】
- 查看系统运行的进程列表
- 查找特定进程
- 结束卡死的进程
- 监控系统资源占用

【使用示例】
- 列出所有进程: { "action": "list" }
- 查找进程: { "action": "find", "name": "chrome" }
- 结束进程: { "action": "kill", "pid": 1234 }
- 强制结束: { "action": "kill", "name": "notepad", "force": true }
- 查看进程详情: { "action": "info", "pid": 1234 }`,
			parameters: {
				action: {
					type: 'string',
					description: '操作类型',
					required: true,
					enum: ['list', 'find', 'kill', 'info', 'tree'],
				},
				name: {
					type: 'string',
					description: '进程名称（支持模糊匹配，用于 find 和 kill 操作）',
				},
				pid: {
					type: 'number',
					description: '进程 ID（用于 kill 和 info 操作）',
				},
				force: {
					type: 'boolean',
					description: '是否强制结束进程（仅 kill 操作有效，默认 false）',
				},
				top: {
					type: 'number',
					description: '返回前 N 个最占用资源的进程（仅 list 操作有效，默认 50）',
				},
			},
			...config,
		});
	}

	async execute(
		params: {
			action: string;
			name?: string;
			pid?: number;
			force?: boolean;
			top?: number;
		},
		context: Record<string, unknown> = {}
	): Promise<unknown> {
		const { action, name, pid, force = false, top = 50 } = params;

		switch (action) {
			case 'list':
				return await this.listProcesses(top);
			case 'find':
				if (!name) throw new Error('find 操作需要 name 参数');
				return await this.findProcess(name);
			case 'kill':
				if (pid) {
					return await this.killProcessByPid(pid, force);
				} else if (name) {
					return await this.killProcessByName(name, force);
				} else {
					throw new Error('kill 操作需要 pid 或 name 参数');
				}
			case 'info':
				if (!pid) throw new Error('info 操作需要 pid 参数');
				return await this.getProcessInfo(pid);
			case 'tree':
				return await this.getProcessTree();
			default:
				throw new Error(`未知的操作: ${action}`);
		}
	}

	/**
	 * 列出系统进程
	 */
	private async listProcesses(top: number = 50): Promise<ProcessListResult> {
		try {
			if (systemInfo.isWindows) {
				// Windows: 使用 PowerShell 获取进程信息
				const psScript = `
					Get-Process | 
					Sort-Object WorkingSet -Descending |
					Select-Object -First ${top} |
					ForEach-Object {
						"$($_.Id)|$($_.ProcessName)|$($_.CPU)|$([math]::Round($_.WorkingSet / 1MB, 2))|$($_.StartTime)"
					}
				`;
				const { stdout } = await execAsync(`powershell -Command "${psScript}"`, { windowsHide: true });
				
				const processes: ProcessInfo[] = stdout
					.trim()
					.split('\n')
					.filter(line => line)
					.map(line => {
						const parts = line.split('|');
						return {
							pid: parseInt(parts[0]) || 0,
							name: parts[1] || 'unknown',
							cpu: parseFloat(parts[2]) || 0,
							memory: parseFloat(parts[3]) || 0,
							created: parts[4] || undefined,
						};
					});

				// 计算总内存占用
				const totalMemory = processes.reduce((sum, p) => sum + (p.memory || 0), 0);
				const totalCpu = processes.reduce((sum, p) => sum + (p.cpu || 0), 0);

				return { processes, count: processes.length, totalMemory, totalCpu };
			} else {
				// macOS/Linux: 使用 ps 命令
				const { stdout } = await execAsync(`ps aux | head -${top + 1} | tail -${top}`);
				
				const processes: ProcessInfo[] = stdout
					.trim()
					.split('\n')
					.filter(line => line)
					.map(line => {
						const parts = line.trim().split(/\s+/);
						return {
							user: parts[0],
							pid: parseInt(parts[1]) || 0,
							cpu: parseFloat(parts[2]) || 0,
							memoryPercent: parseFloat(parts[3]) || 0,
							memory: parseFloat(parts[5]) / 1024 || 0, // Convert KB to MB
							name: parts[10] || 'unknown',
							command: parts.slice(10).join(' '),
						};
					});

				const totalMemory = processes.reduce((sum, p) => sum + (p.memory || 0), 0);
				const totalCpu = processes.reduce((sum, p) => sum + (p.cpu || 0), 0);

				return { processes, count: processes.length, totalMemory, totalCpu };
			}
		} catch (error) {
			throw new Error(`获取进程列表失败: ${error}`);
		}
	}

	/**
	 * 查找进程
	 */
	private async findProcess(name: string): Promise<{ processes: ProcessInfo[]; count: number }> {
		try {
			if (systemInfo.isWindows) {
				// Windows: 使用 PowerShell 查找进程
				const psScript = `
					Get-Process | 
					Where-Object { $_.ProcessName -like "*${name}*" } |
					ForEach-Object {
						"$($_.Id)|$($_.ProcessName)|$($_.CPU)|$([math]::Round($_.WorkingSet / 1MB, 2))|$($_.MainWindowTitle)"
					}
				`;
				const { stdout } = await execAsync(`powershell -Command "${psScript}"`, { windowsHide: true });
				
				if (!stdout.trim()) {
					return { processes: [], count: 0 };
				}

				const processes: ProcessInfo[] = stdout
					.trim()
					.split('\n')
					.filter(line => line)
					.map(line => {
						const parts = line.split('|');
						return {
							pid: parseInt(parts[0]) || 0,
							name: parts[1] || 'unknown',
							cpu: parseFloat(parts[2]) || 0,
							memory: parseFloat(parts[3]) || 0,
							command: parts[4] || undefined,
						};
					});

				return { processes, count: processes.length };
			} else {
				// macOS/Linux: 使用 pgrep 和 ps
				try {
					const { stdout: pids } = await execAsync(`pgrep -i "${name}"`);
					const pidList = pids.trim().split('\n').filter(p => p);
					
					if (pidList.length === 0) {
						return { processes: [], count: 0 };
					}

					const processes: ProcessInfo[] = [];
					for (const pid of pidList.slice(0, 20)) { // 限制最多 20 个结果
						try {
							const { stdout } = await execAsync(`ps -p ${pid} -o pid,comm,pcpu,pmem,rss,etime`);
							const lines = stdout.trim().split('\n');
							if (lines.length > 1) {
								const parts = lines[1].trim().split(/\s+/);
								processes.push({
									pid: parseInt(parts[0]) || 0,
									name: parts[1] || 'unknown',
									cpu: parseFloat(parts[2]) || 0,
									memoryPercent: parseFloat(parts[3]) || 0,
									memory: parseFloat(parts[4]) / 1024 || 0,
									created: parts[5] || undefined,
								});
							}
						} catch {
							// 忽略单个进程查询失败
						}
					}

					return { processes, count: processes.length };
				} catch {
					return { processes: [], count: 0 };
				}
			}
		} catch (error) {
			throw new Error(`查找进程失败: ${error}`);
		}
	}

	/**
	 * 通过 PID 结束进程
	 */
	private async killProcessByPid(pid: number, force: boolean = false): Promise<{ success: boolean; message: string }> {
		try {
			if (systemInfo.isWindows) {
				await execAsync(`taskkill ${force ? '/F' : ''} /PID ${pid}`, { windowsHide: true });
				return { success: true, message: `已结束进程 PID: ${pid}` };
			} else {
				const signal = force ? '-9' : '-15';
				await execAsync(`kill ${signal} ${pid}`);
				return { success: true, message: `已结束进程 PID: ${pid}` };
			}
		} catch (error) {
			return { success: false, message: `结束进程失败: ${error}` };
		}
	}

	/**
	 * 通过名称结束进程
	 */
	private async killProcessByName(name: string, force: boolean = false): Promise<{ success: boolean; message: string }> {
		try {
			// 先查找进程
			const found = await this.findProcess(name);
			
			if (found.count === 0) {
				return { success: false, message: `未找到进程: ${name}` };
			}

			if (systemInfo.isWindows) {
				await execAsync(`taskkill ${force ? '/F' : ''} /IM "${name}.exe"`, { windowsHide: true });
				return { success: true, message: `已结束进程: ${name} (${found.count} 个实例)` };
			} else {
				await execAsync(`pkill ${force ? '-9' : ''} -i "${name}"`);
				return { success: true, message: `已结束进程: ${name} (${found.count} 个实例)` };
			}
		} catch (error) {
			return { success: false, message: `结束进程失败: ${error}` };
		}
	}

	/**
	 * 获取进程详细信息
	 */
	private async getProcessInfo(pid: number): Promise<{ process?: ProcessInfo; success: boolean; message: string }> {
		try {
			if (systemInfo.isWindows) {
				const psScript = `
					$proc = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
					if ($proc) {
						"$($proc.Id)|$($proc.ProcessName)|$($proc.CPU)|$([math]::Round($proc.WorkingSet / 1MB, 2))|$($proc.StartTime)|$($proc.MainWindowTitle)|$($proc.Path)"
					} else {
						"NOT_FOUND"
					}
				`;
				const { stdout } = await execAsync(`powershell -Command "${psScript}"`, { windowsHide: true });
				
				if (stdout.trim() === 'NOT_FOUND') {
					return { success: false, message: `未找到进程 PID: ${pid}` };
				}

				const parts = stdout.trim().split('|');
				const process: ProcessInfo = {
					pid: parseInt(parts[0]) || 0,
					name: parts[1] || 'unknown',
					cpu: parseFloat(parts[2]) || 0,
					memory: parseFloat(parts[3]) || 0,
					created: parts[4] || undefined,
					command: parts[5] || undefined,
				};

				return { process, success: true, message: '获取进程信息成功' };
			} else {
				const { stdout } = await execAsync(`ps -p ${pid} -o pid,comm,pcpu,pmem,rss,etime,user,args`);
				const lines = stdout.trim().split('\n');
				
				if (lines.length < 2) {
					return { success: false, message: `未找到进程 PID: ${pid}` };
				}

				const parts = lines[1].trim().split(/\s+/);
				const process: ProcessInfo = {
					pid: parseInt(parts[0]) || 0,
					name: parts[1] || 'unknown',
					cpu: parseFloat(parts[2]) || 0,
					memoryPercent: parseFloat(parts[3]) || 0,
					memory: parseFloat(parts[4]) / 1024 || 0,
					created: parts[5] || undefined,
					user: parts[6] || undefined,
					command: parts.slice(7).join(' '),
				};

				return { process, success: true, message: '获取进程信息成功' };
			}
		} catch (error) {
			return { success: false, message: `获取进程信息失败: ${error}` };
		}
	}

	/**
	 * 获取进程树
	 */
	private async getProcessTree(): Promise<{ tree: string; success: boolean }> {
		try {
			if (systemInfo.isWindows) {
				const { stdout } = await execAsync('wmic process get ProcessId,ParentProcessId,Name /format:csv', { windowsHide: true });
				return { tree: stdout, success: true };
			} else {
				const { stdout } = await execAsync('pstree -p || ps axjf');
				return { tree: stdout, success: true };
			}
		} catch (error) {
			return { tree: '', success: false };
		}
	}
}

export default ProcessTool;
