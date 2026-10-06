import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { Executor } from './executor';
import { conflictLabels, hasMarkers, mergeSkill } from './merge';
import type { SyncConfig } from './model';
import { isBinary } from './normalize';
import { conflictName, conflictTarget, listConflictFiles, toBytes } from './scan';
import type { ConflictRequest } from './sync';
import { loadGroups } from './sync';

/**
 * Write cleanly merged files into the vault skill and one conflict file (diff3 markers) per
 * conflicting text file. Marks the skill with <prefix>conflict: true. Sync skips the skill
 * while conflict files exist.
 */
export async function writeConflictFiles(cfg: SyncConfig, req: ConflictRequest): Promise<string[]> {
	const { group: g, conflict: c } = req;
	const ours = c.ours ?? g.vault?.copy;
	const theirs = c.theirs[0];
	if (!g.vault || !ours || !theirs) throw new Error('Editing in Obsidian needs a vault version and an agent version');
	const m = mergeSkill(ours, c.base, theirs, conflictLabels(c, req.labels));
	const ex = new Executor(cfg);
	const clean = new Map(ours.files);
	for (const rel of [...clean.keys()]) if (!m.files.has(rel)) clean.delete(rel);
	for (const [rel, data] of m.files) if (!m.conflicted.includes(rel)) clean.set(rel, data);
	await ex.writeVault(g.name, clean, { ...g.vault.meta, conflict: true }, g.vault.rawSkillMd);
	const written: string[] = [];
	for (const rel of m.conflicted) {
		const data = m.files.get(rel);
		if (!data || isBinary(data)) continue;
		const p = join(ex.vaultDir(g.name), conflictName(rel));
		await fsp.mkdir(dirname(p), { recursive: true });
		await fsp.writeFile(p, data);
		written.push(p);
	}
	return written;
}

/** Apply edited conflict files once no markers remain, push to all true agents, delete them. */
export async function resolveConflictFiles(cfg: SyncConfig, name: string): Promise<'ok' | 'markers' | 'none'> {
	const dir = join(cfg.hubDir, name);
	const conflicts = await listConflictFiles(dir);
	if (conflicts.length === 0) return 'none';
	const texts = new Map<string, Uint8Array>();
	for (const rel of conflicts) {
		const t = await fsp.readFile(join(dir, rel), 'utf8');
		if (hasMarkers(t)) return 'markers';
		texts.set(conflictTarget(rel), toBytes(t));
	}
	const g = (await loadGroups(cfg)).find((x) => x.name === name);
	if (!g?.vault) return 'none';
	const files = new Map(g.vault.copy.files);
	for (const [rel, d] of texts) files.set(rel, d);
	await new Executor(cfg).applyToVault(g, files, { conflict: false });
	for (const rel of conflicts) await fsp.rm(join(dir, rel), { force: true });
	return 'ok';
}
