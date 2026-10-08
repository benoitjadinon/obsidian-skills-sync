import type { AgentConfig, ProjectConfig } from './model';
import { projectColumns } from './projects';

/** Settings shared by every computer using the vault. */
export interface SharedSettings {
	hubFolder: string;
	propPrefix: string;
	/** Base file name pattern; each computer gets its own file (see deviceBasePath). */
	basePath: string;
	autoPullExternal: 'ask' | 'auto';
	autoSync: boolean;
}

/** Settings of one computer: its agents and projects differ from the other computers'. */
export interface DeviceProfile {
	name: string;
	/** Paths may start with "~". */
	agents: AgentConfig[];
	/** Code projects: their agents' project skills folders, synced from one column or one per folder. */
	projects: ProjectConfig[];
	mergeCommand: string;
	initialized: boolean;
}

/** What is stored in data.json (synced with the vault). */
export interface StoredSettings extends SharedSettings {
	version: 2;
	devices: Record<string, DeviceProfile>;
}

/** What the plugin works with: the shared settings plus this computer's profile. */
export interface HubSettings extends SharedSettings, Omit<DeviceProfile, 'name'> {
	deviceName: string;
}

export const DEFAULT_SETTINGS: HubSettings = {
	hubFolder: 'Skills',
	propPrefix: 'agent-',
	basePath: 'Skills/Skills.base',
	agents: [],
	projects: [],
	autoPullExternal: 'ask',
	autoSync: true,
	mergeCommand: '',
	initialized: false,
	deviceName: '',
};

const SHARED_KEYS = ['hubFolder', 'propPrefix', 'basePath', 'autoPullExternal', 'autoSync'] as const;

function shared(raw: Record<string, unknown>): SharedSettings {
	const out = {} as Record<string, unknown>;
	for (const k of SHARED_KEYS) out[k] = raw[k] ?? DEFAULT_SETTINGS[k];
	return out as unknown as SharedSettings;
}

/**
 * Read data.json in any format. v1 (one flat profile, before per-computer settings) becomes this
 * computer's profile.
 */
export function migrateSettings(raw: unknown, deviceId: string, deviceName: string): StoredSettings {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	if (r['version'] === 2 && r['devices'] && typeof r['devices'] === 'object') {
		return { ...shared(r), version: 2, devices: { ...(r['devices'] as Record<string, DeviceProfile>) } };
	}
	const devices: Record<string, DeviceProfile> = {};
	if ('agents' in r || 'initialized' in r) {
		devices[deviceId] = {
			name: deviceName,
			agents: (r['agents'] as AgentConfig[] | undefined) ?? [],
			projects: (r['projects'] as ProjectConfig[] | undefined) ?? [],
			mergeCommand: (r['mergeCommand'] as string | undefined) ?? '',
			initialized: (r['initialized'] as boolean | undefined) ?? false,
		};
	}
	return { ...shared(r), version: 2, devices };
}

/** The settings this computer works with. A computer without a profile starts fresh (detects its agents). */
export function toView(stored: StoredSettings, deviceId: string, deviceName: string): HubSettings {
	const p = stored.devices[deviceId];
	return {
		...shared(stored as unknown as Record<string, unknown>),
		agents: p?.agents ?? [],
		projects: p?.projects ?? [],
		mergeCommand: p?.mergeCommand ?? '',
		initialized: p?.initialized ?? false,
		deviceName: p?.name || deviceName,
	};
}

/**
 * What to write back: the data.json currently on disk (which may hold the other computers' latest
 * profiles, e.g. after a git pull) with this computer's profile and the shared settings replaced.
 */
export function mergeView(onDisk: unknown, deviceId: string, view: HubSettings): StoredSettings {
	const base = migrateSettings(onDisk, deviceId, view.deviceName);
	return {
		...shared(view as unknown as Record<string, unknown>),
		version: 2,
		devices: {
			...base.devices,
			[deviceId]: { name: view.deviceName, agents: view.agents, projects: view.projects, mergeCommand: view.mergeCommand, initialized: view.initialized },
		},
	};
}

/** Names of the other computers whose agents or projects still use this column. */
export function devicesUsingColumn(stored: StoredSettings, deviceId: string, columnId: string): string[] {
	return Object.entries(stored.devices)
		.filter(([id]) => id !== deviceId)
		.filter(([, p]) => p.agents.some((a) => a.id === columnId) || p.projects.some((pr) => projectColumns(pr, p.agents).some((c) => c.id === columnId)))
		.map(([, p]) => p.name);
}
