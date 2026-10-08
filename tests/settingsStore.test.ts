import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeLists, mergeOnSave, migrateSettings } from '../src/core/settingsStore';
import type { AgentConfig } from '../src/core/model';

const agent = (id: string, label = id): AgentConfig => ({ id, label, path: `~/.${id}/skills`, kind: 'agent', layout: 'flat', archiveDir: '' });
const project = (id: string) => ({ id, label: id, root: `~/w/${id}`, perAgentColumns: false });

describe('migrateSettings', () => {
	it('keeps v1 flat settings, moving the merge tool out', () => {
		const m = migrateSettings({ hubFolder: 'AI/skills', agents: [agent('claude')], mergeCommand: 'code', initialized: true });
		expect(m.settings.agents).toEqual([agent('claude')]);
		expect(m.settings.hubFolder).toBe('AI/skills');
		expect(m.mergeCommands).toEqual({ '': 'code' });
		expect(m.changed).toBe(true);
	});
	it('turns per-computer profiles (v2) into one shared list', () => {
		const v2 = {
			version: 2, hubFolder: 'AI/skills', basePath: 'AI/skills/skills.base',
			devices: {
				mac: { name: 'mac', agents: [agent('claude'), agent('hermes')], projects: [project('a')], mergeCommand: 'opendiff', initialized: true },
				linux: { name: 'linux', agents: [agent('claude', 'Claude (linux)'), agent('codex')], projects: [project('a'), project('b')], mergeCommand: 'meld', initialized: true },
			},
		};
		const m = migrateSettings(v2);
		expect(m.settings.agents.map((a) => a.id)).toEqual(['claude', 'hermes', 'codex']);
		expect(m.settings.agents[0]?.label).toBe('claude');
		expect(m.settings.projects.map((p) => p.id)).toEqual(['a', 'b']);
		expect(m.mergeCommands).toEqual({ mac: 'opendiff', linux: 'meld' });
		expect((m.settings as unknown as Record<string, unknown>)['devices']).toBeUndefined();
	});
	it('defaults without data', () => {
		const m = migrateSettings(null);
		expect(m.settings).toEqual({ ...DEFAULT_SETTINGS });
		expect(m.changed).toBe(false);
	});
});

describe('mergeLists (three-way, by id)', () => {
	it('keeps items added elsewhere, honours removals and edits made here', () => {
		const loaded = [agent('claude'), agent('codex')];
		const mine = [agent('claude', 'Claude edited')]; // removed codex here, edited claude
		const disk = [agent('claude'), agent('codex'), agent('hermes')]; // hermes added on the other computer
		expect(mergeLists(disk, loaded, mine).map((a) => [a.id, a.label])).toEqual([['claude', 'Claude edited'], ['hermes', 'hermes']]);
	});
});

describe('mergeOnSave', () => {
	it('merges lists with what is on disk; scalar settings come from here', () => {
		const loaded = { ...DEFAULT_SETTINGS, agents: [agent('claude')] };
		const mine = { ...loaded, autoSync: false, agents: [agent('claude'), agent('pi')] };
		const disk = { ...DEFAULT_SETTINGS, agents: [agent('claude'), agent('codex')], projects: [project('x')] };
		const out = mergeOnSave(disk, loaded, mine);
		expect(out.agents.map((a) => a.id)).toEqual(['claude', 'pi', 'codex']);
		expect(out.projects.map((p) => p.id)).toEqual(['x']);
		expect(out.autoSync).toBe(false);
		expect((out as unknown as Record<string, unknown>)['mergeCommand']).toBeUndefined();
	});
});

describe('deleted list', () => {
	it('is shared and merged like the other lists', () => {
		const loaded = { ...DEFAULT_SETTINGS, deleted: [{ id: 'a', at: '2026-10-01' }] };
		const mine = { ...loaded, deleted: [...loaded.deleted, { id: 'b', at: '2026-10-09' }] };
		const disk = { ...DEFAULT_SETTINGS, deleted: [{ id: 'a', at: '2026-10-01' }, { id: 'c', at: '2026-10-08' }] };
		expect(mergeOnSave(disk, loaded, mine).deleted.map((d) => d.id)).toEqual(['a', 'b', 'c']);
	});
});
