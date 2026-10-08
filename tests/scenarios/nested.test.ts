import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readMeta, setMeta } from '../../src/core/frontmatter';
import { deleteEverywhere, removeFromAgents, runSync } from '../../src/core/sync';
import { T0, T1, put, skillMd, tree } from '../helpers';
import { keep, StubResolver, world } from './harness';

const hermesWorld = () => world([{ id: 'claude' }, { id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
const setStates = (w: ReturnType<typeof hermesWorld>, name: string, states: Record<string, boolean | null>) => {
	const raw = w.tree('vault')[`${name}/SKILL.md`] ?? '';
	const meta = readMeta(raw, 'agent-');
	w.put('vault', { [`${name}/SKILL.md`]: setMeta(raw, { ...meta, states: { ...meta.states, ...states } }, 'agent-', ['claude', 'hermes']) });
};

describe('scenario 4: Hermes bundled update', () => {
	it('conflicts, then propagates Hermes version and keeps agent-path', async () => {
		const w = hermesWorld();
		const v1 = skillMd('github-auth');
		const v2 = skillMd('github-auth', '# github-auth v2\n');
		w.put('vault', { 'github-auth/SKILL.md': w.vaultMd(v1, { claude: true, hermes: true }, '', 'github') }, T0);
		w.put('claude', { 'github-auth/SKILL.md': v1 }, T0);
		w.put('hermes', { 'github/github-auth/SKILL.md': v2 }, T1);
		const r = new StubResolver(keep('hermes'));
		await runSync(w.cfg, r);
		expect(r.requests[0]?.conflict.kind).toBe('external');
		expect(w.tree('claude')['github-auth/SKILL.md']).toBe(v2);
		expect(readMeta(w.tree('vault')['github-auth/SKILL.md'] ?? '', 'agent-').path).toBe('github');
	});
});

describe('scenario 9: Hermes archive', () => {
	it('imports archived as false, unarchives on true, archives on false', async () => {
		const w = hermesWorld();
		w.put('hermes', { '.archive/foo/SKILL.md': skillMd('foo') }, T0);
		await runSync(w.cfg, new StubResolver());
		expect(readMeta(w.tree('vault')['foo/SKILL.md'] ?? '', 'agent-').states).toEqual({ claude: null, hermes: false });
		expect(w.tree('hermes')['.archive/foo/SKILL.md']).toBeDefined();

		setStates(w, 'foo', { hermes: true });
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('hermes')['.archive/foo/SKILL.md']).toBeUndefined();
		expect(w.tree('hermes')['foo/SKILL.md']).toBe(skillMd('foo'));

		setStates(w, 'foo', { hermes: false });
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('hermes')['foo/SKILL.md']).toBeUndefined();
		expect(w.tree('hermes')['.archive/foo/SKILL.md']).toBe(skillMd('foo'));
	});
});

describe('scenario 10: same-name skills', () => {
	it('merges identical copies across agents into one skill with the nested path', async () => {
		const w = hermesWorld();
		w.put('claude', { 'plan/SKILL.md': skillMd('plan') }, T0);
		w.put('hermes', { 'software-development/plan/SKILL.md': skillMd('plan') }, T0);
		await runSync(w.cfg, new StubResolver());
		const meta = readMeta(w.tree('vault')['plan/SKILL.md'] ?? '', 'agent-');
		expect(meta.states).toEqual({ claude: true, hermes: true });
		expect(meta.path).toBe('software-development');
	});
	it('splits different same-name skills of one agent and stays stable', async () => {
		const w = hermesWorld();
		w.put('hermes', { 'a/plan/SKILL.md': skillMd('plan', '# A\n'), 'b/plan/SKILL.md': skillMd('plan', '# B\n') }, T0);
		await runSync(w.cfg, new StubResolver());
		expect(Object.keys(w.tree('vault')).sort()).toEqual(['b-plan/SKILL.md', 'plan/SKILL.md']);
		const split = readMeta(w.tree('vault')['b-plan/SKILL.md'] ?? '', 'agent-');
		expect(split.folder).toBe('plan');
		expect(split.path).toBe('b');
		const r = new StubResolver();
		const second = await runSync(w.cfg, r);
		expect(r.requests).toHaveLength(0);
		expect(second.applied).toHaveLength(0);
	});
});

describe('delete everywhere / remove from agents', () => {
	it('removes the vault folder and active agent copies', async () => {
		const w = hermesWorld();
		w.put('claude', { 'x/SKILL.md': skillMd('x') }, T0);
		w.put('hermes', { 'cat/x/SKILL.md': skillMd('x') }, T0);
		await runSync(w.cfg, new StubResolver());
		const removed = await deleteEverywhere(w.cfg, 'x');
		expect(removed).toHaveLength(3);
		expect(existsSync(join(w.hub, 'x'))).toBe(false);
		expect(w.tree('claude')).toEqual({});
		expect(w.tree('hermes')['cat/x/SKILL.md']).toBeUndefined();
	});
	it('removeFromAgents deletes copies by folder name after the vault note is gone', async () => {
		const w = hermesWorld();
		w.put('claude', { 'x/SKILL.md': skillMd('x') }, T0);
		expect(await removeFromAgents(w.cfg, 'x')).toHaveLength(1);
		expect(w.tree('claude')).toEqual({});
	});
});

describe('archive folder outside the agent folder', () => {
	it('imports from it, restores from it and archives into it', async () => {
		const base = hermesWorld();
		const external = join(base.root, 'elsewhere', 'hermes-archive');
		const hermes = base.cfg.agents.find((a) => a.id === 'hermes');
		if (!hermes) throw new Error('no hermes');
		hermes.archiveDir = external;
		put(external, { 'foo/SKILL.md': skillMd('foo') }, T0);
		await runSync(base.cfg, new StubResolver());
		expect(readMeta(base.tree('vault')['foo/SKILL.md'] ?? '', 'agent-').states).toEqual({ claude: null, hermes: false });

		setStates(base, 'foo', { hermes: true });
		await runSync(base.cfg, new StubResolver());
		expect(tree(external)).toEqual({});
		expect(base.tree('hermes')['foo/SKILL.md']).toBe(skillMd('foo'));

		setStates(base, 'foo', { hermes: false });
		await runSync(base.cfg, new StubResolver());
		expect(base.tree('hermes')).toEqual({});
		expect(tree(external)['foo/SKILL.md']).toBe(skillMd('foo'));
	});
});
