import { promises as fsp } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import type { Action } from './engine';
import { emptyMeta, setMeta, toVaultText } from './frontmatter';
import type { AgentConfig, AgentState, PluginMeta, SkillCopy, SkillGroup, SyncConfig } from './model';
import { contentKey, exists, readSkillDir, sameBytes, toBytes, toText } from './scan';

export function assertInside(child: string, root: string): void {
	const rel = relative(resolve(root), resolve(child));
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(`Refusing to modify ${child}: not inside ${root}`);
	}
}

async function pruneEmptyDirs(dir: string): Promise<void> {
	for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue;
		const p = join(dir, ent.name);
		await pruneEmptyDirs(p);
		if ((await fsp.readdir(p)).length === 0) await fsp.rmdir(p);
	}
}

export class Executor {
	constructor(private readonly cfg: SyncConfig) {}

	get order(): string[] {
		return this.cfg.agents.map((a) => a.id);
	}

	agent(id: string): AgentConfig {
		const a = this.cfg.agents.find((x) => x.id === id);
		if (!a) throw new Error(`Unknown agent ${id}`);
		return a;
	}

	vaultDir(name: string): string {
		return join(this.cfg.hubDir, name);
	}

	agentTarget(a: AgentConfig, folder: string, path: string): string {
		return a.layout === 'nested' && path ? join(a.path, ...path.split('/'), folder) : join(a.path, folder);
	}

	/** Make dir contain exactly `files` (conflict files and OS junk are left alone). Only rewrites changed files. */
	async syncDir(dir: string, files: Map<string, Uint8Array>, root: string): Promise<void> {
		assertInside(dir, root);
		const st = await fsp.lstat(dir).catch(() => null);
		if (st?.isSymbolicLink()) throw new Error(`${dir} is a symlink; run the symlink migration first`);
		const current = st ? (await readSkillDir(dir)).files : new Map<string, Uint8Array>();
		for (const rel of current.keys()) if (!files.has(rel)) await fsp.rm(join(dir, rel), { force: true });
		for (const [rel, data] of files) {
			const old = current.get(rel);
			if (old && sameBytes(old, data)) continue;
			const p = join(dir, rel);
			await fsp.mkdir(dirname(p), { recursive: true });
			await fsp.writeFile(p, data);
		}
		await pruneEmptyDirs(dir);
	}

	/** Write agent-form files as the vault version (SKILL.md converted with toVaultText). */
	async writeVault(name: string, files: Map<string, Uint8Array>, meta: PluginMeta, existingRaw: string | null): Promise<void> {
		const agentText = toText(files.get('SKILL.md') ?? toBytes(''));
		const out = new Map(files);
		out.set('SKILL.md', toBytes(toVaultText(agentText, existingRaw, this.cfg.prefix, meta, this.order)));
		await this.syncDir(this.vaultDir(name), out, this.cfg.hubDir);
	}

	async importSkill(name: string, files: Map<string, Uint8Array>, states: Record<string, AgentState>, path: string, folder: string): Promise<void> {
		await this.writeVault(name, files, { ...emptyMeta(), states, path, folder }, null);
	}

	async pushFiles(g: SkillGroup, agentId: string, files: Map<string, Uint8Array>): Promise<void> {
		const a = this.agent(agentId);
		if (!(await exists(a.path))) return;
		const existing = g.copies.find((c) => c.owner === agentId && !c.archived);
		const dir = existing?.dir ?? this.agentTarget(a, g.vault?.meta.folder || g.name, g.vault?.meta.path ?? '');
		await this.syncDir(dir, files, a.path);
	}

	/** Make `files` the vault version and push it to every `true` agent that differs. */
	async applyToVault(g: SkillGroup, files: Map<string, Uint8Array>, patch: Partial<PluginMeta> = {}): Promise<void> {
		const v = g.vault;
		if (!v) throw new Error(`${g.name} has no vault version`);
		const meta = { ...v.meta, ...patch };
		await this.writeVault(g.name, files, meta, v.rawSkillMd);
		const key = contentKey(files);
		for (const a of this.cfg.agents) {
			if (meta.states[a.id] !== true) continue;
			const c = g.copies.find((x) => x.owner === a.id && !x.archived);
			if (c && c.key === key) continue;
			await this.pushFiles(g, a.id, files);
		}
	}

	async patchMeta(g: SkillGroup, patch: Partial<PluginMeta>): Promise<void> {
		const v = g.vault;
		if (!v) return;
		const meta: PluginMeta = { ...v.meta, ...patch, states: { ...v.meta.states, ...(patch.states ?? {}) } };
		const raw = setMeta(v.rawSkillMd, meta, this.cfg.prefix, this.order);
		if (raw !== v.rawSkillMd) await fsp.writeFile(join(this.vaultDir(g.name), 'SKILL.md'), raw);
		v.meta = meta;
		v.rawSkillMd = raw;
	}

	async remove(copy: SkillCopy): Promise<void> {
		const a = this.agent(copy.owner);
		assertInside(copy.dir, a.path);
		await fsp.rm(copy.dir, { recursive: true, force: true });
	}

	async move(copy: SkillCopy, toDir: string): Promise<void> {
		const a = this.agent(copy.owner);
		assertInside(copy.dir, a.path);
		assertInside(toDir, a.path);
		await fsp.rm(toDir, { recursive: true, force: true });
		await fsp.mkdir(dirname(toDir), { recursive: true });
		await fsp.rename(copy.dir, toDir);
	}

	async archive(copy: SkillCopy): Promise<void> {
		const a = this.agent(copy.owner);
		if (!a.archiveDir) return this.remove(copy);
		await this.move(copy, join(a.path, a.archiveDir, copy.folder));
	}

	async unarchive(g: SkillGroup, copy: SkillCopy): Promise<void> {
		await this.remove(copy);
		if (g.vault) await this.pushFiles({ ...g, copies: g.copies.filter((c) => c !== copy) }, copy.owner, g.vault.copy.files);
	}

	async apply(action: Action): Promise<void> {
		const g = action.group;
		switch (action.type) {
			case 'import':
				return this.importSkill(g.name, action.from.files, action.states, action.path, action.folder);
			case 'push':
				if (g.vault) await this.pushFiles(g, action.agent, g.vault.copy.files);
				return;
			case 'pull':
				return this.applyToVault(g, action.from.files);
			case 'delete':
				return this.remove(action.copy);
			case 'archive':
				return this.archive(action.copy);
			case 'unarchive':
				return this.unarchive(g, action.copy);
			case 'setStates':
				return this.patchMeta(g, { states: action.states });
			case 'conflict':
				return;
		}
	}
}
