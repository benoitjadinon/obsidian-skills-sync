import { symlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { contentKey, scanAgent, scanVault, toBytes } from '../src/core/scan';
import type { AgentConfig, SyncConfig } from '../src/core/model';
import { put, skillMd, tmp } from './helpers';

const agent = (path: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
	id: 'a', label: 'A', path, kind: 'agent', layout: 'flat', archiveDir: '', ...extra,
});
const files = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, toBytes(v)]));

describe('contentKey', () => {
	it('ignores formatting-only differences', () => {
		expect(contentKey(files({ 'SKILL.md': skillMd('x'), 'run.sh': 'echo hi\n' }))).toBe(
			contentKey(files({ 'SKILL.md': skillMd('x').replace(/\n/g, '\r\n'), 'run.sh': 'echo hi' })),
		);
	});
	it('compares SKILL.md frontmatter semantically (Obsidian re-serialization)', () => {
		const a = '---\nname: x\ndescription: >-\n  a long\n  text\ntags: [a, b]\n---\nbody\n';
		const b = '---\nname: "x"\ndescription: a long text\ntags:\n  - a\n  - b\n---\nbody\n';
		expect(contentKey(files({ 'SKILL.md': a }))).toBe(contentKey(files({ 'SKILL.md': b })));
	});
	it('sees real changes, extra files and binary changes', () => {
		const base = contentKey(files({ 'SKILL.md': skillMd('x') }));
		expect(contentKey(files({ 'SKILL.md': skillMd('x', '# other\n') }))).not.toBe(base);
		expect(contentKey(files({ 'SKILL.md': skillMd('x'), 'extra.md': 'e' }))).not.toBe(base);
		const bin = (n: number) => new Map([['SKILL.md', toBytes(skillMd('x'))], ['i.png', new Uint8Array([0, 1, n])]]);
		expect(contentKey(bin(1))).not.toBe(contentKey(bin(2)));
	});
});

describe('scanAgent', () => {
	it('reads flat skills with nested files, skips dot folders and non-skills', async () => {
		const root = tmp();
		put(root, {
			'one/SKILL.md': skillMd('one'),
			'one/scripts/run.sh': 'echo\n',
			'one/.DS_Store': 'x',
			'.hidden/SKILL.md': skillMd('h'),
			'notaskill/readme.md': 'x',
			'my skill é/SKILL.md': skillMd('my skill é'),
		});
		const copies = await scanAgent(agent(root));
		expect(copies.map((c) => c.folder).sort()).toEqual(['my skill é', 'one']);
		const one = copies.find((c) => c.folder === 'one');
		expect([...(one?.files.keys() ?? [])].sort()).toEqual(['SKILL.md', 'scripts/run.sh']);
		expect(one?.relPath).toBe('');
	});

	it('walks nested layouts, records category paths and archive', async () => {
		const root = tmp();
		put(root, {
			'top/SKILL.md': skillMd('top'),
			'github/DESCRIPTION.md': '---\ndescription: cat\n---\n',
			'github/github-auth/SKILL.md': skillMd('github-auth'),
			'A/B/deep/SKILL.md': skillMd('deep'),
			'.archive/old/SKILL.md': skillMd('old'),
			'.hub/lock.json': '{}',
		});
		const copies = await scanAgent(agent(root, { layout: 'nested', archiveDir: '.archive' }));
		const by = Object.fromEntries(copies.map((c) => [c.folder, c]));
		expect(Object.keys(by).sort()).toEqual(['deep', 'github-auth', 'old', 'top']);
		expect(by['github-auth']?.relPath).toBe('github');
		expect(by['deep']?.relPath).toBe('A/B');
		expect(by['old']?.archived).toBe(true);
		expect(by['top']?.archived).toBe(false);
	});

	it('flags symlinked skill folders', async () => {
		const root = tmp();
		const target = tmp();
		put(target, { 'SKILL.md': skillMd('linked') });
		mkdirSync(root, { recursive: true });
		symlinkSync(target, join(root, 'linked'));
		const [c] = await scanAgent(agent(root));
		expect(c?.symlinkTarget).toBeTruthy();
	});

	it('returns [] for a missing agent folder', async () => {
		expect(await scanAgent(agent(join(tmp(), 'nope')))).toEqual([]);
	});
});

describe('scanVault', () => {
	it('converts SKILL.md to agent form, reads meta and conflict files', async () => {
		const hub = tmp();
		put(hub, {
			'x/SKILL.md': '---\nname: x\nrating: 5\nagent-skill-keys: [name]\nagent-claude: true\n---\nb\n',
			'x/SKILL.conflict.md': '<<<<<<< vault\n',
		});
		const cfg: SyncConfig = { hubDir: hub, prefix: 'agent-', agents: [], autoPullExternal: 'ask' };
		const [v] = await scanVault(cfg);
		expect(v?.name).toBe('x');
		expect(new TextDecoder().decode(v?.copy.files.get('SKILL.md'))).toBe('---\nname: x\n---\nb\n');
		expect(v?.copy.files.has('SKILL.conflict.md')).toBe(false);
		expect(v?.meta.states).toEqual({ claude: true });
		expect(v?.hasConflictFile).toBe(true);
	});
});
