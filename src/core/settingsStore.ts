import type { AgentConfig, ProjectConfig } from './model';

/** Settings stored in data.json, shared by every computer using the vault. */
export interface StoredSettings {
	hubFolder: string;
	propPrefix: string;
	basePath: string;
	/** Base view whose columns the plugin manages; '' = the first table view. */
	baseView: string;
	/** Paths may start with "~"; an agent is available on a computer when its folder exists there. */
	agents: AgentConfig[];
	/** Code projects; available on a computer when the project folder exists there. */
	projects: ProjectConfig[];
	autoPullExternal: 'ask' | 'auto';
	autoSync: boolean;
}

/** What the plugin works with: the shared settings plus this computer's merge tool. */
export interface HubSettings extends StoredSettings {
	/** Per computer (Obsidian's per-device storage), never in data.json. */
	mergeCommand: string;
}

export const DEFAULT_SETTINGS: HubSettings = {
	hubFolder: 'Skills',
	propPrefix: 'agent-',
	basePath: 'Skills/Skills.base',
	baseView: '',
	agents: [],
	projects: [],
	autoPullExternal: 'ask',
	autoSync: true,
	mergeCommand: '',
};

const STORED_KEYS = ['hubFolder', 'propPrefix', 'basePath', 'baseView', 'agents', 'projects', 'autoPullExternal', 'autoSync'] as const;

function unionById<T extends { id: string }>(lists: T[][]): T[] {
	const out: T[] = [];
	for (const list of lists) for (const item of list) if (!out.some((x) => x.id === item.id)) out.push(item);
	return out;
}

/**
 * Read data.json in any earlier format. Per-computer profiles (v2) become one shared list; merge
 * tools come back separately (keyed by the old computer id, '' for v1) to move to per-device storage.
 */
export function migrateSettings(raw: unknown): { settings: HubSettings; mergeCommands: Record<string, string>; changed: boolean } {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const settings: HubSettings = { ...DEFAULT_SETTINGS };
	for (const k of STORED_KEYS) if (r[k] !== undefined) (settings as unknown as Record<string, unknown>)[k] = r[k];
	const mergeCommands: Record<string, string> = {};
	let changed = false;
	if (r['devices'] && typeof r['devices'] === 'object') {
		const devices = Object.entries(r['devices'] as Record<string, { agents?: AgentConfig[]; projects?: ProjectConfig[]; mergeCommand?: string }>);
		settings.agents = unionById(devices.map(([, d]) => d.agents ?? []));
		settings.projects = unionById(devices.map(([, d]) => d.projects ?? []));
		for (const [id, d] of devices) if (d.mergeCommand) mergeCommands[id] = d.mergeCommand;
		changed = true;
	} else if (typeof r['mergeCommand'] === 'string' || 'initialized' in r || 'version' in r) {
		if (typeof r['mergeCommand'] === 'string' && r['mergeCommand']) mergeCommands[''] = r['mergeCommand'];
		changed = true;
	}
	return { settings, mergeCommands, changed };
}

/** Three-way merge by id: keep what was added on disk meanwhile, apply this computer's edits and removals. */
export function mergeLists<T extends { id: string }>(disk: T[], loaded: T[], mine: T[]): T[] {
	const known = new Set([...loaded, ...mine].map((x) => x.id));
	return [...mine, ...disk.filter((x) => !known.has(x.id))];
}

/** What to write: this computer's settings, with list items another computer added meanwhile (e.g. after a git pull). */
export function mergeOnSave(onDisk: unknown, loaded: HubSettings, mine: HubSettings): StoredSettings {
	const disk = migrateSettings(onDisk).settings;
	const out = {} as Record<string, unknown>;
	for (const k of STORED_KEYS) out[k] = mine[k];
	out['agents'] = mergeLists(disk.agents, loaded.agents, mine.agents);
	out['projects'] = mergeLists(disk.projects, loaded.projects, mine.projects);
	return out as unknown as StoredSettings;
}
