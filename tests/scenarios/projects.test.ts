import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readMeta, setMeta } from '../../src/core/frontmatter';
import type { ProjectConfig } from '../../src/core/model';
import { syncTargets } from '../../src/core/projects';
import { runSync } from '../../src/core/sync';
import { T0, T1, put, skillMd, tree } from '../helpers';
import { StubResolver, world } from './harness';

function projectWorld(perAgentColumns: boolean) {
	const w = world([
		{ id: 'claude', projectDir: '.claude/skills' },
		{ id: 'codex', projectDir: '.agents/skills' },
		{ id: 'pi', projectDir: '.agents/skills' },
	]);
	const root = join(w.root, 'work', 'myapp');
	mkdirSync(root, { recursive: true });
	const project: ProjectConfig = { id: 'myapp', label: 'My app', root, perAgentColumns };
	const agents = w.cfg.agents;
	const cfg = { ...w.cfg, agents: syncTargets(agents, [project]) };
	const order = [...new Set(cfg.agents.map((a) => a.stateKey ?? a.id))];
	const tick = (name: string, states: Record<string, boolean | null>) => {
		const raw = w.tree('vault')[`${name}/SKILL.md`] ?? '';
		const meta = readMeta(raw, 'agent-');
		w.put('vault', { [`${name}/SKILL.md`]: setMeta(raw, { ...meta, states: { ...meta.states, ...states } }, 'agent-', order) });
	};
	return { w, root, cfg, tick };
}

describe('project with one column', () => {
	it('ticking copies the skill into every agent folder of the project, creating them; unticking removes it', async () => {
		const { w, root, cfg, tick } = projectWorld(false);
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), { claude: null, codex: null, pi: null }) }, T0);
		await runSync(cfg, new StubResolver());
		expect(readMeta(w.tree('vault')['x/SKILL.md'] ?? '', 'agent-').states).toEqual({ claude: null, codex: null, pi: null, myapp: null });
		expect(existsSync(join(root, '.claude'))).toBe(false);

		tick('x', { myapp: true });
		await runSync(cfg, new StubResolver());
		expect(tree(join(root, '.claude/skills'))).toEqual({ 'x/SKILL.md': skillMd('x') });
		expect(tree(join(root, '.agents/skills'))).toEqual({ 'x/SKILL.md': skillMd('x') });

		tick('x', { myapp: false });
		await runSync(cfg, new StubResolver());
		expect(tree(join(root, '.claude/skills'))).toEqual({});
		expect(tree(join(root, '.agents/skills'))).toEqual({});
	});

	it('imports a skill found in a project folder, ticked for the project', async () => {
		const { w, root, cfg } = projectWorld(false);
		put(join(root, '.claude/skills'), { 'local/SKILL.md': skillMd('local') }, T1);
		await runSync(cfg, new StubResolver());
		const meta = readMeta(w.tree('vault')['local/SKILL.md'] ?? '', 'agent-');
		expect(meta.states).toEqual({ claude: null, codex: null, pi: null, myapp: true });
		expect(meta.sources).toEqual(['myapp']);
		// The next sync completes the project: the other folder gets it too.
		await runSync(cfg, new StubResolver());
		expect(tree(join(root, '.agents/skills'))['local/SKILL.md']).toBe(skillMd('local'));
	});

	it('skips a project whose folder is missing', async () => {
		const { w, cfg } = projectWorld(false);
		const gone = { ...cfg, agents: cfg.agents.map((a) => (a.createIn ? { ...a, createIn: join(w.root, 'nope'), path: join(w.root, 'nope', 'x') } : a)) };
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), { myapp: true }) }, T0);
		const report = await runSync(gone, new StubResolver());
		expect(report.errors).toEqual([]);
		expect(existsSync(join(w.root, 'nope'))).toBe(false);
	});
});

describe('project with one column per agent', () => {
	it('each folder follows its own checkbox', async () => {
		const { w, root, cfg, tick } = projectWorld(true);
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), {}) }, T0);
		await runSync(cfg, new StubResolver());
		tick('x', { 'myapp-claude': true, 'myapp-agents': false });
		await runSync(cfg, new StubResolver());
		expect(tree(join(root, '.claude/skills'))).toEqual({ 'x/SKILL.md': skillMd('x') });
		expect(existsSync(join(root, '.agents/skills/x'))).toBe(false);
	});
});
