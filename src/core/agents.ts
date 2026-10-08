import { existsSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, sep } from 'path';
import { RESERVED } from './frontmatter';
import type { AgentConfig } from './model';

const preset = (id: string, label: string, path: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
	id, label, path, kind: 'agent', layout: 'flat', archiveDir: '', ...extra,
});

export const PRESETS: AgentConfig[] = [
	preset('claude', 'Claude Code', '~/.claude/skills'),
	preset('codex', 'Codex', '~/.codex/skills'),
	preset('gemini', 'Gemini CLI', '~/.gemini/skills'),
	preset('opencode', 'OpenCode', '~/.config/opencode/skills'),
	preset('cursor', 'Cursor', '~/.cursor/skills'),
	preset('agents', 'Shared agents folder', '~/.agents/skills'),
	preset('hermes', 'Hermes', '~/.hermes/skills', { layout: 'nested', archiveDir: '.archive' }),
];

export function expandHome(p: string, home: string = homedir()): string {
	if (p === '~') return home;
	if (p.startsWith('~/')) return join(home, p.slice(2));
	return p;
}

/** Inverse of expandHome: show paths under the home folder as "~/…". */
export function contractHome(p: string, home: string = homedir()): string {
	if (p === home) return '~';
	const rel = relative(home, p);
	if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return `~/${rel.split(sep).join('/')}`;
	return p;
}

export function detectPresets(home: string = homedir()): AgentConfig[] {
	return PRESETS.filter((p) => existsSync(expandHome(p.path, home))).map((p) => ({ ...p }));
}

export function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function validateAgentId(id: string, agents: AgentConfig[]): string | null {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return 'Use lowercase letters, digits and dashes for the name.';
	if (RESERVED.includes(id)) return `"${id}" is reserved.`;
	if (agents.some((a) => a.id === id)) return `"${id}" already exists.`;
	return null;
}
