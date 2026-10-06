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

export async function migrate(cfg: SyncConfig, items: MigrationItem[]): Promise<void> {
	const vault = await scanVault(cfg);
	const ex = new Executor(cfg);
	for (const it of items) {
		const v = it.insideHub ? vault.find((x) => x.name === it.folder) : undefined;
		const files = v ? v.copy.files : (await readSkillDir(it.target)).files;
		const a = ex.agent(it.agent);
		assertInside(it.linkPath, a.path);
		await fsp.unlink(it.linkPath);
		await ex.syncDir(it.linkPath, files, a.path);
		if (v) await ex.patchMeta({ name: v.name, vault: v, copies: [] }, { states: { [it.agent]: true } });
	}
}
