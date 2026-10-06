import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveConflictFiles, writeConflictFiles } from '../../src/core/conflictFiles';
import { resolveWithExternalTool } from '../../src/core/externalMerge';
import { readMeta } from '../../src/core/frontmatter';
import { conflictLabels, mergeSkill } from '../../src/core/merge';
import { runSync } from '../../src/core/sync';
import { T0, T1, T2, skillMd } from '../helpers';
import { StubResolver, world } from './harness';

const BODY = '# S\n\n## A\nalpha\n\n## B\nbeta\n';

function threeWayWorld(vaultBody: string, claudeBody: string) {
	const w = world([{ id: 'claude' }, { id: 'codex' }]);
	const base = skillMd('s', BODY);
	w.put('vault', { 's/SKILL.md': w.vaultMd(skillMd('s', vaultBody), { claude: true, codex: true }) }, T2);
	w.put('claude', { 's/SKILL.md': skillMd('s', claudeBody) }, T1);
	w.put('codex', { 's/SKILL.md': base }, T0);
	return w;
}

describe('scenario 15: clean three-way merge', () => {
	it('applies both edits everywhere', async () => {
		const w = threeWayWorld(BODY.replace('alpha', 'ALPHA'), BODY.replace('beta', 'BETA'));
		const r = new StubResolver((req) => {
			const c = req.conflict;
			if (!c.ours || !c.theirs[0]) throw new Error('missing sides');
			expect(c.base?.owner).toBe('codex');
			const m = mergeSkill(c.ours, c.base, c.theirs[0], conflictLabels(c, req.labels));
			expect(m.clean).toBe(true);
			return { kind: 'apply', files: m.files };
		});
		await runSync(w.cfg, r);
		const merged = skillMd('s', BODY.replace('alpha', 'ALPHA').replace('beta', 'BETA'));
		expect(w.tree('claude')['s/SKILL.md']).toBe(merged);
		expect(w.tree('codex')['s/SKILL.md']).toBe(merged);
		expect(w.tree('vault')['s/SKILL.md']).toContain('ALPHA');
	});
});

describe('scenario 16: overlapping edits', () => {
	it('edit in Obsidian: writes markers, pauses, resolves and propagates', async () => {
		const w = threeWayWorld(BODY.replace('alpha', 'vault-alpha'), BODY.replace('alpha', 'claude-alpha'));
		const r = new StubResolver(async (req) => {
			await writeConflictFiles(w.cfg, req);
			return { kind: 'pending' };
		});
		await runSync(w.cfg, r);
		const conflictPath = join(w.hub, 's', 'SKILL.conflict.md');
		const text = w.tree('vault')['s/SKILL.conflict.md'] ?? '';
		expect(text).toContain('<<<<<<< vault');
		expect(text).toContain('||||||| base (codex');
		expect(text).toContain('>>>>>>> claude');
		expect(readMeta(w.tree('vault')['s/SKILL.md'] ?? '', 'agent-').conflict).toBe(true);

		const paused = new StubResolver();
		await runSync(w.cfg, paused);
		expect(paused.requests).toHaveLength(0);
		expect(await resolveConflictFiles(w.cfg, 's')).toBe('markers');

		const resolved = skillMd('s', BODY.replace('alpha', 'agreed-alpha'));
		writeFileSync(conflictPath, resolved);
		expect(await resolveConflictFiles(w.cfg, 's')).toBe('ok');
		expect(existsSync(conflictPath)).toBe(false);
		expect(w.tree('claude')['s/SKILL.md']).toBe(resolved);
		expect(w.tree('codex')['s/SKILL.md']).toBe(resolved);
		expect(readMeta(w.tree('vault')['s/SKILL.md'] ?? '', 'agent-').conflict).toBe(false);
	});

	it('external tool: result file is applied', async () => {
		const w = threeWayWorld(BODY.replace('alpha', 'vault-alpha'), BODY.replace('alpha', 'claude-alpha'));
		const r = new StubResolver(async (req) => (await resolveWithExternalTool(req, 'cp {theirs} {result}')) ?? { kind: 'skip' });
		await runSync(w.cfg, r);
		const theirs = skillMd('s', BODY.replace('alpha', 'claude-alpha'));
		expect(w.tree('codex')['s/SKILL.md']).toBe(theirs);
		expect(w.tree('vault')['s/SKILL.md']).toContain('claude-alpha');
	});
});
