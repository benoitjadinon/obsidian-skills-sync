import { existsSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, sep } from 'path';
import { RESERVED } from './frontmatter';
import type { AgentConfig } from './model';
import generated from './agentPresets.generated.json';

interface GeneratedPreset {
	name: string;
	label: string;
	path: string;
}

/**
 * Our additions on top of the generated table, keyed by skills folder. They keep the short ids
 * existing notes already use (agent-claude, …) and describe layouts the table doesn't model.
 */
const OVERRIDES: Record<string, Partial<Omit<AgentConfig, 'path' | 'kind'>>> = {
	'~/.claude/skills': { id: 'claude' },
	'~/.gemini/skills': { id: 'gemini' },
	'~/.hermes/skills': { id: 'hermes', layout: 'nested', archiveDir: '.archive' },
	'~/.agents/skills': { id: 'agents', label: 'Shared agents folder' },
};

/** Known agents, generated from vercel-labs/skills by `npm run presets:update`. */
export const PRESETS: AgentConfig[] = (generated.presets as GeneratedPreset[]).map((p) => ({
	id: p.name,
	label: p.label,
	path: p.path,
	kind: 'agent',
	layout: 'flat',
	archiveDir: '',
	...OVERRIDES[p.path],
}));

export const PRESETS_SOURCE: string = generated.source;

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

/** Presets whose folder isn't configured yet, those found on this machine first, then by name. */
export function availablePresets(configured: AgentConfig[], home: string = homedir()): { preset: AgentConfig; found: boolean }[] {
	const taken = new Set(configured.map((a) => expandHome(a.path, home)));
	return PRESETS.filter((p) => !taken.has(expandHome(p.path, home)))
		.map((preset) => ({ preset, found: existsSync(expandHome(preset.path, home)) }))
		.sort((a, b) => Number(b.found) - Number(a.found) || a.preset.label.localeCompare(b.preset.label));
}
