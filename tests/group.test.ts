import { describe, expect, it } from 'vitest';
import { groupSkills } from '../src/core/group';
import { emptyMeta } from '../src/core/frontmatter';
import type { PluginMeta, SkillCopy, VaultSkill } from '../src/core/model';

const copy = (owner: string, folder: string, key: string, relPath = '', archived = false): SkillCopy => ({
	owner, folder, key, relPath, archived, dir: `/${owner}/${relPath}/${folder}`, files: new Map(), mtimeMs: 0,
});
const vault = (name: string, meta: Partial<PluginMeta> = {}): VaultSkill => ({
	name, rawSkillMd: '', hasConflictFile: false, meta: { ...emptyMeta(), ...meta }, copy: copy('vault', name, 'v'),
});

describe('groupSkills', () => {
	it('attaches agent copies to the vault skill with the same folder name', () => {
		const gs = groupSkills([vault('plan')], [copy('claude', 'plan', 'k'), copy('hermes', 'plan', 'k', 'software-development')]);
		expect(gs).toHaveLength(1);
		expect(gs[0]?.copies.map((c) => c.owner)).toEqual(['claude', 'hermes']);
	});

	it('groups same-name copies from different agents for import, even when they differ', () => {
		const gs = groupSkills([], [copy('claude', 'plan', 'k1'), copy('codex', 'plan', 'k2')]);
		expect(gs).toHaveLength(1);
		expect(gs[0]?.name).toBe('plan');
	});

	it('drops identical duplicates inside the same agent', () => {
		const gs = groupSkills([], [copy('hermes', 'plan', 'k', 'a'), copy('hermes', 'plan', 'k', 'b')]);
		expect(gs).toHaveLength(1);
		expect(gs[0]?.copies).toHaveLength(1);
	});

	it('splits different same-name skills inside the same agent with a path-qualified name', () => {
		const gs = groupSkills([], [copy('hermes', 'plan', 'k1', 'a'), copy('hermes', 'plan', 'k2', 'b')]);
		const names = gs.map((g) => g.name).sort();
		expect(names).toEqual(['b-plan', 'plan']);
		const split = gs.find((g) => g.name === 'b-plan');
		expect(split?.newFolder).toBe('plan');
		expect(split?.newPath).toBe('b');
	});

	it('matches previously split vault skills by folder + path', () => {
		const gs = groupSkills(
			[vault('plan', { path: 'a' }), vault('b-plan', { path: 'b', folder: 'plan' })],
			[copy('hermes', 'plan', 'k1', 'a'), copy('hermes', 'plan', 'k2', 'b')],
		);
		expect(gs.find((g) => g.name === 'plan')?.copies[0]?.relPath).toBe('a');
		expect(gs.find((g) => g.name === 'b-plan')?.copies[0]?.relPath).toBe('b');
	});

	it('keeps an archived copy next to an active copy of the same agent', () => {
		const gs = groupSkills([], [copy('hermes', 'x', 'k1'), copy('hermes', 'x', 'k2', '', true)]);
		expect(gs).toHaveLength(1);
		expect(gs[0]?.copies).toHaveLength(2);
	});
});
