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
export const PRESETS: AgentConfig[] = (generated.presets as GeneratedPreset[]).map((p) => {
	const agent: AgentConfig = { id: p.name, label: p.label, path: p.path, kind: 'agent', layout: 'flat', archiveDir: '', ...OVERRIDES[p.path] };
	return { ...agent, preset: agent.id };
});

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

/**
 * Absolute archive folder of an agent, or null when it has none. archiveDir may be relative to the
 * agent's skills folder (".archive", "../old"), start with "~", or be absolute.
 */
export function archiveRoot(agent: AgentConfig, home: string = homedir()): string | null {
	if (!agent.archiveDir) return null;
	const dir = expandHome(agent.archiveDir, home);
	return isAbsolute(dir) ? dir : join(agent.path, dir);
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

/** Presets whose folder isn't configured yet, those installed on this machine first, then by name. */
export function availablePresets(configured: AgentConfig[], home: string = homedir()): { preset: AgentConfig; installed: boolean }[] {
	const taken = new Set(configured.map((a) => expandHome(a.path, home)));
	return PRESETS.filter((p) => !taken.has(expandHome(p.path, home)))
		.map((preset) => ({ preset, installed: existsSync(expandHome(preset.path, home)) }))
		.sort((a, b) => Number(b.installed) - Number(a.installed) || a.preset.label.localeCompare(b.preset.label));
}

/**
 * The preset an agent was created from. Agents saved before `preset` existed are matched to a
 * known agent with the same id and skills folder.
 */
export function inferPreset(agent: AgentConfig, home: string = homedir()): string | undefined {
	if (agent.preset) return agent.preset;
	const path = expandHome(agent.path, home);
	return PRESETS.find((p) => p.id === agent.id && expandHome(p.path, home) === path)?.id;
}

/** Settings list order: agents created from a preset first, then custom ones, each by name. */
export function sortAgentsForList(agents: AgentConfig[]): AgentConfig[] {
	return [...agents].sort(
		(a, b) => Number(!inferPreset(a)) - Number(!inferPreset(b)) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
	);
}
