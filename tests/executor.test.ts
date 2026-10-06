import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { assertInside, Executor } from '../src/core/executor';
import type { SyncConfig } from '../src/core/model';
import { toBytes } from '../src/core/scan';
import { put, tmp, tree } from './helpers';

const files = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, toBytes(v)]));

function setup(): { cfg: SyncConfig; root: string } {
	const root = tmp();
	const cfg: SyncConfig = {
		hubDir: join(root, 'hub'),
		prefix: 'agent-',
		agents: [{ id: 'claude', label: 'Claude', path: join(root, 'claude'), kind: 'agent', layout: 'flat', archiveDir: '' }],
		autoPullExternal: 'ask',
	};
	mkdirSync(cfg.hubDir, { recursive: true });
	mkdirSync(join(root, 'claude'), { recursive: true });
	return { cfg, root };
}

describe('assertInside', () => {
	it('accepts children, rejects the root itself and escapes', () => {
		expect(() => assertInside('/a/b/c', '/a/b')).not.toThrow();
		expect(() => assertInside('/a/b', '/a/b')).toThrow();
		expect(() => assertInside('/a/b/../x', '/a/b')).toThrow();
		expect(() => assertInside('/elsewhere', '/a/b')).toThrow();
	});
});

describe('Executor.syncDir', () => {
	it('writes new files, removes stale ones, keeps conflict files', async () => {
		const { cfg, root } = setup();
		const dir = join(root, 'claude', 'x');
		put(dir, { 'SKILL.md': 'old', 'stale.md': 's', 'SKILL.conflict.md': 'c' });
		await new Executor(cfg).syncDir(dir, files({ 'SKILL.md': 'new', 'scripts/a.sh': 'a' }), join(root, 'claude'));
		expect(tree(dir)).toEqual({ 'SKILL.md': 'new', 'scripts/a.sh': 'a', 'SKILL.conflict.md': 'c' });
	});
	it('refuses to write into a symlinked skill folder', async () => {
		const { cfg, root } = setup();
		const target = join(root, 'target');
		put(target, { 'SKILL.md': 'vault content' });
		symlinkSync(target, join(root, 'claude', 'x'));
		await expect(new Executor(cfg).syncDir(join(root, 'claude', 'x'), files({ 'SKILL.md': 'x' }), join(root, 'claude'))).rejects.toThrow(/symlink/);
		expect(tree(target)).toEqual({ 'SKILL.md': 'vault content' });
	});
	it('refuses to touch the agent root itself', async () => {
		const { cfg, root } = setup();
		await expect(new Executor(cfg).syncDir(join(root, 'claude'), files({}), join(root, 'claude'))).rejects.toThrow();
		expect(existsSync(join(root, 'claude'))).toBe(true);
		expect(lstatSync(join(root, 'claude')).isDirectory()).toBe(true);
	});
});

describe('Executor.importSkill', () => {
	it('writes the vault note with plugin keys and other files untouched', async () => {
		const { cfg } = setup();
		await new Executor(cfg).importSkill('x', files({ 'SKILL.md': '---\nname: x\n---\nb\n', 'ref.md': 'r' }), { claude: true }, '', '');
		expect(tree(join(cfg.hubDir, 'x'))).toEqual({
			'SKILL.md': '---\nname: x\nagent-skill-keys: [name]\nagent-claude: true\n---\nb\n',
			'ref.md': 'r',
		});
	});
});
