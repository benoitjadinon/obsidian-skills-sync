import { promises as fsp } from 'fs';
import { createHash } from 'crypto';
import { join, relative, resolve, sep } from 'path';
import { archiveRoot } from './agents';
import { parse as parseYamlText } from 'yaml';
import { parseFrontmatter, readMeta, toAgentText } from './frontmatter';
import type { AgentConfig, SkillCopy, SyncConfig, VaultSkill } from './model';
import { VAULT } from './model';
import { isBinary, normalizeText } from './normalize';

const IGNORED = new Set(['.DS_Store', 'Thumbs.db', '.git']);
const CONFLICT_SUFFIX = '.conflict';
const enc = new TextEncoder();
const dec = new TextDecoder();

export const toBytes = (s: string): Uint8Array => enc.encode(s);
export const toText = (b: Uint8Array): string => dec.decode(b);

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

export async function exists(p: string): Promise<boolean> {
	try {
		await fsp.access(p);
		return true;
	} catch {
		return false;
	}
}

export function isConflictFile(name: string): boolean {
	return name === 'SKILL.conflict.md' || name.endsWith(CONFLICT_SUFFIX);
}
export function conflictName(rel: string): string {
	return rel === 'SKILL.md' ? 'SKILL.conflict.md' : rel + CONFLICT_SUFFIX;
}
export function conflictTarget(conflictRel: string): string {
	return conflictRel === 'SKILL.conflict.md' ? 'SKILL.md' : conflictRel.slice(0, -CONFLICT_SUFFIX.length);
}

export async function listConflictFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (d: string): Promise<void> => {
		for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
			const p = join(d, ent.name);
			if (ent.isDirectory()) await walk(p);
			else if (isConflictFile(ent.name)) out.push(relative(dir, p).split(sep).join('/'));
		}
	};
	if (await exists(dir)) await walk(dir);
	return out;
}

/** Read every file of a skill folder (follows symlinks), skipping OS junk and conflict files. */
export async function readSkillDir(dir: string): Promise<{ files: Map<string, Uint8Array>; mtimeMs: number }> {
	const files = new Map<string, Uint8Array>();
	let mtimeMs = 0;
	const walk = async (d: string): Promise<void> => {
		for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
			if (IGNORED.has(ent.name) || isConflictFile(ent.name)) continue;
			const p = join(d, ent.name);
			const st = await fsp.stat(p);
			if (st.isDirectory()) await walk(p);
			else if (st.isFile()) {
				files.set(relative(dir, p).split(sep).join('/'), new Uint8Array(await fsp.readFile(p)));
				mtimeMs = Math.max(mtimeMs, st.mtimeMs);
			}
		}
	};
	await walk(dir);
	return { files, mtimeMs };
}

function skillMdKey(text: string): string {
	const p = parseFrontmatter(text);
	const fm = p.hasBlock ? p.entries.map((e) => e.raw).join('') : '';
	let data: unknown = null;
	try {
		data = fm ? parseYamlText(fm) : null;
	} catch {
		data = normalizeText(fm);
	}
	return `${JSON.stringify(data)}\u0000${normalizeText(p.body)}`;
}

export function fileKey(rel: string, data: Uint8Array): string {
	if (isBinary(data)) return `b:${createHash('sha1').update(data).digest('hex')}`;
	const text = toText(data);
	return `t:${rel === 'SKILL.md' ? skillMdKey(text) : normalizeText(text)}`;
}

export function contentKey(files: Map<string, Uint8Array>): string {
	const h = createHash('sha1');
	for (const rel of [...files.keys()].sort()) {
		const d = files.get(rel);
		if (d) h.update(`${rel}\u0000${fileKey(rel, d)}\n`);
	}
	return h.digest('hex');
}

async function makeCopy(
	owner: string, dir: string, folder: string, relPath: string, archived: boolean, symlinkTarget?: string,
): Promise<SkillCopy> {
	const { files, mtimeMs } = await readSkillDir(dir);
	return { owner, dir, folder, relPath, archived, files, mtimeMs, key: contentKey(files), symlinkTarget };
}

interface Found { dir: string; folder: string; relPath: string; symlinkTarget?: string }

/** skip: absolute folders not to descend into (an archive living inside the agent folder). */
async function walkSkills(root: string, rel: string, out: Found[], skip: Set<string>, recursive: boolean): Promise<void> {
	let ents;
	try {
		ents = await fsp.readdir(join(root, rel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of ents) {
		const dir = join(root, rel, ent.name);
		if (ent.name.startsWith('.') || skip.has(resolve(dir))) continue;
		const st = await fsp.stat(dir).catch(() => null);
		if (!st?.isDirectory()) continue;
		if (await exists(join(dir, 'SKILL.md'))) {
			out.push({ dir, folder: ent.name, relPath: rel, symlinkTarget: ent.isSymbolicLink() ? await fsp.realpath(dir) : undefined });
		} else if (recursive) {
			await walkSkills(root, rel ? `${rel}/${ent.name}` : ent.name, out, skip, recursive);
		}
	}
}

export async function scanAgent(agent: AgentConfig): Promise<SkillCopy[]> {
	if (!(await exists(agent.path))) return [];
	const found: Found[] = [];
	const archive = archiveRoot(agent);
	await walkSkills(agent.path, '', found, new Set(archive ? [resolve(archive)] : []), agent.layout === 'nested');
	const copies = await Promise.all(found.map((f) => makeCopy(agent.id, f.dir, f.folder, f.relPath, false, f.symlinkTarget)));
	if (archive) {
		const arch: Found[] = [];
		await walkSkills(archive, '', arch, new Set(), true);
		copies.push(...(await Promise.all(arch.map((f) => makeCopy(agent.id, f.dir, f.folder, f.relPath, true)))));
	}
	return copies;
}

export async function scanVault(cfg: SyncConfig): Promise<VaultSkill[]> {
	if (!(await exists(cfg.hubDir))) return [];
	const out: VaultSkill[] = [];
	for (const ent of await fsp.readdir(cfg.hubDir, { withFileTypes: true })) {
		if (ent.name.startsWith('.') || !ent.isDirectory()) continue;
		const dir = join(cfg.hubDir, ent.name);
		const skillPath = join(dir, 'SKILL.md');
		if (!(await exists(skillPath))) continue;
		const raw = toText(new Uint8Array(await fsp.readFile(skillPath)));
		const { files, mtimeMs } = await readSkillDir(dir);
		files.set('SKILL.md', toBytes(toAgentText(raw, cfg.prefix)));
		out.push({
			name: ent.name,
			rawSkillMd: raw,
			meta: readMeta(raw, cfg.prefix),
			hasConflictFile: (await listConflictFiles(dir)).length > 0,
			copy: { owner: VAULT, dir, folder: ent.name, relPath: '', archived: false, files, mtimeMs, key: contentKey(files) },
		});
	}
	return out;
}
