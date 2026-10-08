import { diffLines } from 'diff';
import { mergeDiff3 } from 'node-diff3';
import type { Conflict } from './engine';
import type { SkillCopy } from './model';
import { isBinary, normalizeText } from './normalize';
import { fileKey, toBytes, toText } from './scan';

export interface MergeLabels {
	ours: string;
	base: string;
	theirs: string;
}

const MARKER_RE = /^(?:<{7}|>{7}|\|{7})(?: |$)/m;

export function hasMarkers(text: string): boolean {
	return MARKER_RE.test(text);
}

const lines = (s: string): string[] => s.replace(/\r\n?/g, '\n').split('\n');

export function mergeText(ours: string, base: string | null, theirs: string, labels: MergeLabels): { clean: boolean; text: string } {
	const eol = ours.includes('\r\n') ? '\r\n' : '\n';
	if (normalizeText(ours) === normalizeText(theirs)) return { clean: true, text: ours };
	if (base === null) {
		return {
			clean: false,
			text: [`<<<<<<< ${labels.ours}`, ...lines(ours), '=======', ...lines(theirs), `>>>>>>> ${labels.theirs}`].join(eol),
		};
	}
	const r = mergeDiff3(lines(ours), lines(base), lines(theirs), { label: { a: labels.ours, o: labels.base, b: labels.theirs } });
	return { clean: !r.conflict, text: r.result.join(eol) };
}

export function mergeSkill(
	ours: SkillCopy, base: SkillCopy | undefined, theirs: SkillCopy, labels: MergeLabels,
): { clean: boolean; files: Map<string, Uint8Array>; conflicted: string[] } {
	const files = new Map<string, Uint8Array>();
	const conflicted: string[] = [];
	const rels = new Set([...ours.files.keys(), ...theirs.files.keys(), ...(base ? [...base.files.keys()] : [])]);
	const key = (rel: string, d: Uint8Array | undefined): string | null => (d ? fileKey(rel, d) : null);
	for (const rel of [...rels].sort()) {
		const o = ours.files.get(rel);
		const t = theirs.files.get(rel);
		const b = base?.files.get(rel);
		const ko = key(rel, o);
		const kt = key(rel, t);
		const kb = key(rel, b);
		if (ko === kt) {
			if (o) files.set(rel, o);
			continue;
		}
		if (base && kb === ko) {
			if (t) files.set(rel, t);
			continue;
		}
		if (base && kb === kt) {
			if (o) files.set(rel, o);
			continue;
		}
		if (o && t && !isBinary(o) && !isBinary(t) && !(b && isBinary(b))) {
			const m = mergeText(toText(o), base && b ? toText(b) : null, toText(t), labels);
			files.set(rel, toBytes(m.text));
			if (!m.clean) conflicted.push(rel);
			continue;
		}
		conflicted.push(rel);
		if (o) files.set(rel, o);
	}
	return { clean: conflicted.length === 0, files, conflicted };
}

const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export function conflictLabels(c: Conflict, names: Record<string, string>): MergeLabels {
	const t = c.theirs[0];
	return {
		ours: 'vault',
		base: c.base ? `base (${names[c.base.owner] ?? c.base.owner}, ${fmt(c.base.mtimeMs)})` : 'base',
		theirs: t ? `${names[t.owner] ?? t.owner} (${fmt(t.mtimeMs)})` : 'agent',
	};
}

/**
 * How alike two texts are, from 0 (nothing in common) to 1 (same lines), ignoring formatting noise.
 * Used to warn when two "versions" are probably different skills sharing a name.
 */
export function textSimilarity(a: string, b: string): number {
	const na = normalizeText(a);
	const nb = normalizeText(b);
	if (na === nb) return 1;
	const total = (na ? na.split('\n').length : 0) + (nb ? nb.split('\n').length : 0);
	if (total === 0) return 1;
	const same = diffLines(na, nb).filter((p) => !p.added && !p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
	return (2 * same) / total;
}
