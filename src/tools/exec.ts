/**
 * Shell 命令执行工具
 * 支持跨平台执行
 */

import { exec, spawn, ExecOptions } from 'child_process';
import { promisify } from 'util';
import { platform, homedir, hostname, userInfo, cpus, totalmem, freemem, release, arch } from 'os';
import { BaseTool } from './registry.js';

const execAsync = promisify(exec);

// 系统信息（启动时收集一次）
export const systemInfo = {
	platform: platform(), // win32, darwin, linux
	arch: arch(), // x64, arm64
	hostname: hostname(),
	username: userInfo().username,
	homedir: homedir(),
	release: release(),
	cpus: cpus().length,
	totalMemory: Math.round(totalmem() / 1024 / 1024 / 1024), // GB
	isWindows: platform() === 'win32',
	isMac: platform() === 'darwin',
	isLinux: platform() === 'linux',
	shell: platform() === 'win32' ? 'powershell' : process.env.SHELL || '/bin/bash',
};

/**
 * 获取系统信息描述（用于 AI 系统提示）
 */
export function getSystemDescription(): string {
	const {
		isWindows,
		isMac,
		isLinux,
		platform,
		arch,
		hostname,
		username,
		homedir,
		release,
		cpus,
		totalMemory,
		shell,
	} = systemInfo;

	let osName = 'Unknown';
	if (isWindows) osName = `Windows ${release}`;
	else if (isMac) osName = `macOS ${release}`;
	else if (isLinux) osName = `Linux ${release}`;

	return `系统环境：${osName} (${platform}/${arch})，${cpus}核，${totalMemory}GB内存，Shell: ${shell}`;
}

export class ExecTool extends BaseTool {
	constructor(config: Record<string, unknown> = {}) {
		super({
			name: 'exec',
			description: `执行系统命令。当前系统: ${systemInfo.isWindows ? 'Windows (PowerShell)' : systemInfo.isMac ? 'macOS (bash)' : 'Linux (bash)'}

【适用场景】
- 文件和目录操作（mkdir, rm, cp, mv 等）
- 系统信息查询（ps, top, df 等）
- 软件包管理（npm, pip, apt 等）
- 其他系统管理任务`,
			parameters: {
				command: {
					type: 'string',
					description: systemInfo.isWindows ? '要执行的 PowerShell 命令' : '要执行的 Shell 命令',
					required: true,
				},
				cwd: {
					type: 'string',
					description: '工作目录（可选）',
				},
				timeout: {
					type: 'number',
					description: '超时时间(毫秒)，默认 30000',
				},
			},
			...config,
		});
	}

	async execute(
		params: { command: string; cwd?: string; timeout?: number },
		context: Record<string, unknown> = {}
	): Promise<{ stdout: string; stderr: string; exitCode: number; system: string }> {
		const { command, cwd, timeout = 30000 } = params;

		this.logger.debug(`执行命令: ${command}`);

		// 根据系统选择 shell 和编码
		const execOptions: ExecOptions = {
			cwd: cwd || systemInfo.homedir,
			timeout,
			maxBuffer: 10 * 1024 * 1024, // 10MB
			windowsHide: true,
		};

		// Windows 使用 PowerShell，设置 UTF-8 编码
		if (systemInfo.isWindows) {
			execOptions.shell = 'powershell.exe';
			execOptions.env = {
				...process.env,
				// PowerShell UTF-8 输出
				PYTHONIOENCODING: 'utf-8',
			};
		}

		try {
			const { stdout, stderr } = await execAsync(command, execOptions);

			return {
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: 0,
				system: systemInfo.platform,
			};
		} catch (error: unknown) {
			const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string };
			return {
				stdout: execError.stdout?.trim() || '',
				stderr: execError.stderr?.trim() || execError.message || '',
				exitCode: execError.code || 1,
				system: systemInfo.platform,
			};
		}
	}
}

export default ExecTool;
