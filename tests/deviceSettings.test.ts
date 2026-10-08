import { describe, expect, it } from 'vitest';
import { deviceBasePath } from '../src/core/base';
import { DEFAULT_SETTINGS, devicesUsingColumn, mergeView, migrateSettings, toView } from '../src/core/deviceSettings';
import type { AgentConfig } from '../src/core/model';
import { validateDeviceName } from '../src/core/validate';

const agent = (id: string): AgentConfig => ({ id, label: id, path: `~/.${id}/skills`, kind: 'agent', layout: 'flat', archiveDir: '' });

describe('migrateSettings', () => {
	it('turns v1 flat settings into shared settings plus this machine\'s profile', () => {
		const v1 = { hubFolder: 'AI/skills', propPrefix: 'agent-', basePath: 'AI/skills/skills.base', agents: [agent('claude')], projects: [], mergeCommand: 'code', initialized: true, autoSync: false, autoPullExternal: 'auto' };
		const s = migrateSettings(v1, 'mac-id', 'mac');
		expect(s.version).toBe(2);
		expect(s.hubFolder).toBe('AI/skills');
		expect(s.autoSync).toBe(false);
		expect(s.devices['mac-id']).toEqual({ name: 'mac', agents: [agent('claude')], projects: [], mergeCommand: 'code', initialized: true });
		expect((s as unknown as Record<string, unknown>)['agents']).toBeUndefined();
	});
	it('starts empty (defaults, no profiles) without data', () => {
		const s = migrateSettings(null, 'x', 'mac');
		expect(s.devices).toEqual({});
		expect(s.hubFolder).toBe(DEFAULT_SETTINGS.hubFolder);
	});
});

describe('toView / mergeView', () => {
	const stored = migrateSettings({ hubFolder: 'AI/skills', agents: [agent('claude')], initialized: true }, 'mac-id', 'mac');
	it('a new machine sees the shared settings and an empty, uninitialized profile', () => {
		const view = toView(stored, 'linux-id', 'linux');
		expect(view.hubFolder).toBe('AI/skills');
		expect(view.agents).toEqual([]);
		expect(view.initialized).toBe(false);
		expect(view.deviceName).toBe('linux');
	});
	it('saving keeps the other machine\'s profile that is on disk', () => {
		const linux = { ...toView(stored, 'linux-id', 'linux'), agents: [agent('codex')], initialized: true, autoSync: false };
		const saved = mergeView(stored, 'linux-id', linux);
		expect(saved.devices['mac-id']?.agents).toEqual([agent('claude')]);
		expect(saved.devices['linux-id']?.agents).toEqual([agent('codex')]);
		expect(saved.autoSync).toBe(false);
		expect(toView(saved, 'mac-id', 'mac').agents).toEqual([agent('claude')]);
	});
	it('lists other machines still using a column', () => {
		const both = mergeView(stored, 'linux-id', { ...toView(stored, 'linux-id', 'linux'), agents: [agent('claude'), agent('codex')] });
		expect(devicesUsingColumn(both, 'mac-id', 'claude')).toEqual(['linux']);
		expect(devicesUsingColumn(both, 'mac-id', 'hermes')).toEqual([]);
		expect(devicesUsingColumn(both, 'linux-id', 'codex')).toEqual([]);
	});
});

describe('deviceBasePath', () => {
	it('inserts the machine name before .base', () => {
		expect(deviceBasePath('AI/skills/skills.base', 'mac-server')).toBe('AI/skills/skills (mac-server).base');
		expect(deviceBasePath('Skills.base', 'Ben’s Mac')).toBe('Skills (Ben’s Mac).base');
		expect(deviceBasePath('AI/skills/skills', 'linux')).toBe('AI/skills/skills (linux).base');
	});
});

describe('validateDeviceName', () => {
	it('must be a short, filename-safe name', () => {
		expect(validateDeviceName('mac-server')).toBeNull();
		expect(validateDeviceName('')).toMatch(/required/i);
		expect(validateDeviceName('a/b')).toMatch(/character/);
		expect(validateDeviceName('x'.repeat(41))).toMatch(/40/);
	});
});
