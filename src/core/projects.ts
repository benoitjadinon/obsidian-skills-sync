import { homedir } from 'os';
import { join } from 'path';
import { expandHome, slugify } from './agents';
import type { AgentConfig, AgentState, ProjectConfig } from './model';

export interface ProjectFolder {
	/** Folder relative to the project root, e.g. .claude/skills. */
	dir: string;
	/** Configured agents that read it (several agents share .agents/skills). */
	agents: AgentConfig[];
}

/** Each project skills folder of the configured agents, once, in agent order. */
export function projectFolders(agents: AgentConfig[]): ProjectFolder[] {
	const folders: ProjectFolder[] = [];
	for (const a of agents) {
		if (a.kind !== 'agent' || !a.projectDir) continue;
		const f = folders.find((x) => x.dir === a.projectDir);
		if (f) f.agents.push(a);
		else folders.push({ dir: a.projectDir, agents: [a] });
	}
	return folders;
}

const names = (f: ProjectFolder): string => f.agents.map((a) => a.label).join(', ');
/** Per-folder column id, named after the folder (.claude/skills → <id>-claude), stable when agents change. */
const folderKey = (p: ProjectConfig, f: ProjectFolder): string => `${p.id}-${slugify((f.dir.split('/')[0] ?? f.dir).replace(/^\./, '')) || slugify(f.dir)}`;

/** The project's sync targets: one per project skills folder, driven by the project's column(s). */
export function expandProject(p: ProjectConfig, agents: AgentConfig[], home: string = homedir()): AgentConfig[] {
	const root = expandHome(p.root, home);
	return projectFolders(agents).map((f) => ({
		id: `${p.id}--${slugify(f.dir)}`,
		label: `${p.label} · ${names(f)}`,
		path: join(root, f.dir),
		kind: 'project',
		layout: 'flat',
		archiveDir: '',
		stateKey: p.perAgentColumns ? folderKey(p, f) : p.id,
		createIn: root,
	}));
}

/** Base columns (checkbox properties) of a project. */
export function projectColumns(p: ProjectConfig, agents: AgentConfig[]): { id: string; label: string }[] {
	if (!p.perAgentColumns) return [{ id: p.id, label: p.label }];
	return projectFolders(agents).map((f) => ({ id: folderKey(p, f), label: `${p.label} · ${names(f)}` }));
}

/** Everything sync works on: the agents, then every project folder. */
export function syncTargets(agents: AgentConfig[], projects: ProjectConfig[], home: string = homedir()): AgentConfig[] {
	const real = agents.filter((a) => a.kind === 'agent');
	return [...agents, ...projects.flatMap((p) => expandProject(p, real, home))];
}

/** The checkbox properties, in order, without duplicates. */
export function stateKeys(targets: AgentConfig[]): string[] {
	return [...new Set(targets.map((a) => a.stateKey ?? a.id))];
}

/**
 * Move a skill's checkbox values from one set of project columns to another (when switching between
 * one column and one per agent): one → many copies the value; many → one is true if any is true,
 * false if all are false, otherwise undecided.
 */
export function switchStates(
	states: Record<string, AgentState>,
	from: string[],
	to: string[],
): Record<string, AgentState> {
	const values = from.map((k) => states[k] ?? null);
	const merged: AgentState = values.some((v) => v === true) ? true : values.length > 0 && values.every((v) => v === false) ? false : null;
	const out: Record<string, AgentState> = {};
	for (const [k, v] of Object.entries(states)) if (!from.includes(k)) out[k] = v;
	for (const k of to) out[k] = from.length === 1 ? values[0] ?? null : merged;
	return out;
}
