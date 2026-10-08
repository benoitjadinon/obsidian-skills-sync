import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, sep } from 'path';
import { RESERVED } from './frontmatter';
import type { AgentConfig } from './model';
import generated from './agentPresets.generated.json';

interface GeneratedPreset {
	name: string;
	label: string;
	path: string;
	projectDir: string | null;
}

/** projectDir: null means the agent has no project skills folder. */
type Override = Partial<Omit<AgentConfig, 'kind' | 'projectDir'>> & { projectDir?: string | null };

/**
 * Our corrections on top of the generated table, keyed by its agent name: short ids existing notes
 * already use (agent-claude, …), layouts the table doesn't model, and agents' own folders where the
 * table only lists the shared ~/.agents/skills.
 */
const OVERRIDES: Record<string, Override> = {
	'claude-code': { id: 'claude' },
	'gemini-cli': { id: 'gemini' },
	'hermes-agent': { id: 'hermes', layout: 'nested', archiveDir: '.archive' },
	// Cline's docs: global skills live in ~/.cline/skills.
	cline: { path: '~/.cline/skills' },
	// Pi's own folder (it also reads ~/.agents/skills).
	pi: { path: '~/.pi/agent/skills' },
	// OpenClaw's skills folders live in its state folder and agent workspaces, not in code projects.
	openclaw: { projectDir: null },
};

const SHARED_PATH = '~/.agents/skills';
const SHARED = { id: 'agents', label: 'Shared agents folder' };

/** Known agents, generated from vercel-labs/skills by `npm run presets:update`, one per skills folder. */
export const PRESETS: AgentConfig[] = (() => {
	const out: AgentConfig[] = [];
	const paths = new Set<string>();
	for (const p of generated.presets as GeneratedPreset[]) {
		const { projectDir: projectOverride, ...o } = OVERRIDES[p.name] ?? {};
		const projectDir = projectOverride === null ? undefined : (projectOverride ?? p.projectDir ?? undefined);
		let agent: AgentConfig = { id: p.name, label: p.label, path: p.path, kind: 'agent', layout: 'flat', archiveDir: '', projectDir, ...o };
		if (agent.path === SHARED_PATH) agent = { ...agent, ...(SHARED as Partial<AgentConfig>) };
		if (paths.has(agent.path)) continue; // several agents share ~/.agents/skills: one entry
		paths.add(agent.path);
		out.push({ ...agent, preset: agent.id });
	}
	return out;
})();

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

function listDirs(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
	} catch {
		return [];
	}
}

/** Each Hermes profile (~/.hermes/profiles/<name>/skills) is an agent of its own. */
function hermesProfiles(base: AgentConfig, home: string): AgentConfig[] {
	return listDirs(join(home, '.hermes/profiles')).map((name) => {
		const id = `${base.id}-${slugify(name)}`;
		return { ...base, id, label: `${base.label} · ${name}`, path: `~/.hermes/profiles/${name}/skills`, projectDir: undefined, preset: id };
	});
}

/** OpenClaw's state folder; it was called .clawdbot and .moltbot before. */
function openclawState(home: string): string {
	return ['~/.openclaw', '~/.clawdbot', '~/.moltbot'].find((d) => existsSync(expandHome(d, home))) ?? '~/.openclaw';
}

/** Parse OpenClaw's JSON5 config loosely (comments, trailing commas, bare keys); null when unreadable. */
function readJson5(path: string): unknown {
	try {
		const text = readFileSync(path, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|[^:"'])\/\/.*$/gm, '$1')
			.replace(/,(\s*[}\]])/g, '$1')
			.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

/** Each OpenClaw agent has its own workspace, whose skills folder is <workspace>/skills. */
function openclawAgents(base: AgentConfig, state: string, home: string): AgentConfig[] {
	const config = readJson5(join(expandHome(state, home), 'openclaw.json')) as
		| { agents?: { defaults?: { workspace?: string }; entries?: Record<string, { workspace?: string }> } }
		| null;
	const entries = config?.agents?.entries ?? {};
	const defaultsWs = config?.agents?.defaults?.workspace;
	const ids = [...new Set([...listDirs(join(expandHome(state, home), 'agents')), ...Object.keys(entries)])].sort();
	return ids.map((agentId) => {
		const ws = entries[agentId]?.workspace
			?? (defaultsWs ? `${defaultsWs.replace(/\/+$/, '')}/${agentId}` : agentId === 'main' ? `${state}/workspace` : `${state}/workspace-${agentId}`);
		const id = `${base.id}-${slugify(agentId)}`;
		return { ...base, id, label: `${base.label} · ${agentId}`, path: `${contractHome(expandHome(ws, home), home)}/skills`, preset: id };
	});
}

/**
 * Known agents for this computer: the generated table plus agents found on disk (each Hermes
 * profile, each OpenClaw agent), with OpenClaw's state folder resolved.
 */
export function presetsFor(home: string = homedir()): AgentConfig[] {
	const out: AgentConfig[] = [];
	for (const p of PRESETS) {
		if (p.id === 'openclaw') {
			const state = openclawState(home);
			const base = { ...p, path: `${state}/skills` };
			out.push(base, ...openclawAgents(base, state, home));
		} else {
			out.push(p);
			if (p.id === 'hermes') out.push(...hermesProfiles(p, home));
		}
	}
	return out;
}

export function detectPresets(home: string = homedir()): AgentConfig[] {
	return presetsFor(home).filter((p) => existsSync(expandHome(p.path, home))).map((p) => ({ ...p }));
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
	return presetsFor(home).filter((p) => !taken.has(expandHome(p.path, home)))
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
	return presetsFor(home).find((p) => p.id === agent.id && expandHome(p.path, home) === path)?.id;
}

/** Settings list order: agents created from a preset first, then custom ones, each by name. */
export function sortAgentsForList(agents: AgentConfig[]): AgentConfig[] {
	return [...agents].sort(
		(a, b) => Number(!inferPreset(a)) - Number(!inferPreset(b)) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
	);
}
