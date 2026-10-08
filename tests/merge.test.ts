import { describe, expect, it } from 'vitest';
import { hasMarkers, mergeSkill, mergeText } from '../src/core/merge';
import type { SkillCopy } from '../src/core/model';
import { contentKey, toBytes } from '../src/core/scan';

const L = { ours: 'vault', base: 'base', theirs: 'claude' };
const copy = (owner: string, files: Record<string, string | Uint8Array>): SkillCopy => {
	const m = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? toBytes(v) : v]));
	return { owner, dir: `/${owner}`, folder: 'x', relPath: '', archived: false, files: m, mtimeMs: 0, key: contentKey(m) };
};

describe('mergeText', () => {
	const base = '# S\n\n## A\nalpha\n\n## B\nbeta\n';
	it('merges non-overlapping edits cleanly', () => {
		const r = mergeText(base.replace('alpha', 'ALPHA'), base, base.replace('beta', 'BETA'), L);
		expect(r.clean).toBe(true);
		expect(r.text).toBe('# S\n\n## A\nALPHA\n\n## B\nBETA\n');
	});
	it('emits diff3 markers with labels for overlapping edits', () => {
		const r = mergeText(base.replace('alpha', 'one'), base, base.replace('alpha', 'two'), L);
		expect(r.clean).toBe(false);
		expect(r.text).toContain('<<<<<<< vault\none\n||||||| base\nalpha\n=======\ntwo\n>>>>>>> claude');
	});
	it('without base: whole-file markers, or clean when equal after normalization', () => {
		expect(mergeText('a\n', null, 'b\n', L).text).toBe('<<<<<<< vault\na\n\n=======\nb\n\n>>>>>>> claude');
		expect(mergeText('a\r\n', null, 'a', L).clean).toBe(true);
	});
});

describe('hasMarkers', () => {
	it('detects conflict markers but not setext headings', () => {
		expect(hasMarkers('x\n<<<<<<< vault\n')).toBe(true);
		expect(hasMarkers('Title\n=======\n')).toBe(false);
	});
});

describe('mergeSkill', () => {
	it('takes one-sided changes, additions and merges SKILL.md', () => {
		const base = copy('codex', { 'SKILL.md': 'a\nb\nc\n', 'old.md': 'o' });
		const ours = copy('vault', { 'SKILL.md': 'A\nb\nc\n', 'old.md': 'o' });
		const theirs = copy('claude', { 'SKILL.md': 'a\nb\nC\n', 'new.md': 'n' });
		const m = mergeSkill(ours, base, theirs, L);
		expect(m.clean).toBe(true);
		expect(new TextDecoder().decode(m.files.get('SKILL.md'))).toBe('A\nb\nC\n');
		expect(m.files.has('new.md')).toBe(true);
		expect(m.files.has('old.md')).toBe(false);
	});
	it('flags binary files changed on both sides', () => {
		const base = copy('codex', { 'i.png': new Uint8Array([0, 1]) });
		const m = mergeSkill(copy('vault', { 'i.png': new Uint8Array([0, 2]) }), base, copy('claude', { 'i.png': new Uint8Array([0, 3]) }), L);
		expect(m.conflicted).toEqual(['i.png']);
	});
});

describe('textSimilarity', () => {
	it('is 1 for equal texts, low for unrelated ones', async () => {
		const { textSimilarity } = await import('../src/core/merge');
		const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
		expect(textSimilarity(a, a)).toBe(1);
		expect(textSimilarity(a, a.replace('line 3', 'LINE 3'))).toBeGreaterThan(0.9);
		expect(textSimilarity(a, Array.from({ length: 300 }, (_, i) => `other ${i}`).join('\n'))).toBeLessThan(0.1);
		expect(textSimilarity('', '')).toBe(1);
	});
});

describe('dates in conflict labels', () => {
	it('use local time, not UTC', async () => {
		const { formatLocal } = await import('../src/core/merge');
		const d = new Date(2026, 9, 9, 7, 5); // 9 Oct 2026, 07:05 local
		expect(formatLocal(d.getTime())).toBe('2026-10-09 07:05');
	});
});
