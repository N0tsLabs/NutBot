/**
 * Skills 加载器
 * 从配置目录加载 .md / .json 技能文件，供 Agent 注入 system prompt
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { SkillDefinition } from '../types/index.js';

export interface SkillsConfigLike {
	get<T>(key: string, defaultValue?: T): T;
	resolvePath(p: string): string;
}

export function loadSkills(config: SkillsConfigLike): SkillDefinition[] {
	const enabled = config.get<boolean>('skills.enabled', true);
	if (!enabled) return [];

	const dir = config.get<string>('skills.directory', './skills');
	const basePath = config.resolvePath(dir);
	if (!existsSync(basePath)) return [];

	const skills: SkillDefinition[] = [];
	const files = readdirSync(basePath, { withFileTypes: true });

	for (const f of files) {
		if (!f.isFile()) continue;
		const ext = extname(f.name).toLowerCase();
		const fullPath = join(basePath, f.name);
		try {
			if (ext === '.md') {
				const content = readFileSync(fullPath, 'utf-8');
				const name = f.name.replace(/\.md$/i, '');
				skills.push({
					name,
					description: name,
					prompt: content.trim(),
				});
			} else if (ext === '.json') {
				const raw = readFileSync(fullPath, 'utf-8');
				const data = JSON.parse(raw) as SkillDefinition | SkillDefinition[];
				if (Array.isArray(data)) {
					skills.push(...data.filter((s) => s.name && s.prompt));
				} else if (data.name && data.prompt) {
					skills.push(data);
				}
			}
		} catch (e) {
			// 单文件失败不阻断
			console.warn(`[Skills] 加载失败 ${f.name}:`, (e as Error).message);
		}
	}

	return skills;
}

/**
 * 将 skills 转为 system prompt 附加内容
 */
export function skillsToPromptSection(skills: SkillDefinition[]): string {
	if (skills.length === 0) return '';
	const parts = skills.map((s) => `## ${s.name}\n${s.prompt}`).join('\n\n');
	return `\n\n## 技能 (Skills)\n${parts}\n`;
}
