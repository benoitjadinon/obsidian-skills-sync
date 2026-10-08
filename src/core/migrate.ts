import { promises as fsp } from 'fs';
import { basename, isAbsolute, relative } from 'path';
import { assertInside, Executor } from './executor';
import type { SyncConfig } from './model';
import { readSkillDir, scanAgent, scanVault } from './scan';
import type { MigrationItem } from './sync';
import { liveConfig } from './sync';

export async function findSymlinks(cfg: SyncConfig): Promise<MigrationItem[]> {
	const live = await liveConfig(cfg);
	const hubReal = await fsp.realpath(cfg.hubDir).catch(() => cfg.hubDir);
	const items: MigrationItem[] = [];
	for (const a of live.agents) {
		for (const c of await scanAgent(a)) {
			if (!c.symlinkTarget) continue;
			const rel = relative(hubReal, c.symlinkTarget);
			const insideHub = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
			items.push({ agent: a.id, linkPath: c.dir, target: c.symlinkTarget, insideHub, folder: basename(c.symlinkTarget) });
		}
	}
	return items;
}

/**
 * Replace each symlinked skill folder by a real copy. Each link is checked again right before:
 * one that is no longer a symlink (replaced meanwhile) is skipped. A failure on one link is
 * returned and the others are still migrated.
 */
export async function migrate(cfg: SyncConfig, items: MigrationItem[]): Promise<string[]> {
	const vault = await scanVault(cfg);
	const ex = new Executor(cfg);
	const errors: string[] = [];
	for (const it of items) {
		try {
			const st = await fsp.lstat(it.linkPath).catch(() => null);
			if (!st?.isSymbolicLink()) continue;
			const v = it.insideHub ? vault.find((x) => x.name === it.folder) : undefined;
			const files = v ? v.copy.files : (await readSkillDir(it.target)).files;
			const a = ex.agent(it.agent);
			assertInside(it.linkPath, a.path);
			await fsp.unlink(it.linkPath);
			await ex.syncDir(it.linkPath, files, a.path);
			if (v) await ex.patchMeta({ name: v.name, vault: v, copies: [] }, { states: { [it.agent]: true } });
		} catch (e) {
			errors.push(`${it.linkPath}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return errors;
}
