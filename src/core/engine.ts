import type { AgentState, SkillCopy, SkillGroup, SyncConfig } from './model';
import { stateKeys } from './projects';

export type ConflictKind = 'import' | 'diverged' | 'external' | 'delete' | 'path';

export interface Conflict {
	kind: ConflictKind;
	ours?: SkillCopy;
	/** One copy per distinct content, newest first. */
	theirs: SkillCopy[];
	base?: SkillCopy;
	/** content key → owners holding it (including 'vault'). */
	owners: Record<string, string[]>;
	agent?: string;
}

export type Action =
	| { type: 'import'; group: SkillGroup; from: SkillCopy; states: Record<string, AgentState>; path: string; folder: string; sources: string[] }
	| { type: 'push'; group: SkillGroup; agent: string }
	| { type: 'pull'; group: SkillGroup; from: SkillCopy }
	| { type: 'delete'; group: SkillGroup; copy: SkillCopy }
	| { type: 'archive'; group: SkillGroup; copy: SkillCopy }
	| { type: 'unarchive'; group: SkillGroup; copy: SkillCopy }
	| { type: 'setStates'; group: SkillGroup; states: Record<string, AgentState> }
	| { type: 'setPath'; group: SkillGroup; path: string }
	/** Ticked in the Delete column: trash every agent copy and the vault note. */
	| { type: 'deleteSkill'; group: SkillGroup }
	/** Deleted on another computer: trash this computer's agent copies instead of importing them. */
	| { type: 'trashCopies'; group: SkillGroup }
	| { type: 'conflict'; group: SkillGroup; conflict: Conflict };

const newestFirst = (cs: SkillCopy[]): SkillCopy[] => [...cs].sort((a, b) => b.mtimeMs - a.mtimeMs);

function distinct(cs: SkillCopy[]): SkillCopy[] {
	const seen = new Set<string>();
	const out: SkillCopy[] = [];
	for (const c of newestFirst(cs)) {
		if (seen.has(c.key)) continue;
		seen.add(c.key);
		out.push(c);
	}
	return out;
}

function ownersOf(cs: SkillCopy[]): Record<string, string[]> {
	const o: Record<string, string[]> = {};
	for (const c of cs) (o[c.key] ??= []).push(c.owner);
	return o;
}

/** Owners holding any copy (active or archived), in configured agent order. */
export function sourcesOf(owners: Iterable<string>, cfg: SyncConfig): string[] {
	const held = new Set([...owners].map((o) => stateKeyOf(cfg, o)));
	return stateKeys(cfg.agents).filter((k) => held.has(k));
}

/** Checkbox property driving a sync target (project folders share their project's). */
export function stateKeyOf(cfg: SyncConfig, owner: string): string {
	return cfg.agents.find((a) => a.id === owner)?.stateKey ?? owner;
}

/** Checkbox states for a skill imported from these owners (archived owners: false, others: undecided). */
export function importStates(cfg: SyncConfig, owners: string[], archivedOwners: string[] = []): Record<string, AgentState> {
	const states: Record<string, AgentState> = Object.fromEntries(stateKeys(cfg.agents).map((k) => [k, null]));
	for (const o of archivedOwners) states[stateKeyOf(cfg, o)] = false;
	for (const o of owners) states[stateKeyOf(cfg, o)] = true;
	return states;
}

export function importPath(g: SkillGroup, pool: SkillCopy[], cfg: SyncConfig): string {
	if (g.newPath !== undefined) return g.newPath;
	const nested = new Set(cfg.agents.filter((a) => a.layout === 'nested').map((a) => a.id));
	return pool.find((c) => nested.has(c.owner))?.relPath ?? '';
}

function planImport(g: SkillGroup, copies: SkillCopy[], cfg: SyncConfig): Action[] {
	const active = copies.filter((c) => !c.archived);
	const archived = copies.filter((c) => c.archived);
	const pool = active.length > 0 ? active : archived;
	const variants = distinct(pool);
	const from = variants[0];
	if (!from) return [];
	if (variants.length > 1) {
		return [{ type: 'conflict', group: g, conflict: { kind: 'import', theirs: variants, owners: ownersOf(pool) } }];
	}
	const states = importStates(cfg, active.map((c) => c.owner), archived.map((c) => c.owner));
	const sources = sourcesOf(copies.map((c) => c.owner), cfg);
	return [{ type: 'import', group: g, from, states, path: importPath(g, pool, cfg), folder: g.newFolder ?? '', sources }];
}

export function planGroup(g: SkillGroup, cfg: SyncConfig): Action[] {
	const configured = new Set(cfg.agents.map((a) => a.id));
	const copies = g.copies.filter((c) => configured.has(c.owner));
	if (!g.vault) {
		if (copies.length > 0 && cfg.deleted?.includes(g.newFolder ?? g.name)) return [{ type: 'trashCopies', group: g }];
		return planImport(g, copies, cfg);
	}

	const v = g.vault;
	if (v.meta.delete) return [{ type: 'deleteSkill', group: g }];
	if (v.hasConflictFile) return [];
	const actions: Action[] = [];

	// A newly added agent (no property yet) adopts what it already holds: a copy ticks it (asking when
	// the copy differs from the vault), an archived copy unticks it, nothing leaves it undecided.
	const missing = stateKeys(cfg.agents).filter((k) => !(k in v.meta.states));
	if (missing.length > 0) {
		const states: Record<string, AgentState> = {};
		const differing: SkillCopy[] = [];
		for (const k of missing) {
			const owners = new Set(cfg.agents.filter((a) => (a.stateKey ?? a.id) === k).map((a) => a.id));
			const held = copies.filter((c) => owners.has(c.owner));
			const active = held.filter((c) => !c.archived);
			states[k] = active.length > 0 ? true : held.length > 0 ? false : null;
			differing.push(...active.filter((c) => c.key !== v.copy.key));
		}
		actions.push({ type: 'setStates', group: g, states });
		const variants = distinct(differing);
		if (variants.length > 0) {
			actions.push({ type: 'conflict', group: g, conflict: { kind: 'external', ours: v.copy, theirs: variants, owners: ownersOf([v.copy, ...differing]) } });
		}
	}

	const consensus: SkillCopy[] = [];
	for (const a of cfg.agents) {
		const state = v.meta.states[a.stateKey ?? a.id] ?? null;
		const active = copies.find((c) => c.owner === a.id && !c.archived);
		const archived = copies.find((c) => c.owner === a.id && c.archived);
		if (state === false && active) {
			if (active.key === v.copy.key) actions.push({ type: a.archiveDir ? 'archive' : 'delete', group: g, copy: active });
			else {
				actions.push({
					type: 'conflict', group: g,
					conflict: { kind: 'delete', ours: v.copy, theirs: [active], owners: ownersOf([v.copy, active]), agent: a.id },
				});
			}
		} else if (state === true && !active) {
			actions.push(archived ? { type: 'unarchive', group: g, copy: archived } : { type: 'push', group: g, agent: a.id });
		} else if (state === true && active) {
			if (a.layout === 'nested' && active.relPath !== v.meta.path) {
				if (active.key !== v.copy.key && v.meta.path) {
					// Another category *and* other content: likely a different skill sharing the name.
					// Ask (with "Keep as separate skills"); never push over it.
					actions.push({ type: 'conflict', group: g, conflict: { kind: 'diverged', ours: v.copy, theirs: [active], owners: ownersOf([v.copy, active]), agent: a.id } });
					continue;
				}
				// No category recorded yet: take the agent's. Same content elsewhere: ask about the category.
				if (!v.meta.path) actions.push({ type: 'setPath', group: g, path: active.relPath });
				else actions.push({ type: 'conflict', group: g, conflict: { kind: 'path', theirs: [active], owners: ownersOf([active]), agent: a.id } });
			}
			consensus.push(active);
		}
	}

	const changed = consensus.filter((c) => c.key !== v.copy.key);
	if (changed.length === 0) return actions;
	const unchanged = consensus.filter((c) => c.key === v.copy.key);
	const variants = distinct(changed);
	const latest = variants[0];
	if (!latest) return actions;
	const owners = ownersOf([v.copy, ...consensus]);

	if (variants.length === 1 && unchanged.length === 0) {
		// Vault differs, every agent agrees: the newer side wins only when it is the vault.
		if (v.copy.mtimeMs > latest.mtimeMs) for (const c of changed) actions.push({ type: 'push', group: g, agent: c.owner });
		else actions.push({ type: 'conflict', group: g, conflict: { kind: 'diverged', ours: v.copy, theirs: [latest], owners } });
	} else if (variants.length === 1) {
		// Some agents changed, the rest still equal the vault: an external tool updated them.
		if (cfg.autoPullExternal === 'auto') actions.push({ type: 'pull', group: g, from: latest });
		else actions.push({ type: 'conflict', group: g, conflict: { kind: 'external', ours: v.copy, theirs: [latest], owners } });
	} else {
		const floor = Math.min(v.copy.mtimeMs, latest.mtimeMs);
		const base = variants.slice(1).find((c) => c.mtimeMs <= floor);
		actions.push({ type: 'conflict', group: g, conflict: { kind: 'diverged', ours: v.copy, theirs: variants, base, owners } });
	}
	return actions;
}
