import { describe, expect, it } from 'vitest';
import { planGroup } from '../src/core/engine';
import { emptyMeta } from '../src/core/frontmatter';
import type { AgentConfig, AgentState, SkillCopy, SkillGroup, SyncConfig } from '../src/core/model';

const ag = (id: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
	id, label: id, path: `/${id}`, kind: 'agent', layout: 'flat', archiveDir: '', ...extra,
});
const cfg = (agents: AgentConfig[], extra: Partial<SyncConfig> = {}): SyncConfig => ({
	hubDir: '/hub', prefix: 'agent-', agents, autoPullExternal: 'ask', ...extra,
});
const c = (owner: string, key: string, mtimeMs = 0, extra: Partial<SkillCopy> = {}): SkillCopy => ({
	owner, key, mtimeMs, dir: `/${owner}/x`, folder: 'x', relPath: '', archived: false, files: new Map(), ...extra,
});
const g = (states: Record<string, AgentState> | null, vaultKey: string, vaultMtime: number, copies: SkillCopy[], meta = {}): SkillGroup => ({
	name: 'x',
	copies,
	vault: states === null ? undefined : {
		name: 'x', rawSkillMd: '', hasConflictFile: false,
		meta: { ...emptyMeta(), states, ...meta },
		copy: c('vault', vaultKey, vaultMtime),
	},
});
const types = (as: { type: string }[]) => as.map((a) => a.type);
const AGENTS = [ag('claude'), ag('codex'), ag('opencode'), ag('gemini')];
const ALL_TRUE = { claude: true, codex: true, opencode: true, gemini: null };

describe('import (no vault skill)', () => {
	it('imports a single source, source true, others null', () => {
		const [a] = planGroup(g(null, '', 0, [c('claude', 'k')]), cfg(AGENTS));
		expect(a?.type).toBe('import');
		if (a?.type === 'import') expect(a.states).toEqual({ claude: true, codex: null, opencode: null, gemini: null });
	});
	it('imports identical copies once with every holder true and the nested path', () => {
		const agents = [ag('claude'), ag('hermes', { layout: 'nested' })];
		const [a] = planGroup(g(null, '', 0, [c('claude', 'k'), c('hermes', 'k', 0, { relPath: 'software-development' })]), cfg(agents));
		expect(a?.type).toBe('import');
		if (a?.type === 'import') {
			expect(a.states).toEqual({ claude: true, hermes: true });
			expect(a.path).toBe('software-development');
		}
	});
	it('asks when sources differ', () => {
		const [a] = planGroup(g(null, '', 0, [c('claude', 'k1', 1), c('codex', 'k2', 2)]), cfg(AGENTS));
		expect(a?.type).toBe('conflict');
		if (a?.type === 'conflict') {
			expect(a.conflict.kind).toBe('import');
			expect(a.conflict.theirs.map((t) => t.owner)).toEqual(['codex', 'claude']);
		}
	});
	it('imports archive-only skills as false', () => {
		const agents = [ag('hermes', { layout: 'nested', archiveDir: '.archive' })];
		const [a] = planGroup(g(null, '', 0, [c('hermes', 'k', 0, { archived: true })]), cfg(agents));
		if (a?.type === 'import') expect(a.states).toEqual({ hermes: false });
		else throw new Error('expected import');
	});
});

describe('vault skill', () => {
	it('does nothing when everything agrees', () => {
		expect(planGroup(g(ALL_TRUE, 'k', 0, [c('claude', 'k'), c('codex', 'k'), c('opencode', 'k')]), cfg(AGENTS))).toEqual([]);
	});
	it('fills missing agent states with null', () => {
		const as = planGroup(g({ claude: true }, 'k', 0, [c('claude', 'k')]), cfg(AGENTS));
		expect(as).toEqual([expect.objectContaining({ type: 'setStates', states: { codex: null, opencode: null, gemini: null } })]);
	});
	it('ignores undecided agents completely', () => {
		expect(planGroup(g(ALL_TRUE, 'k', 0, [c('claude', 'k'), c('codex', 'k'), c('opencode', 'k'), c('gemini', 'other', 99)]), cfg(AGENTS))).toEqual([]);
	});
	it('pushes to true agents that miss the skill, unarchives archived ones', () => {
		const agents = [ag('claude'), ag('hermes', { archiveDir: '.archive' })];
		const as = planGroup(g({ claude: true, hermes: true }, 'k', 0, [c('hermes', 'k', 0, { archived: true })]), cfg(agents));
		expect(types(as)).toEqual(['push', 'unarchive']);
	});
	it('deletes (or archives) from false agents when equal, asks when different', () => {
		const agents = [ag('claude'), ag('hermes', { archiveDir: '.archive' }), ag('codex')];
		const as = planGroup(
			g({ claude: false, hermes: false, codex: false }, 'k', 0, [c('claude', 'k'), c('hermes', 'k'), c('codex', 'changed')]),
			cfg(agents),
		);
		expect(types(as)).toEqual(['delete', 'archive', 'conflict']);
		const last = as[2];
		if (last?.type === 'conflict') expect(last.conflict.kind).toBe('delete');
	});
	it('pushes when the vault is newer and all agents agree', () => {
		const as = planGroup(g(ALL_TRUE, 'new', 10, [c('claude', 'old', 5), c('codex', 'old', 5), c('opencode', 'old', 5)]), cfg(AGENTS));
		expect(as.map((a) => (a.type === 'push' ? a.agent : a.type))).toEqual(['claude', 'codex', 'opencode']);
	});
	it('asks when the vault differs but is older than the agents', () => {
		const [a] = planGroup(g(ALL_TRUE, 'v', 1, [c('claude', 'k', 5), c('codex', 'k', 5), c('opencode', 'k', 5)]), cfg(AGENTS));
		if (a?.type === 'conflict') expect(a.conflict.kind).toBe('diverged');
		else throw new Error('expected conflict');
	});
	it('Orca partial update: some agents changed, rest equal vault → external conflict', () => {
		const [a] = planGroup(g(ALL_TRUE, 'old', 0, [c('claude', 'new', 5), c('codex', 'old', 0), c('opencode', 'new', 6)]), cfg(AGENTS));
		if (a?.type !== 'conflict') throw new Error('expected conflict');
		expect(a.conflict.kind).toBe('external');
		expect(a.conflict.owners).toEqual({ old: ['vault', 'codex'], new: ['claude', 'opencode'] });
		expect(a.conflict.theirs.map((t) => t.owner)).toEqual(['opencode']);
	});
	it('Orca partial update with autoPullExternal=auto → pull', () => {
		const [a] = planGroup(g(ALL_TRUE, 'old', 0, [c('claude', 'new', 5), c('codex', 'old', 0), c('opencode', 'new', 5)]), cfg(AGENTS, { autoPullExternal: 'auto' }));
		expect(a?.type).toBe('pull');
	});
	it('three variants → diverged conflict with the oldest unchanged copy as base', () => {
		const [a] = planGroup(g(ALL_TRUE, 'vaultEdit', 20, [c('claude', 'orca', 10), c('codex', 'orig', 0), c('opencode', 'orig', 0)]), cfg(AGENTS));
		if (a?.type !== 'conflict') throw new Error('expected conflict');
		expect(a.conflict.kind).toBe('diverged');
		expect(a.conflict.theirs[0]?.owner).toBe('claude');
		expect(a.conflict.base?.key).toBe('orig');
	});
	it('nested agent at another path → path conflict', () => {
		const agents = [ag('hermes', { layout: 'nested' })];
		const as = planGroup(g({ hermes: true }, 'k', 0, [c('hermes', 'k', 0, { relPath: 'moved' })], { path: 'github' }), cfg(agents));
		expect(as).toEqual([expect.objectContaining({ type: 'conflict', conflict: expect.objectContaining({ kind: 'path', agent: 'hermes' }) })]);
	});
	it('skips skills with a pending conflict file', () => {
		const grp = g(ALL_TRUE, 'v', 0, [c('claude', 'other', 5)]);
		if (grp.vault) grp.vault.hasConflictFile = true;
		expect(planGroup(grp, cfg(AGENTS))).toEqual([]);
	});
	it('ignores copies from agents that are not configured (or whose folder is missing)', () => {
		expect(planGroup(g({ claude: true }, 'k', 0, [c('claude', 'k'), c('ghost', 'zzz', 99)]), cfg([ag('claude')]))).toEqual([]);
	});
});
