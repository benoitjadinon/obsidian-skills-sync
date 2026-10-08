import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { availablePresets, detectPresets, inferPreset, presetsFor } from '../src/core/agents';
import { tmp } from './helpers';

const mk = (home: string, ...dirs: string[]) => dirs.forEach((d) => mkdirSync(join(home, d), { recursive: true }));

describe('presetsFor', () => {
	it('gives Cline and Pi their own folders and keeps one shared ~/.agents entry', () => {
		const by = Object.fromEntries(presetsFor(tmp()).map((p) => [p.id, p]));
		expect(by['cline']?.path).toBe('~/.cline/skills');
		expect(by['pi']?.path).toBe('~/.pi/agent/skills');
		expect(by['agents']).toMatchObject({ label: 'Shared agents folder', path: '~/.agents/skills' });
		const all = presetsFor(tmp());
		expect(all.filter((p) => p.path === '~/.agents/skills')).toHaveLength(1);
		expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
	});

	it('turns every Hermes profile into its own agent', () => {
		const home = tmp();
		mk(home, '.hermes/skills', '.hermes/profiles/dev/skills', '.hermes/profiles/Doc Tor/skills');
		const by = Object.fromEntries(presetsFor(home).map((p) => [p.id, p]));
		expect(by['hermes-dev']).toMatchObject({
			label: 'Hermes Agent · dev', path: '~/.hermes/profiles/dev/skills', layout: 'nested', archiveDir: '.archive', preset: 'hermes-dev',
		});
		expect(by['hermes-doc-tor']?.path).toBe('~/.hermes/profiles/Doc Tor/skills');
	});

	it('finds the OpenClaw state folder (also its old names) and each OpenClaw agent workspace', () => {
		const home = tmp();
		mk(home, '.clawdbot/skills', '.clawdbot/agents/main', '.clawdbot/agents/writer', '.clawdbot/workspace/skills');
		writeFileSync(join(home, '.clawdbot/openclaw.json'), `{
			// JSON5 comments are allowed
			agents: { entries: { coder: { workspace: "~/code-ws" }, }, },
		}`);
		const by = Object.fromEntries(presetsFor(home).map((p) => [p.id, p]));
		expect(by['openclaw']?.path).toBe('~/.clawdbot/skills');
		expect(by['openclaw-main']).toMatchObject({ label: 'OpenClaw · main', path: '~/.clawdbot/workspace/skills' });
		expect(by['openclaw-writer']?.path).toBe('~/.clawdbot/workspace-writer/skills');
		expect(by['openclaw-coder']?.path).toBe('~/code-ws/skills');
	});

	it('detects only the folders that exist, profiles included', () => {
		const home = tmp();
		mk(home, '.claude/skills', '.hermes/skills', '.hermes/profiles/dev/skills', '.cline/skills', '.pi/agent/skills');
		expect(detectPresets(home).map((a) => a.id).sort()).toEqual(['claude', 'cline', 'hermes', 'hermes-dev', 'pi']);
	});

	it('marks profiles installed in the Start-from list and recognises them as presets', () => {
		const home = tmp();
		mk(home, '.hermes/profiles/dev/skills');
		const dev = availablePresets([], home).find((x) => x.preset.id === 'hermes-dev');
		expect(dev?.installed).toBe(true);
		const custom = { id: 'pi', label: 'pi', path: '~/.pi/agent/skills', kind: 'agent' as const, layout: 'flat' as const, archiveDir: '' };
		expect(inferPreset(custom, home)).toBe('pi');
	});
});
