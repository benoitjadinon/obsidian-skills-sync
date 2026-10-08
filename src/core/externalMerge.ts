import { exec } from 'child_process';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { conflictLabels, hasMarkers, mergeSkill } from './merge';
import { isBinary } from './normalize';
import { toBytes, toText } from './scan';
import type { ConflictRequest, Resolution } from './sync';

type Slot = 'ours' | 'base' | 'theirs' | 'result';

/** Ready-made commands for common merge tools (users can still type their own). */
export const MERGE_TOOL_PRESETS: { id: string; label: string; command: string }[] = [
	{ id: 'vscode', label: 'VS Code', command: 'code --wait --merge {ours} {theirs} {base} {result}' },
	{ id: 'filemerge', label: 'FileMerge (Xcode)', command: 'opendiff {ours} {theirs} -ancestor {base} -merge {result}' },
	{ id: 'kaleidoscope', label: 'Kaleidoscope', command: 'ksdiff --merge --output {result} --base {base} {ours} {theirs}' },
	{ id: 'meld', label: 'Meld', command: 'meld {ours} {base} {theirs} --output {result}' },
	// JetBrains IDEs need their command-line launcher (Toolbox → Settings → Shell scripts, or Tools → Create Command-line Launcher).
	{ id: 'intellij', label: 'IntelliJ IDEA', command: 'idea merge {ours} {theirs} {base} {result}' },
	{ id: 'webstorm', label: 'WebStorm', command: 'webstorm merge {ours} {theirs} {base} {result}' },
];

/** First word of the command, for messages. */
function toolName(template: string): string {
	return template.trim().split(/\s+/)[0] ?? template;
}

/** Turn a failed merge-tool run into a short message for the user. */
export function describeMergeError(err: unknown, template: string): string {
	const tool = toolName(template);
	const e = err as { code?: unknown; message?: unknown } | null;
	const message = typeof e?.message === 'string' ? e.message : String(err);
	if (e?.code === 127 || e?.code === 'ENOENT' || /not found|not recognized as an internal or external command/i.test(message)) {
		return `Merge tool not found: "${tool}". Install it, add it to your PATH, or set a different command in settings.`;
	}
	const code = typeof e?.code === 'number' ? ` (code ${e.code})` : '';
	return `The merge tool "${tool}" exited with an error${code}. Nothing was applied.`;
}

function quote(p: string): string {
	return process.platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`;
}

export function buildCommand(template: string, paths: Record<Slot, string>): string {
	return template.replace(/\{(ours|base|theirs|result)\}/g, (_m, k: Slot) => quote(paths[k]));
}

function withPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
	return { ...env, PATH: [env.PATH ?? '', ...extra].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') };
}

/** Run the user's merge tool; returns the result text, or null when markers remain. */
export async function runExternalMerge(
	template: string,
	input: { ours: string; base: string | null; theirs: string; initial: string },
	ext = '.md',
): Promise<string | null> {
	const dir = await fsp.mkdtemp(join(tmpdir(), 'skills-sync-'));
	const paths: Record<Slot, string> = {
		ours: join(dir, `ours${ext}`), base: join(dir, `base${ext}`), theirs: join(dir, `theirs${ext}`), result: join(dir, `result${ext}`),
	};
	try {
		await fsp.writeFile(paths.ours, input.ours);
		await fsp.writeFile(paths.base, input.base ?? '');
		await fsp.writeFile(paths.theirs, input.theirs);
		await fsp.writeFile(paths.result, input.initial);
		await new Promise<void>((resolve, reject) => {
			exec(buildCommand(template, paths), { env: withPath(process.env) }, (err) => (err ? reject(err) : resolve()));
		});
		const out = await fsp.readFile(paths.result, 'utf8');
		return hasMarkers(out) ? null : out;
	} finally {
		await fsp.rm(dir, { recursive: true, force: true });
	}
}

export async function resolveWithExternalTool(req: ConflictRequest, template: string): Promise<Resolution | null> {
	const c = req.conflict;
	const ours = c.ours ?? req.group.vault?.copy;
	const theirs = c.theirs[0];
	if (!ours || !theirs) return null;
	const m = mergeSkill(ours, c.base, theirs, conflictLabels(c, req.labels));
	const files = new Map(m.files);
	for (const rel of m.conflicted) {
		const o = ours.files.get(rel);
		const t = theirs.files.get(rel);
		if (!o || !t || isBinary(o) || isBinary(t)) return null;
		const b = c.base?.files.get(rel);
		const out = await runExternalMerge(
			template,
			{ ours: toText(o), base: b ? toText(b) : null, theirs: toText(t), initial: toText(m.files.get(rel) ?? o) },
			extname(rel) || '.txt',
		);
		if (out === null) return null;
		files.set(rel, toBytes(out));
	}
	return { kind: 'apply', files };
}
