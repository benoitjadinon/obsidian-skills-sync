import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readMeta, setMeta } from '../../src/core/frontmatter';
import { createSkill, runSync } from '../../src/core/sync';
import { T0, T1, T2, skillMd, touch } from '../helpers';
import { keep, StubResolver, world } from './harness';

const ORCA_V2 = skillMd('brainstorming', '# brainstorming v2\n', 'version: 2\n');

function orcaWorld() {
	const w = world([{ id: 'claude' }, { id: 'codex' }, { id: 'opencode' }, { id: 'gemini' }]);
	const v1 = skillMd('brainstorming');
	w.put('vault', { 'brainstorming/SKILL.md': w.vaultMd(v1, { claude: true, codex: true, opencode: true, gemini: null }, 'rating: 5\n') }, T0);
	for (const id of ['claude', 'codex', 'opencode']) w.put(id, { 'brainstorming/SKILL.md': v1 }, T0);
	return { w, v1 };
}

describe('scenario 1: Orca partial update', () => {
	it('asks, then propagates the chosen version and keeps vault-only data', async () => {
		const { w } = orcaWorld();
		w.put('claude', { 'brainstorming/SKILL.md': ORCA_V2 }, T1);
		w.put('opencode', { 'brainstorming/SKILL.md': ORCA_V2 }, T1);
		const r = new StubResolver(keep('claude'));
		await runSync(w.cfg, r);
		expect(r.requests).toHaveLength(1);
		const req = r.requests[0];
		expect(req?.conflict.kind).toBe('external');
		expect(Object.values(req?.conflict.owners ?? {}).map((o) => [...o].sort())).toEqual(
			expect.arrayContaining([['codex', 'vault'], ['claude', 'opencode']]),
		);
		const vault = w.tree('vault')['brainstorming/SKILL.md'] ?? '';
		expect(vault).toContain('# brainstorming v2');
		expect(vault).toContain('rating: 5\n');
		expect(readMeta(vault, 'agent-').skillKeys).toEqual(['name', 'description', 'version']);
		expect(readMeta(vault, 'agent-').states).toEqual({ claude: true, codex: true, opencode: true, gemini: null });
		expect(w.tree('codex')['brainstorming/SKILL.md']).toBe(ORCA_V2);
	});

	it('with autoPullExternal=auto pulls without asking', async () => {
		const { w } = orcaWorld();
		w.cfg.autoPullExternal = 'auto';
		w.put('claude', { 'brainstorming/SKILL.md': ORCA_V2 }, T1);
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.requests).toHaveLength(0);
		expect(w.tree('codex')['brainstorming/SKILL.md']).toBe(ORCA_V2);
		expect(w.tree('opencode')['brainstorming/SKILL.md']).toBe(ORCA_V2);
	});
});

describe('scenario 2: Orca update while the vault was edited', () => {
	it('raises a diverged conflict with a base and writes nothing to agents', async () => {
		const { w, v1 } = orcaWorld();
		const vaultPath = join(w.hub, 'brainstorming/SKILL.md');
		w.put('vault', { 'brainstorming/SKILL.md': (w.tree('vault')['brainstorming/SKILL.md'] ?? '').replace('Do things.', 'Do vault things.') }, T2);
		w.put('claude', { 'brainstorming/SKILL.md': ORCA_V2 }, T1);
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.requests[0]?.conflict.kind).toBe('diverged');
		expect(r.requests[0]?.conflict.base?.owner).toMatch(/codex|opencode/);
		expect(w.tree('claude')['brainstorming/SKILL.md']).toBe(ORCA_V2);
		expect(w.tree('codex')['brainstorming/SKILL.md']).toBe(v1);
		expect(readMeta(w.tree('vault')['brainstorming/SKILL.md'] ?? '', 'agent-').conflict).toBe(true);
		expect(existsSync(vaultPath)).toBe(true);
	});
});

describe('scenario 3: update to an undecided agent', () => {
	it('is ignored', async () => {
		const { w, v1 } = orcaWorld();
		w.put('gemini', { 'brainstorming/SKILL.md': ORCA_V2 }, T1);
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.requests).toHaveLength(0);
		expect(w.tree('codex')['brainstorming/SKILL.md']).toBe(v1);
		expect(w.tree('gemini')['brainstorming/SKILL.md']).toBe(ORCA_V2);
	});
});

describe('scenario 5: vault body edit', () => {
	it('pushes the clean export to true agents only', async () => {
		const w = world([{ id: 'claude' }, { id: 'codex' }, { id: 'gemini' }, { id: 'cursor' }]);
		const v1 = skillMd('x');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v1, { claude: true, codex: true, gemini: null, cursor: false }, 'rating: 5\n').replace('Do things.', 'Do better things.') }, T1);
		w.put('claude', { 'x/SKILL.md': v1 }, T0);
		w.put('codex', { 'x/SKILL.md': v1 }, T0);
		w.put('gemini', { 'x/SKILL.md': v1 }, T0);
		await runSync(w.cfg, new StubResolver());
		const expected = v1.replace('Do things.', 'Do better things.');
		expect(w.tree('claude')['x/SKILL.md']).toBe(expected);
		expect(w.tree('codex')['x/SKILL.md']).toBe(expected);
		expect(w.tree('gemini')['x/SKILL.md']).toBe(v1);
		expect(w.tree('cursor')).toEqual({});
	});
});

describe('scenario 6: checkbox-only edit', () => {
	it('copies to the newly ticked agent and does not rewrite others', async () => {
		const w = world([{ id: 'claude' }, { id: 'codex' }]);
		const v1 = skillMd('x');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v1, { claude: true, codex: true }) }, T2);
		w.put('claude', { 'x/SKILL.md': v1 }, T0);
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('codex')['x/SKILL.md']).toBe(v1);
		expect(statSync(join(w.dir('claude'), 'x/SKILL.md')).mtime.getTime()).toBe(T0.getTime());
	});
});

describe('scenario 7: formatting-only drift', () => {
	it('is not a change', async () => {
		const w = world([{ id: 'claude' }]);
		const v1 = skillMd('x');
		const drifted = v1.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v1, { claude: true }) }, T0);
		w.put('claude', { 'x/SKILL.md': drifted }, T1);
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.requests).toHaveLength(0);
		expect(w.tree('claude')['x/SKILL.md']).toBe(drifted);
	});
});

describe('scenario 8: untick the source agent', () => {
	it('removes it from the agent, keeps the vault', async () => {
		const w = world([{ id: 'claude' }]);
		const v1 = skillMd('x');
		w.put('claude', { 'x/SKILL.md': v1 }, T0);
		await runSync(w.cfg, new StubResolver());
		const p = join(w.hub, 'x/SKILL.md');
		w.put('vault', { 'x/SKILL.md': setMeta(w.tree('vault')['x/SKILL.md'] ?? '', { ...readMeta(w.tree('vault')['x/SKILL.md'] ?? '', 'agent-'), states: { claude: false } }, 'agent-', ['claude']) });
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('claude')).toEqual({});
		expect(existsSync(p)).toBe(true);
	});
	it('asks first when the agent copy was modified', async () => {
		const w = world([{ id: 'claude' }]);
		const v1 = skillMd('x');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v1, { claude: false }) }, T0);
		w.put('claude', { 'x/SKILL.md': skillMd('x', '# changed\n') }, T1);
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.requests[0]?.conflict.kind).toBe('delete');
		expect(w.tree('claude')['x/SKILL.md']).toBeDefined();
	});
});

describe('scenario 11: new skill from Obsidian', () => {
	it('is pushed only after an agent is ticked', async () => {
		const w = world([{ id: 'claude' }, { id: 'codex' }]);
		const path = await createSkill(w.cfg, 'my-new', 'Does new things');
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('claude')).toEqual({});
		const raw = w.tree('vault')['my-new/SKILL.md'] ?? '';
		w.put('vault', { 'my-new/SKILL.md': setMeta(raw, { ...readMeta(raw, 'agent-'), states: { claude: true, codex: null } }, 'agent-', ['claude', 'codex']) });
		touch(path, T2);
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('claude')['my-new/SKILL.md']).toBe('---\nname: my-new\ndescription: "Does new things"\n---\n\n# my-new\n');
		expect(w.tree('codex')).toEqual({});
	});
});

describe('scenario 12: skill without frontmatter', () => {
	it('round-trips without gaining frontmatter', async () => {
		const w = world([{ id: 'claude' }]);
		w.put('claude', { 'plain/SKILL.md': '# Plain\n\nbody\n' }, T0);
		await runSync(w.cfg, new StubResolver());
		expect(w.tree('vault')['plain/SKILL.md']).toContain('agent-skill-keys: []');
		const r = new StubResolver();
		const report = await runSync(w.cfg, r);
		expect(report.applied).toHaveLength(0);
		expect(w.tree('claude')['plain/SKILL.md']).toBe('# Plain\n\nbody\n');
	});
});

describe('review focus: missing agent folder', () => {
	it('skips the agent entirely', async () => {
		const w = world([{ id: 'claude' }]);
		w.cfg.agents.push({ id: 'gone', label: 'Gone', path: join(w.root, 'agents', 'gone-missing'), kind: 'agent', layout: 'flat', archiveDir: '' });
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), { claude: true, gone: true }) }, T0);
		w.put('claude', { 'x/SKILL.md': skillMd('x') }, T0);
		const report = await runSync(w.cfg, new StubResolver());
		expect(report.errors).toEqual([]);
		expect(existsSync(join(w.root, 'agents', 'gone-missing'))).toBe(false);
	});
});

describe('vault shared between computers', () => {
	it('leaves columns of agents configured only on another computer untouched', async () => {
		const w = world([{ id: 'claude' }]);
		const raw = w.vaultMd(skillMd('x'), { claude: true }).replace('agent-claude: true', 'agent-claude: true\nagent-hermes: true');
		w.put('vault', { 'x/SKILL.md': raw }, T0);
		w.put('claude', { 'x/SKILL.md': skillMd('x') }, T0);
		await runSync(w.cfg, new StubResolver());
		const after = w.tree('vault')['x/SKILL.md'] ?? '';
		expect(readMeta(after, 'agent-').states).toEqual({ claude: true, hermes: true });
		// A vault edit (body) is pushed here, and still keeps the other computer's column.
		w.put('vault', { 'x/SKILL.md': after.replace('Do things.', 'Do more.') }, T2);
		await runSync(w.cfg, new StubResolver());
		expect(readMeta(w.tree('vault')['x/SKILL.md'] ?? '', 'agent-').states).toEqual({ claude: true, hermes: true });
		expect(w.tree('claude')['x/SKILL.md']).toContain('Do more.');
	});
});
