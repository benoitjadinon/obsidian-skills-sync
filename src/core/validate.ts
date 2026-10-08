import { homedir } from 'os';
import { isAbsolute, relative, resolve } from 'path';
import { archiveRoot, expandHome } from './agents';
import type { AgentConfig } from './model';

/** Validators return a short user-facing error, or null when the value is fine. */
export type Check = string | null;

/** a is b, or a is inside b. */
function within(a: string, b: string): boolean {
	const rel = relative(resolve(b), resolve(a));
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Turn typed text into a valid id shape: lowercase, spaces and underscores become dashes,
 * other characters are dropped. `final` also trims trailing dashes (keep them while typing).
 */
export function normalizeIdInput(value: string, final = true): string {
	let id = value
		.toLowerCase()
		.replace(/[\s_]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-+/, '');
	if (final) id = id.replace(/-+$/, '');
	return id;
}

export interface FolderContext {
	/** Other configured agents (exclude the one being edited). */
	others: AgentConfig[];
	/** Absolute vault skills folder. */
	hubDir: string;
	home?: string;
}

export function validateAgentFolder(value: string, ctx: FolderContext): Check {
	const home = ctx.home ?? homedir();
	const v = value.trim();
	if (!v) return 'Required.';
	const abs = expandHome(v, home);
	if (!isAbsolute(abs)) return 'Use an absolute path, or one starting with ~.';
	for (const o of ctx.others) {
		if (resolve(expandHome(o.path, home)) === resolve(abs)) return `Already used by ${o.id}.`;
	}
	if (within(abs, ctx.hubDir) || within(ctx.hubDir, abs)) {
		return "Can't be the vault skills folder, a folder inside it, or a folder containing it.";
	}
	return null;
}

export function validateArchiveFolder(value: string, ctx: FolderContext & { skillsFolder: string }): Check {
	const v = value.trim();
	if (!v) return null;
	const home = ctx.home ?? homedir();
	const skills = expandHome(ctx.skillsFolder, home);
	const root = archiveRoot({ id: '', label: '', kind: 'agent', layout: 'flat', path: skills, archiveDir: v }, home);
	if (!root) return null;
	if (!isAbsolute(root)) return 'Set the skills folder first, or use an absolute path.';
	if (resolve(root) === resolve(skills)) return 'Must differ from the skills folder.';
	for (const o of ctx.others) {
		if (resolve(expandHome(o.path, home)) === resolve(root)) return `That is the skills folder of ${o.id}.`;
	}
	if (within(root, ctx.hubDir) || within(ctx.hubDir, root)) return "Can't be inside the vault skills folder.";
	return null;
}

export function validatePrefix(value: string): Check {
	if (!value) return 'Required.';
	if (!/^[a-z0-9_-]+$/.test(value)) return 'Use lowercase letters, digits, dashes or underscores.';
	if (!/^[a-z]/.test(value)) return 'Must start with a letter.';
	return null;
}

function vaultRelative(value: string): Check {
	const v = value.trim();
	if (!v) return 'Required.';
	if (v.startsWith('/') || v.split('/').includes('..')) return 'Must be a path inside the vault.';
	return null;
}

export function validateHubFolder(value: string): Check {
	return vaultRelative(value);
}

export function validateBasePath(value: string): Check {
	return vaultRelative(value) ?? (value.trim().endsWith('.base') ? null : 'Must end with .base.');
}

export function validateMergeCommand(value: string): Check {
	const v = value.trim();
	if (!v) return null; // optional: without a command the dialog offers no merge tool button
	if (!v.includes('{result}')) return 'Must include {result}, the file the tool writes the merge to.';
	if (!v.includes('{ours}') || !v.includes('{theirs}')) return 'Must include {ours} and {theirs}.';
	return null;
}

export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export function validateSkillName(value: string, existing: string[]): Check {
	const v = value.trim();
	if (!v) return 'Required.';
	if (!SKILL_NAME_RE.test(v) || v.includes('..')) return 'Use letters, digits, spaces, dots, dashes or underscores.';
	if (existing.includes(v)) return 'A skill with this name already exists.';
	return null;
}
