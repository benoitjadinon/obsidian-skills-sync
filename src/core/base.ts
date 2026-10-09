import { isMap, isScalar, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';

export interface BaseOptions {
	hubFolder: string;
	prefix: string;
	agents: { id: string; label: string }[];
	/** View whose columns the plugin manages; empty or unknown = the first table view. */
	view?: string;
}

export const VIEW_ALL = 'All skills';
export const VIEW_UNDECIDED = 'Undecided';
export const VIEW_UNASSIGNED = 'Unassigned';
export const VIEW_CONFLICTS = 'Conflicts';
export const VIEW_TO_DELETE = 'To delete';

/** Property id used for display names (`note.agent-x`). */
const col = (o: BaseOptions, id: string): string => `note.${o.prefix}${id}`;
/** Column id in view orders: Obsidian saves note properties without the `note.` prefix. */
const orderCol = (o: BaseOptions, id: string): string => `${o.prefix}${id}`;
/** `note.agent-x` and `agent-x` name the same property. */
const bare = (key: string): string => (key.startsWith('note.') ? key.slice('note.'.length) : key);
const keyOf = (item: unknown): string => String(isScalar(item) ? item.value : item);
/** Formula giving each row a clickable link to its SKILL.md, shown as the skill folder name. */
const skillFormulaId = (o: BaseOptions): string => `${o.prefix}skillfile`;
const skillFormula = (o: BaseOptions): string => `file.asLink(file.folder.replace(${JSON.stringify(`${o.hubFolder}/`)}, ""))`;
/** Hidden formula: true when the note's folder name differs from the agents' folder name (renamed or split). */
const folderDiffersId = (o: BaseOptions): string => `${o.prefix}folder-differs`;
const folderDiffersFormula = (o: BaseOptions): string =>
	`if(note["${o.prefix}folder"], note["${o.prefix}folder"] != file.folder.replace(${JSON.stringify(`${o.hubFolder}/`)}, ""), false)`;
const ref = (o: BaseOptions, id: string): string => `note[${JSON.stringify(o.prefix + id)}]`;
const undecided = (o: BaseOptions) => ({ or: o.agents.map((a) => `${ref(o, a.id)} == null`) });
const unassigned = (o: BaseOptions) => ({ and: o.agents.map((a) => `${ref(o, a.id)} != true`) });

/** Drop duplicate columns (either spelling), keeping the first; returns the bare ids present. */
function dedupeOrder(order: YAMLSeq): Set<string> {
	const seen = new Set<string>();
	order.items = order.items.filter((i) => {
		const k = bare(keyOf(i));
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	return seen;
}

export function defaultBase(o: BaseOptions): string {
	const order = [`formula.${skillFormulaId(o)}`, 'description', ...o.agents.map((a) => orderCol(o, a.id)), orderCol(o, 'source'), orderCol(o, 'path'), orderCol(o, 'delete')];
	const properties: Record<string, { displayName: string }> = {
		[`formula.${skillFormulaId(o)}`]: { displayName: 'Skill' },
		[col(o, 'source')]: { displayName: 'Source' },
		[col(o, 'path')]: { displayName: 'Path' },
		[col(o, 'delete')]: { displayName: 'Delete' },
		[`formula.${folderDiffersId(o)}`]: { displayName: 'Renamed or split' },
	};
	for (const a of o.agents) properties[col(o, a.id)] = { displayName: a.label };
	return stringify({
		filters: { and: [`file.inFolder(${JSON.stringify(o.hubFolder)})`, 'file.name == "SKILL"'] },
		formulas: { [skillFormulaId(o)]: skillFormula(o), [folderDiffersId(o)]: folderDiffersFormula(o) },
		properties,
		views: [
			{ type: 'table', name: VIEW_ALL, order },
			{ type: 'table', name: VIEW_UNDECIDED, filters: undecided(o), order },
			{ type: 'table', name: VIEW_UNASSIGNED, filters: unassigned(o), order },
			{ type: 'table', name: VIEW_CONFLICTS, filters: { and: [`${ref(o, 'conflict')} == true`] }, order },
			{ type: 'table', name: VIEW_TO_DELETE, filters: { and: [`${ref(o, 'delete')} == true`] }, order },
		],
	});
}

/** Add missing agent and Source properties/columns to an existing base; refresh the plugin-managed views' filters. */
export function ensureAgentColumns(text: string, o: BaseOptions): string {
	const doc = parseDocument(text);
	const columns = [...o.agents.map((a) => ({ id: a.id, label: a.label })), { id: 'source', label: 'Source' }, { id: 'delete', label: 'Delete' }];
	for (const c of columns) {
		const has = doc.hasIn(['properties', col(o, c.id)]) || doc.hasIn(['properties', orderCol(o, c.id)]);
		if (!has) doc.setIn(['properties', col(o, c.id)], doc.createNode({ displayName: c.label }));
	}
	const formulaKey = `formula.${skillFormulaId(o)}`;
	if (!doc.hasIn(['formulas', skillFormulaId(o)])) doc.setIn(['formulas', skillFormulaId(o)], skillFormula(o));
	if (!doc.hasIn(['properties', formulaKey])) doc.setIn(['properties', formulaKey], doc.createNode({ displayName: 'Skill' }));
	// Defined but not shown: available from the view's Properties menu.
	if (!doc.hasIn(['formulas', folderDiffersId(o)])) doc.setIn(['formulas', folderDiffersId(o)], folderDiffersFormula(o));
	if (!doc.hasIn(['properties', `formula.${folderDiffersId(o)}`])) doc.setIn(['properties', `formula.${folderDiffersId(o)}`], doc.createNode({ displayName: 'Renamed or split' }));
	const views = doc.get('views');
	if (isSeq(views)) {
		const tables = views.items.filter((v) => isMap(v) && v.get('type') === 'table');
		const managed = tables.find((v) => isMap(v) && o.view && v.get('name') === o.view) ?? tables[0];
		for (const view of views.items) {
			if (!isMap(view) || view.get('type') !== 'table') continue;
			const name = view.get('name');
			if (name === VIEW_UNDECIDED) view.set('filters', doc.createNode(undecided(o)));
			if (name === VIEW_UNASSIGNED) view.set('filters', doc.createNode(unassigned(o)));
			if (view !== managed) continue;
			let order = view.get('order');
			if (!isSeq(order)) {
				order = doc.createNode([]);
				view.set('order', order);
			}
			if (isSeq(order)) {
				const seen = dedupeOrder(order);
				if (!seen.has(formulaKey)) order.items.unshift(doc.createNode(formulaKey));
				for (const c of columns) if (!seen.has(orderCol(o, c.id))) order.add(doc.createNode(orderCol(o, c.id)));
				// The Delete column stays last.
				const del = orderCol(o, 'delete');
				const idx = order.items.findIndex((i) => bare(keyOf(i)) === del);
				if (idx >= 0 && idx !== order.items.length - 1) order.items.push(...order.items.splice(idx, 1));
			}
		}
	}
	return doc.toString();
}

/** Remove an agent's property and columns from a base; refresh the managed views for the remaining agents. */
export function removeAgentColumn(text: string, remaining: BaseOptions, agentId: string): string {
	const key = orderCol(remaining, agentId);
	const doc = parseDocument(text);
	for (const k of [col(remaining, agentId), key]) if (doc.hasIn(['properties', k])) doc.deleteIn(['properties', k]);
	const views = doc.get('views');
	if (isSeq(views)) {
		for (const view of views.items) {
			if (!isMap(view)) continue;
			const order = view.get('order');
			if (isSeq(order)) {
				dedupeOrder(order);
				order.items = order.items.filter((i) => bare(keyOf(i)) !== key);
			}
			const name = view.get('name');
			if (name === VIEW_UNDECIDED) view.set('filters', doc.createNode(undecided(remaining)));
			if (name === VIEW_UNASSIGNED) view.set('filters', doc.createNode(unassigned(remaining)));
		}
	}
	return doc.toString();
}


/** Names of the table views of a base (for the view selector). */
export function listTableViews(text: string): string[] {
	try {
		const views = parseDocument(text).get('views');
		if (!isSeq(views)) return [];
		return views.items.filter((v) => isMap(v) && v.get('type') === 'table').map((v) => String(isMap(v) ? v.get('name') : '')).filter(Boolean);
	} catch {
		return [];
	}
}

/** The plugin's own property suffixes (never greyed). */
const META = ['skill-keys', 'source', 'path', 'folder', 'conflict', 'delete'];

/**
 * Whether a base cell's property (e.g. "note.agent-hermes") is an agent or project column that is
 * not available on this computer, so it should be greyed out (display only).
 */
export function isUnavailableColumn(property: string, prefix: string, available: string[]): boolean {
	const p = `note.${prefix}`;
	if (!property.startsWith(p)) return false;
	const key = property.slice(p.length);
	return !available.includes(key) && !META.includes(key);
}
