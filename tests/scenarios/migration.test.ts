import { lstatSync, symlinkSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readMeta } from '../../src/core/frontmatter';
import { runSync } from '../../src/core/sync';
import { T0, put, skillMd } from '../helpers';
import { StubResolver, world } from './harness';

describe('scenario 14: symlink migration', () => {
	it('replaces links into the hub with real copies and ticks the agent', async () => {
		const w = world([{ id: 'claude' }]);
		w.put('vault', { 'brainstorming/SKILL.md': w.vaultMd(skillMd('brainstorming'), { claude: null }) }, T0);
		symlinkSync(join(w.hub, 'brainstorming'), join(w.dir('claude'), 'brainstorming'));
		const r = new StubResolver();
		await runSync(w.cfg, r);
		expect(r.migrations).toHaveLength(1);
		expect(r.migrations[0]?.[0]?.insideHub).toBe(true);
		const link = join(w.dir('claude'), 'brainstorming');
		expect(lstatSync(link).isSymbolicLink()).toBe(false);
		expect(w.tree('claude')['brainstorming/SKILL.md']).toBe(skillMd('brainstorming'));
		expect(readMeta(w.tree('vault')['brainstorming/SKILL.md'] ?? '', 'agent-').states.claude).toBe(true);
		const again = new StubResolver();
		await runSync(w.cfg, again);
		expect(again.migrations).toHaveLength(0);
	});

	it('materializes links pointing outside the hub and imports them', async () => {
		const w = world([{ id: 'claude' }]);
		const outside = join(w.root, 'elsewhere', 'ext');
		put(outside, { 'SKILL.md': skillMd('ext') });
		symlinkSync(outside, join(w.dir('claude'), 'ext'));
		await runSync(w.cfg, new StubResolver());
		expect(lstatSync(join(w.dir('claude'), 'ext')).isSymbolicLink()).toBe(false);
		expect(readMeta(w.tree('vault')['ext/SKILL.md'] ?? '', 'agent-').states.claude).toBe(true);
	});

	it('leaves links alone when the user declines', async () => {
		const w = world([{ id: 'claude' }]);
		w.put('vault', { 'b/SKILL.md': w.vaultMd(skillMd('b'), { claude: true }) }, T0);
		symlinkSync(join(w.hub, 'b'), join(w.dir('claude'), 'b'));
		const r = new StubResolver();
		r.confirmMigration = async () => false;
		const report = await runSync(w.cfg, r);
		expect(lstatSync(join(w.dir('claude'), 'b')).isSymbolicLink()).toBe(true);
		expect(report.errors.join('\n')).toMatch(/symlink/);
	});
});
