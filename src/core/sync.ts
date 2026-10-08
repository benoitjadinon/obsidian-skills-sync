import { promises as fsp } from 'fs';
import { join } from 'path';
import type { Action, Conflict } from './engine';
import { importPath, importStates, planGroup, sourcesOf } from './engine';
import { stateKeys } from './projects';
import { Executor } from './executor';
import { newSkillText, setMeta } from './frontmatter';
import { groupSkills, uniqueName } from './group';
import { findSymlinks, migrate } from './migrate';
import type { AgentState, SkillCopy, SkillGroup, SyncConfig } from './model';
import { VAULT } from './model';
import { exists, scanAgent, scanVault } from './scan';
import { validateSkillName } from './validate';

export interface ConflictRequest {
	group: SkillGroup;
	conflict: Conflict;
	/** owner id → display label ('vault' included). */
	labels: Record<string, string>;
}

export type Resolution =
	| { kind: 'apply'; files: Map<string, Uint8Array> }
	| { kind: 'skip' }
	| { kind: 'pending' }
	| { kind: 'split' }
	| { kind: 'adoptPath' }
	| { kind: 'keepPath' };

export interface MigrationItem {
	agent: string;
	linkPath: string;
	target: string;
	insideHub: boolean;
	folder: string;
}

export interface Resolver {
	resolve(req: ConflictRequest): Promise<Resolution>;
	confirmMigration(items: MigrationItem[]): Promise<boolean>;
	/** Move a vault skill folder to Obsidian's trash (optional; otherwise it goes to the trash folder). */
	trashVaultSkill?(name: string): Promise<void>;
}

export interface SyncReport {
	applied: Action[];
	conflicts: number;
	errors: string[];
	/** Skills deleted from the Delete column during this run. */
	deleted: string[];
	/** Agent copies moved to the trash folder. */
	trashedCopies: number;
	/** This run's trash folder for agent copies. */
	trashFolder: string;
}

export function labelsFor(cfg: SyncConfig): Record<string, string> {
	return { [VAULT]: 'Vault', ...Object.fromEntries(cfg.agents.map((a) => [a.id, a.label])) };
}

export async function liveConfig(cfg: SyncConfig): Promise<SyncConfig> {
	const agents = [];
	for (const a of cfg.agents) if (await exists(a.createIn ?? a.path)) agents.push(a);
	return { ...cfg, agents };
}

export async function loadGroups(cfg: SyncConfig): Promise<SkillGroup[]> {
	const live = await liveConfig(cfg);
	const vault = await scanVault(cfg);
	const copies = (await Promise.all(live.agents.map((a) => scanAgent(a)))).flat().filter((c) => !c.symlinkTarget);
	return groupSkills(vault, copies);
}

export async function applyResolution(ex: Executor, g: SkillGroup, c: Conflict, r: Resolution, cfg: SyncConfig): Promise<void> {
	switch (r.kind) {
		case 'pending':
			return;
		case 'skip':
			if (g.vault) await ex.patchMeta(g, { conflict: true });
			return;
		case 'apply': {
			if (c.kind === 'import') {
				const states = importStates(cfg, Object.values(c.owners).flat().filter((o) => o !== VAULT));
				const sources = sourcesOf(g.copies.map((x) => x.owner), cfg);
				await ex.importSkill(g.name, r.files, states, importPath(g, c.theirs, cfg), g.newFolder ?? '', sources);
				return;
			}
			await ex.applyToVault(g, r.files, { conflict: false });
			const target = c.theirs[0];
			if (c.kind === 'delete' && target) await ex.archive(target);
			return;
		}
		case 'split': {
			const taken = new Set((await scanVault(cfg)).map((v) => v.name));
			for (const t of c.theirs) {
				const name = uniqueName(`${t.owner}-${g.name}`, taken);
				taken.add(name);
				const states = importStates(cfg, (c.owners[t.key] ?? []).filter((o) => o !== VAULT));
				await ex.importSkill(name, t.files, states, t.relPath, t.folder, sourcesOf(c.owners[t.key] ?? [], cfg));
			}
			if (g.vault) {
				const moved = c.theirs.flatMap((t) => (c.owners[t.key] ?? []).filter((o) => o !== VAULT));
				await ex.patchMeta(g, { states: Object.fromEntries(moved.map((o) => [o, null])), conflict: false });
			}
			return;
		}
		case 'adoptPath': {
			const t = c.theirs[0];
			if (t) await ex.patchMeta(g, { path: t.relPath });
			return;
		}
		case 'keepPath': {
			const t = c.theirs[0];
			if (t && g.vault) await ex.move(t, ex.agentTarget(ex.agent(t.owner), g.vault.meta.folder || g.name, g.vault.meta.path));
			return;
		}
	}
}

export async function runSync(cfg: SyncConfig, resolver: Resolver): Promise<SyncReport> {
	const report: SyncReport = { applied: [], conflicts: 0, errors: [], deleted: [], trashedCopies: 0, trashFolder: '' };
	const links = await findSymlinks(cfg);
	if (links.length > 0 && (await resolver.confirmMigration(links))) await migrate(cfg, links);
	const live = await liveConfig(cfg);
	const ex = new Executor(cfg, resolver.trashVaultSkill?.bind(resolver));
	const labels = labelsFor(cfg);
	for (const g of await loadGroups(cfg)) {
		try {
			for (const action of planGroup(g, live)) {
				if (action.type === 'conflict') {
					report.conflicts++;
					const r = await resolver.resolve({ group: g, conflict: action.conflict, labels });
					await applyResolution(ex, g, action.conflict, r, cfg);
				} else {
					await ex.apply(action);
					if (action.type === 'deleteSkill') report.deleted.push(g.name);
				}
				report.applied.push(action);
			}
		} catch (e) {
			report.errors.push(`${g.name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	for (const l of await findSymlinks(cfg)) {
		report.errors.push(`${l.linkPath}: skill folder is a symlink; accept the migration to sync it`);
	}
	report.trashedCopies = ex.trashed;
	report.trashFolder = ex.trashFolder();
	return report;
}

export function validSkillName(name: string): boolean {
	return validateSkillName(name, []) === null;
}

export async function createSkill(cfg: SyncConfig, name: string, description: string): Promise<string> {
	if (!validSkillName(name)) throw new Error(`Invalid skill name "${name}"`);
	const dir = join(cfg.hubDir, name);
	if (await exists(dir)) throw new Error(`A skill named "${name}" already exists`);
	await fsp.mkdir(dir, { recursive: true });
	const path = join(dir, 'SKILL.md');
	await fsp.writeFile(path, newSkillText(name, description, cfg.prefix, stateKeys(cfg.agents)));
	return path;
}

export async function findAgentCopies(cfg: SyncConfig, folder: string): Promise<SkillCopy[]> {
	const live = await liveConfig(cfg);
	const all = (await Promise.all(live.agents.map((a) => scanAgent(a)))).flat();
	return all.filter((c) => !c.archived && !c.symlinkTarget && c.folder === folder);
}

export async function removeFromAgents(cfg: SyncConfig, folder: string): Promise<string[]> {
	const ex = new Executor(cfg);
	const removed: string[] = [];
	for (const c of await findAgentCopies(cfg, folder)) {
		await ex.remove(c);
		removed.push(c.dir);
	}
	return removed;
}

export async function deleteEverywhere(cfg: SyncConfig, name: string): Promise<string[]> {
	const g = (await loadGroups(cfg)).find((x) => x.name === name);
	if (!g) return [];
	const ex = new Executor(cfg);
	const removed: string[] = [];
	for (const c of g.copies) {
		if (c.archived) continue;
		await ex.remove(c);
		removed.push(c.dir);
	}
	if (g.vault) {
		await fsp.rm(g.vault.copy.dir, { recursive: true, force: true });
		removed.push(g.vault.copy.dir);
	}
	return removed;
}

/**
 * Backfill agent-source for notes that do not have it yet (skills imported before the property
 * existed): records the agents currently holding a copy, archived copies included.
 */
export async function fillMissingSources(cfg: SyncConfig): Promise<string[]> {
	const live = await liveConfig(cfg);
	const ex = new Executor(cfg);
	const changed: string[] = [];
	for (const g of await loadGroups(cfg)) {
		if (!g.vault || g.vault.meta.sources !== null) continue;
		await ex.patchMeta(g, { sources: sourcesOf(g.copies.map((c) => c.owner), live) });
		changed.push(g.name);
	}
	return changed;
}

/**
 * Delete the `<prefix><agentId>` property from every skill note (after the agent was removed from
 * settings; `cfg` lists the remaining agents). Agent folders are not touched. Returns changed skills.
 */
export async function removeAgentFromNotes(cfg: SyncConfig, agentId: string): Promise<string[]> {
	const order = stateKeys(cfg.agents).filter((id) => id !== agentId);
	const changed: string[] = [];
	for (const v of await scanVault(cfg)) {
		if (!(agentId in v.meta.states)) continue;
		const states = { ...v.meta.states };
		delete states[agentId];
		const raw = setMeta(v.rawSkillMd, { ...v.meta, states }, cfg.prefix, order);
		await fsp.writeFile(join(v.copy.dir, 'SKILL.md'), raw);
		changed.push(v.name);
	}
	return changed;
}

/** Rewrite every skill note's checkbox states (e.g. after switching a project's columns). Returns changed skills. */
export async function rewriteStates(
	cfg: SyncConfig,
	fn: (states: Record<string, AgentState>) => Record<string, AgentState>,
): Promise<string[]> {
	const order = stateKeys(cfg.agents);
	const changed: string[] = [];
	for (const v of await scanVault(cfg)) {
		const states = fn({ ...v.meta.states });
		const raw = setMeta(v.rawSkillMd, { ...v.meta, states }, cfg.prefix, order);
		if (raw === v.rawSkillMd) continue;
		await fsp.writeFile(join(v.copy.dir, 'SKILL.md'), raw);
		changed.push(v.name);
	}
	return changed;
}

/**
 * "Tick the skills it already has" for an agent added earlier: clear its undecided (empty) property
 * on skills it holds, so the next sync adopts them like for a newly added agent. Explicit choices
 * (true/false) are kept. Returns the skills whose property was cleared.
 */
export async function resetUndecided(cfg: SyncConfig, agentId: string): Promise<string[]> {
	const live = await liveConfig(cfg);
	const owners = new Set(live.agents.filter((a) => (a.stateKey ?? a.id) === agentId).map((a) => a.id));
	const cleared: string[] = [];
	for (const g of await loadGroups(cfg)) {
		const v = g.vault;
		if (!v || v.meta.states[agentId] !== null || !(agentId in v.meta.states)) continue;
		if (!g.copies.some((c) => owners.has(c.owner) && !c.archived)) continue;
		const key = `${cfg.prefix}${agentId}`;
		const raw = v.rawSkillMd
			.split(/(?<=\n)/)
			.filter((line) => !new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(null|~)?\\s*$`).test(line.replace(/\r?\n$/, '')))
			.join('');
		if (raw === v.rawSkillMd) continue;
		await fsp.writeFile(join(v.copy.dir, 'SKILL.md'), raw);
		cleared.push(v.name);
	}
	return cleared;
}
