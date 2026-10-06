import { mkdirSync } from 'fs';
import { join } from 'path';
import type { AgentConfig, AgentState, SyncConfig } from '../../src/core/model';
import { emptyMeta, toVaultText } from '../../src/core/frontmatter';
import type { ConflictRequest, MigrationItem, Resolution, Resolver } from '../../src/core/sync';
import { put, tmp, tree } from '../helpers';

export function world(defs: Array<Partial<AgentConfig> & { id: string }>, opts: Partial<SyncConfig> = {}) {
	const root = tmp();
	const hub = join(root, 'vault', 'Skills');
	mkdirSync(hub, { recursive: true });
	const agents: AgentConfig[] = defs.map((d) => ({
		label: d.id, kind: 'agent', layout: 'flat', archiveDir: '', path: join(root, 'agents', d.id), ...d,
	}));
	for (const a of agents) mkdirSync(a.path, { recursive: true });
	const cfg: SyncConfig = { hubDir: hub, prefix: 'agent-', agents, autoPullExternal: 'ask', ...opts };
	const dir = (owner: string): string => (owner === 'vault' ? hub : (agents.find((a) => a.id === owner)?.path ?? ''));
	return {
		root, hub, cfg, dir,
		put: (owner: string, files: Record<string, string>, mtime?: Date) => put(dir(owner), files, mtime),
		tree: (owner: string) => tree(dir(owner)),
		/** Vault note text for an agent text, with states and optional user keys. */
		vaultMd: (agentText: string, states: Record<string, AgentState>, userKeys = '', path = '') =>
			toVaultText(agentText, null, 'agent-', { ...emptyMeta(), states, path }, agents.map((a) => a.id)).replace(
				'agent-skill-keys',
				`${userKeys}agent-skill-keys`,
			),
	};
}

export class StubResolver implements Resolver {
	requests: ConflictRequest[] = [];
	migrations: MigrationItem[][] = [];
	constructor(private readonly answer: (r: ConflictRequest) => Resolution | Promise<Resolution> = () => ({ kind: 'skip' })) {}
	async resolve(r: ConflictRequest): Promise<Resolution> {
		this.requests.push(r);
		return this.answer(r);
	}
	async confirmMigration(items: MigrationItem[]): Promise<boolean> {
		this.migrations.push(items);
		return true;
	}
}

/** Resolver answer: take the version held by `owner`. */
export const keep = (owner: string) => (r: ConflictRequest): Resolution => {
	const all = [r.conflict.ours, r.conflict.base, ...r.conflict.theirs].filter((c) => c !== undefined);
	const pick = all.find((c) => c.owner === owner || (r.conflict.owners[c.key] ?? []).includes(owner));
	if (!pick) throw new Error(`no version held by ${owner}`);
	return { kind: 'apply', files: pick.files };
};
