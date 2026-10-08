import { describe, expect, it } from 'vitest';
import type { AgentConfig, ProjectConfig } from '../src/core/model';
import { expandProject, projectColumns, projectFolders, stateKeys, syncTargets } from '../src/core/projects';

const ag = (id: string, label: string, projectDir?: string): AgentConfig => ({
	id, label, path: `~/.${id}/skills`, kind: 'agent', layout: 'flat', archiveDir: '', projectDir,
});
const AGENTS = [ag('claude', 'Claude Code', '.claude/skills'), ag('codex', 'Codex', '.agents/skills'), ag('pi', 'Pi', '.agents/skills'), ag('openclaw', 'OpenClaw')];
const proj = (perAgentColumns: boolean): ProjectConfig => ({ id: 'myapp', label: 'My app', root: '/work/myapp', perAgentColumns });

describe('projectFolders', () => {
	it('lists each project skills folder once, with the agents using it; agents without one are skipped', () => {
		expect(projectFolders(AGENTS).map((f) => [f.dir, f.agents.map((a) => a.id)])).toEqual([
			['.claude/skills', ['claude']],
			['.agents/skills', ['codex', 'pi']],
		]);
	});
});

describe('expandProject', () => {
	it('one column: every folder is driven by the project checkbox and may be created', () => {
		const t = expandProject(proj(false), AGENTS);
		expect(t.map((x) => [x.path, x.stateKey, x.createIn])).toEqual([
			['/work/myapp/.claude/skills', 'myapp', '/work/myapp'],
			['/work/myapp/.agents/skills', 'myapp', '/work/myapp'],
		]);
		expect(new Set(t.map((x) => x.id)).size).toBe(2);
		expect(t[1]?.label).toBe('My app · Codex, Pi');
	});
	it('per-agent columns: one checkbox per folder', () => {
		const t = expandProject(proj(true), AGENTS);
		expect(t.map((x) => x.stateKey)).toEqual(['myapp-claude', 'myapp-agents']);
	});
	it('expands ~ in the project folder', () => {
		expect(expandProject({ ...proj(false), root: '~/w/app' }, AGENTS, '/home/me')[0]?.path).toBe('/home/me/w/app/.claude/skills');
	});
});

describe('columns and targets', () => {
	it('projectColumns: one column, or one per folder with readable labels', () => {
		expect(projectColumns(proj(false), AGENTS)).toEqual([{ id: 'myapp', label: 'My app' }]);
		expect(projectColumns(proj(true), AGENTS)).toEqual([
			{ id: 'myapp-claude', label: 'My app · Claude Code' },
			{ id: 'myapp-agents', label: 'My app · Codex, Pi' },
		]);
	});
	it('syncTargets and stateKeys: agents first, then project folders; one key per checkbox', () => {
		const targets = syncTargets(AGENTS, [proj(false)]);
		expect(targets).toHaveLength(6);
		expect(stateKeys(targets)).toEqual(['claude', 'codex', 'pi', 'openclaw', 'myapp']);
	});
});

describe('switchProjectColumns', () => {
	it('copies the single column to every per-agent column, and back (true if any, false if all false)', async () => {
		const { switchStates } = await import('../src/core/projects');
		expect(switchStates({ myapp: true, claude: null }, ['myapp'], ['myapp-claude', 'myapp-codex'])).toEqual({
			claude: null, 'myapp-claude': true, 'myapp-codex': true,
		});
		expect(switchStates({ 'myapp-claude': false, 'myapp-codex': true }, ['myapp-claude', 'myapp-codex'], ['myapp'])).toEqual({ myapp: true });
		expect(switchStates({ 'myapp-claude': false, 'myapp-codex': false }, ['myapp-claude', 'myapp-codex'], ['myapp'])).toEqual({ myapp: false });
		expect(switchStates({ 'myapp-claude': null, 'myapp-codex': false }, ['myapp-claude', 'myapp-codex'], ['myapp'])).toEqual({ myapp: null });
	});
});
