import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { planGroup } from '../../src/core/engine';
import { readMeta, renderMeta, emptyMeta } from '../../src/core/frontmatter';
import { runSync } from '../../src/core/sync';
import { T0, T1, skillMd, tree } from '../helpers';
import { StubResolver, world } from './harness';

const delWorld = () => {
	const w = world([{ id: 'claude' }, { id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
	const trashDir = join(w.root, 'trash');
	return { w, trashDir, cfg: { ...w.cfg, trashDir } };
};

describe('agent-delete property', () => {
	it('is read, and written only when true', () => {
		expect(readMeta('---\nagent-delete: true\n---\n', 'agent-').delete).toBe(true);
		expect(readMeta('---\nname: x\n---\n', 'agent-').delete).toBe(false);
		expect(renderMeta({ ...emptyMeta(), delete: true }, 'agent-', '\n', [])).toContain('agent-delete: true\n');
		expect(renderMeta(emptyMeta(), 'agent-', '\n', [])).not.toContain('agent-delete');
	});
});

describe('Delete on next sync', () => {
	it('moves every agent copy (archived too) to the trash folder and the vault note to the trash', async () => {
		const { w, trashDir, cfg } = delWorld();
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), { claude: true, hermes: false }).replace('agent-skill-keys', 'agent-delete: true\nagent-skill-keys'), 'keep/SKILL.md': w.vaultMd(skillMd('keep'), { claude: true }) }, T0);
		w.put('claude', { 'x/SKILL.md': skillMd('x'), 'keep/SKILL.md': skillMd('keep') }, T0);
		w.put('hermes', { 'tools/x/SKILL.md': skillMd('x'), '.archive/x/SKILL.md': skillMd('x') }, T0);
		const trashed: string[] = [];
		const r = new StubResolver();
		r.trashVaultSkill = async (name: string) => void trashed.push(name);
		const report = await runSync(cfg, r);
		expect(report.deleted).toEqual(['x']);
		expect(trashed).toEqual(['x']);
		expect(w.tree('claude')).toEqual({ 'keep/SKILL.md': skillMd('keep') });
		expect(Object.keys(w.tree('hermes'))).toEqual([]);
		const day = readdirSync(trashDir)[0] ?? '';
		expect(tree(join(trashDir, day))).toEqual({ 'claude/x/SKILL.md': skillMd('x'), 'hermes/x/SKILL.md': skillMd('x'), 'hermes/x-2/SKILL.md': skillMd('x') });
		expect(report.trashedCopies).toBe(3);
	});

	it('without a vault trash function, the note folder goes to the trash folder too', async () => {
		const { w, trashDir, cfg } = delWorld();
		w.put('vault', { 'x/SKILL.md': w.vaultMd(skillMd('x'), { claude: null }).replace('agent-skill-keys', 'agent-delete: true\nagent-skill-keys') }, T0);
		await runSync(cfg, new StubResolver());
		expect(existsSync(join(w.hub, 'x'))).toBe(false);
		const day = readdirSync(trashDir)[0] ?? '';
		expect(Object.keys(tree(join(trashDir, day)))).toContain('vault/x/SKILL.md');
	});

	it('on another computer, a recently deleted skill is trashed from its agents instead of re-imported', async () => {
		const { w, trashDir, cfg } = delWorld();
		w.put('claude', { 'gone/SKILL.md': skillMd('gone'), 'new/SKILL.md': skillMd('new') }, T0);
		const report = await runSync({ ...cfg, deleted: ['gone'] }, new StubResolver());
		expect(Object.keys(w.tree('vault'))).toEqual(['new/SKILL.md']);
		expect(w.tree('claude')).toEqual({ 'new/SKILL.md': skillMd('new') });
		expect(report.trashedCopies).toBe(1);
		expect(existsSync(trashDir)).toBe(true);
	});

	it('a skill re-created in the vault is not affected by an old deletion', () => {
		const cfg = { hubDir: '/h', prefix: 'agent-', agents: [], autoPullExternal: 'ask' as const, deleted: ['x'] };
		const g = { name: 'x', copies: [], vault: { name: 'x', rawSkillMd: '', hasConflictFile: false, meta: { ...emptyMeta(), folder: 'x' }, copy: { owner: 'vault', dir: '/h/x', folder: 'x', relPath: '', archived: false, files: new Map(), mtimeMs: 0, key: 'k' } } };
		expect(planGroup(g, cfg)).toEqual([]);
	});
});

describe('Resolving modified copy on a disabled agent', () => {
	it('Update vault and enable in agent updates vault, marks agent true, and keeps copy in agent', async () => {
		const w = world([{ id: 'claude' }, { id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
		const v0 = skillMd('x', '# initial vault\n');
		const v1 = skillMd('x', '# updated hermes\n');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v0, { claude: true, hermes: false }) }, T0);
		w.put('claude', { 'x/SKILL.md': v0 }, T0);
		w.put('hermes', { 'tools/x/SKILL.md': v1 }, T1);

		const r = new StubResolver((req) => {
			const t = req.conflict.theirs[0]!;
			return { kind: 'apply', files: t.files, mtimeMs: t.mtimeMs, enableAgent: req.conflict.agent };
		});
		await runSync(w.cfg, r);

		expect(r.requests[0]?.conflict.kind).toBe('delete');
		// Hermes still has the file
		expect(w.tree('hermes')['tools/x/SKILL.md']).toBe(v1);
		// Vault has the update and hermes is now true
		const vaultRaw = w.tree('vault')['x/SKILL.md'] ?? '';
		expect(readMeta(vaultRaw, 'agent-').states).toEqual({ claude: true, hermes: true });
		// Claude also gets the updated version pushed since claude is true
		expect(w.tree('claude')['x/SKILL.md']).toBe(v1);
	});

	it('Update vault but keep disabled in agent updates vault and archives agent copy', async () => {
		const w = world([{ id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
		const v0 = skillMd('x', '# initial vault\n');
		const v1 = skillMd('x', '# updated hermes\n');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v0, { hermes: false }) }, T0);
		w.put('hermes', { 'tools/x/SKILL.md': v1 }, T1);

		const r = new StubResolver((req) => {
			const t = req.conflict.theirs[0]!;
			return { kind: 'apply', files: t.files, mtimeMs: t.mtimeMs };
		});
		await runSync(w.cfg, r);

		expect(r.requests[0]?.conflict.kind).toBe('delete');
		// Hermes copy was moved to .archive
		expect(w.tree('hermes')['tools/x/SKILL.md']).toBeUndefined();
		expect(w.tree('hermes')['.archive/x/SKILL.md']).toBe(v1);
		// Vault has the updated content and hermes remains false
		const vaultRaw = w.tree('vault')['x/SKILL.md'] ?? '';
		expect(readMeta(vaultRaw, 'agent-').states).toEqual({ hermes: false });
	});

	it('Discard from agent removes agent copy and keeps vault unchanged', async () => {
		const w = world([{ id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
		const v0 = skillMd('x', '# initial vault\n');
		const v1 = skillMd('x', '# updated hermes\n');
		w.put('vault', { 'x/SKILL.md': w.vaultMd(v0, { hermes: false }) }, T0);
		w.put('hermes', { 'tools/x/SKILL.md': v1 }, T1);

		const r = new StubResolver((req) => {
			const ours = req.conflict.ours!;
			return { kind: 'apply', files: ours.files, mtimeMs: ours.mtimeMs };
		});
		await runSync(w.cfg, r);

		expect(r.requests[0]?.conflict.kind).toBe('delete');
		// Hermes copy was moved to .archive
		expect(w.tree('hermes')['tools/x/SKILL.md']).toBeUndefined();
		expect(w.tree('hermes')['.archive/x/SKILL.md']).toBe(v1);
		// Vault keeps original content and hermes remains false
		const vaultRaw = w.tree('vault')['x/SKILL.md'] ?? '';
		expect(vaultRaw).toContain('# initial vault\n');
		expect(readMeta(vaultRaw, 'agent-').states).toEqual({ hermes: false });
	});
});
