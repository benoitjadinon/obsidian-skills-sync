import type { AgentState, PluginMeta } from './model';

export interface FmEntry {
	/** Unquoted key; '' for leading comment/blank lines before the first key. */
	key: string;
	/** Raw text of the entry including continuation lines and line endings. */
	raw: string;
}

export interface ParsedFm {
	hasBlock: boolean;
	eol: string;
	entries: FmEntry[];
	/** Everything after the closing delimiter line (whole text when no block). */
	body: string;
}

export const RESERVED = ['skill-keys', 'path', 'folder', 'conflict'];

const OPEN_RE = /^---[ \t]*\r?\n/;
const CLOSE_RE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"-][^:]*?|-[^\s:][^:]*?)[ \t]*:(?=[ \t]|$)/;

export function unquote(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
		try {
			return JSON.parse(t) as string;
		} catch {
			return t.slice(1, -1);
		}
	}
	if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
	return t;
}

export function parseFrontmatter(text: string): ParsedFm {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const open = OPEN_RE.exec(text);
	if (!open) return { hasBlock: false, eol, entries: [], body: text };
	const entries: FmEntry[] = [];
	let pos = open[0].length;
	while (pos < text.length) {
		const nl = text.indexOf('\n', pos);
		const end = nl === -1 ? text.length : nl + 1;
		const line = text.slice(pos, end);
		const bare = line.replace(/\r?\n$/, '');
		if (CLOSE_RE.test(bare)) return { hasBlock: true, eol, entries, body: text.slice(end) };
		const m = KEY_RE.exec(bare);
		const last = entries[entries.length - 1];
		if (m && m[1] !== undefined) entries.push({ key: unquote(m[1]), raw: line });
		else if (last) last.raw += line;
		else entries.push({ key: '', raw: line });
		pos = end;
	}
	// Unterminated block: treat the whole text as body.
	return { hasBlock: false, eol, entries: [], body: text };
}

function firstLineValue(e: FmEntry): string {
	const first = e.raw.split(/\r?\n/)[0] ?? '';
	const i = first.search(/:(?=[ \t]|$)/);
	return i === -1 ? '' : first.slice(i + 1).trim();
}

function listValue(e: FmEntry): string[] {
	const v = firstLineValue(e).replace(/\s+#.*$/, '');
	if (v.startsWith('[')) {
		return v
			.replace(/^\[|\]$/g, '')
			.split(',')
			.map(unquote)
			.filter((s) => s.length > 0);
	}
	return e.raw
		.split(/\r?\n/)
		.slice(1)
		.map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1])
		.filter((s): s is string => s !== undefined)
		.map(unquote);
}

function boolValue(v: string): AgentState {
	const t = v.replace(/\s+#.*$/, '').trim().toLowerCase();
	if (t === 'true') return true;
	if (t === 'false') return false;
	return null;
}

export function emptyMeta(): PluginMeta {
	return { states: {}, skillKeys: null, path: '', folder: '', conflict: false };
}

export function readMeta(text: string, prefix: string): PluginMeta {
	const meta = emptyMeta();
	for (const e of parseFrontmatter(text).entries) {
		if (!e.key.startsWith(prefix)) continue;
		const sub = e.key.slice(prefix.length);
		if (sub === 'skill-keys') meta.skillKeys = listValue(e);
		else if (sub === 'path') meta.path = unquote(firstLineValue(e));
		else if (sub === 'folder') meta.folder = unquote(firstLineValue(e));
		else if (sub === 'conflict') meta.conflict = boolValue(firstLineValue(e)) === true;
		else meta.states[sub] = boolValue(firstLineValue(e));
	}
	return meta;
}

function scalar(s: string): string {
	return /^[A-Za-z0-9_./-]+$/.test(s) && !/^(true|false|null|~)$/i.test(s) ? s : JSON.stringify(s);
}

export function renderMeta(meta: PluginMeta, prefix: string, eol: string, agentOrder: string[]): string {
	const lines = [`${prefix}skill-keys: [${(meta.skillKeys ?? []).map(scalar).join(', ')}]`];
	const extra = Object.keys(meta.states).filter((id) => !agentOrder.includes(id));
	for (const id of [...agentOrder, ...extra]) {
		const v = meta.states[id] ?? null;
		lines.push(`${prefix}${id}:${v === null ? '' : ` ${String(v)}`}`);
	}
	if (meta.path) lines.push(`${prefix}path: ${scalar(meta.path)}`);
	if (meta.folder) lines.push(`${prefix}folder: ${scalar(meta.folder)}`);
	if (meta.conflict) lines.push(`${prefix}conflict: true`);
	return lines.map((l) => l + eol).join('');
}

function skillKeysOf(p: ParsedFm, meta: PluginMeta, prefix: string): string[] {
	return meta.skillKeys ?? p.entries.filter((e) => e.key !== '' && !e.key.startsWith(prefix)).map((e) => e.key);
}

/** Vault note → exact text an agent should get. */
export function toAgentText(vaultText: string, prefix: string): string {
	const p = parseFrontmatter(vaultText);
	if (!p.hasBlock) return vaultText;
	const keys = skillKeysOf(p, readMeta(vaultText, prefix), prefix);
	if (keys.length === 0) return p.body;
	const lead = p.entries.filter((e) => e.key === '');
	const kept = keys
		.map((k) => p.entries.find((e) => e.key === k))
		.filter((e): e is FmEntry => e !== undefined);
	return `---${p.eol}${[...lead, ...kept].map((e) => e.raw).join('')}---${p.eol}${p.body}`;
}

/**
 * Agent text → vault note. Agent keys first (raw, in order), then the user's own keys
 * from the existing vault note, then plugin keys. skill-keys is refreshed from the agent.
 */
export function toVaultText(
	agentText: string,
	existingVault: string | null,
	prefix: string,
	meta: PluginMeta,
	agentOrder: string[],
): string {
	const a = parseFrontmatter(agentText);
	const skillKeys = a.entries.filter((e) => e.key !== '').map((e) => e.key);
	let user: FmEntry[] = [];
	if (existingVault !== null) {
		const v = parseFrontmatter(existingVault);
		const old = skillKeysOf(v, readMeta(existingVault, prefix), prefix);
		user = v.entries.filter(
			(e) => e.key !== '' && !e.key.startsWith(prefix) && !old.includes(e.key) && !skillKeys.includes(e.key),
		);
	}
	const head = a.entries.map((e) => e.raw).join('') + user.map((e) => e.raw).join('');
	return `---${a.eol}${head}${renderMeta({ ...meta, skillKeys }, prefix, a.eol, agentOrder)}---${a.eol}${a.body}`;
}

/** Replace the plugin keys of a vault note, keeping skill and user keys untouched. */
export function setMeta(vaultText: string, meta: PluginMeta, prefix: string, agentOrder: string[]): string {
	const p = parseFrontmatter(vaultText);
	if (!p.hasBlock) {
		return `---${p.eol}${renderMeta({ ...meta, skillKeys: meta.skillKeys ?? [] }, prefix, p.eol, agentOrder)}---${p.eol}${p.body}`;
	}
	const rest = p.entries.filter((e) => !e.key.startsWith(prefix) || e.key === '');
	const skillKeys = meta.skillKeys ?? rest.filter((e) => e.key !== '').map((e) => e.key);
	return `---${p.eol}${rest.map((e) => e.raw).join('')}${renderMeta({ ...meta, skillKeys }, prefix, p.eol, agentOrder)}---${p.eol}${p.body}`;
}

export function newSkillText(name: string, description: string, prefix: string, agentOrder: string[]): string {
	const agentText = `---\nname: ${scalar(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n`;
	return toVaultText(agentText, null, prefix, emptyMeta(), agentOrder);
}
