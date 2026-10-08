export type AgentState = boolean | null;
export type Layout = 'flat' | 'nested';

export interface AgentConfig {
	id: string;
	label: string;
	/** Absolute path (callers expand "~" before building a SyncConfig). */
	path: string;
	kind: 'agent' | 'project';
	layout: Layout;
	/** Folder (relative to path) holding archived skills; '' = no archive. */
	archiveDir: string;
	/** Id of the known agent (preset) this one was created from; absent for custom agents. */
	preset?: string;
	/** Skills folder relative to a code project (e.g. .claude/skills); absent when the agent has none. */
	projectDir?: string;
	/** Property whose checkbox drives this sync target; defaults to `id` (project folders share one). */
	stateKey?: string;
	/** For project folders: the project root. The skills folder may be created while this exists. */
	createIn?: string;
}

/** A code project: its agents' project skills folders are synced from one column, or one per folder. */
export interface ProjectConfig {
	id: string;
	label: string;
	/** Project root (may start with "~"). */
	root: string;
	/** false: one column for the whole project; true: one column per project skills folder. */
	perAgentColumns: boolean;
}

export interface SyncConfig {
	/** Absolute path of the vault skills folder. */
	hubDir: string;
	prefix: string;
	agents: AgentConfig[];
	autoPullExternal: 'ask' | 'auto';
}

export interface PluginMeta {
	states: Record<string, AgentState>;
	/** null = property absent (hand-made note): every non-plugin key counts as a skill key. */
	skillKeys: string[] | null;
	path: string;
	folder: string;
	conflict: boolean;
	/** Agents the skill was first imported from; null = property absent. Never changed by sync. */
	sources: string[] | null;
}

export const VAULT = 'vault';

export interface SkillCopy {
	/** VAULT or an agent id. */
	owner: string;
	/** Absolute folder of this copy. */
	dir: string;
	/** Leaf folder name (agent-side skill folder name). */
	folder: string;
	/** Category path relative to the agent (or archive) root, '/'-separated, '' at root. */
	relPath: string;
	archived: boolean;
	/** Agent-form files ('/'-separated relative paths). The vault SKILL.md is already converted with toAgentText. */
	files: Map<string, Uint8Array>;
	mtimeMs: number;
	/** Lenient content key (see scan.contentKey). */
	key: string;
	/** Set when the copy's folder is a symlink (resolved target). */
	symlinkTarget?: string;
}

export interface VaultSkill {
	name: string;
	copy: SkillCopy;
	rawSkillMd: string;
	meta: PluginMeta;
	hasConflictFile: boolean;
}

export interface SkillGroup {
	name: string;
	vault?: VaultSkill;
	copies: SkillCopy[];
	/** For not-yet-imported groups: agent-side folder name when it differs from name. */
	newFolder?: string;
	/** For not-yet-imported groups: category path to record. */
	newPath?: string;
}
