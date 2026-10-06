import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';

export const T0 = new Date('2026-01-01T00:00:00Z');
export const T1 = new Date('2026-02-01T00:00:00Z');
export const T2 = new Date('2026-03-01T00:00:00Z');
export const T3 = new Date('2026-04-01T00:00:00Z');

export function tmp(): string {
	return mkdtempSync(join(tmpdir(), 'ash-'));
}

/** Write files below root; optionally set their mtime. */
export function put(root: string, files: Record<string, string>, mtime?: Date): void {
	for (const [rel, content] of Object.entries(files)) {
		const p = join(root, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, content);
		if (mtime) utimesSync(p, mtime, mtime);
	}
}

export function touch(path: string, mtime: Date): void {
	utimesSync(path, mtime, mtime);
}

/** Read every file below root as { 'rel/path': 'content' }. Missing root → {}. */
export function tree(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!existsSync(root)) return out;
	const walk = (d: string): void => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else out[relative(root, p).split(sep).join('/')] = readFileSync(p, 'utf8');
		}
	};
	walk(root);
	return out;
}

export function skillMd(name: string, body = `# ${name}\n\nDo things.\n`, extraKeys = ''): string {
	return `---\nname: ${name}\ndescription: ${name} skill\n${extraKeys}---\n${body}`;
}
