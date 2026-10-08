import { isMap, isScalar, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';

export interface BaseOptions {
	hubFolder: string;
	prefix: string;
	agents: { id: string; label: string }[];
}

export const VIEW_ALL = 'All skills';
export const VIEW_UNDECIDED = 'Undecided';
export const VIEW_UNASSIGNED = 'Unassigned';
export const VIEW_CONFLICTS = 'Conflicts';

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
	const order = [`formula.${skillFormulaId(o)}`, 'description', ...o.agents.map((a) => orderCol(o, a.id)), orderCol(o, 'source'), orderCol(o, 'path')];
	const properties: Record<string, { displayName: string }> = {
		[`formula.${skillFormulaId(o)}`]: { displayName: 'Skill' },
		[col(o, 'source')]: { displayName: 'Source' },
		[col(o, 'path')]: { displayName: 'Path' },
	};
	for (const a of o.agents) properties[col(o, a.id)] = { displayName: a.label };
	return stringify({
		filters: { and: [`file.inFolder(${JSON.stringify(o.hubFolder)})`, 'file.name == "SKILL"'] },
		formulas: { [skillFormulaId(o)]: skillFormula(o) },
		properties,
		views: [
			{ type: 'table', name: VIEW_ALL, order },
			{ type: 'table', name: VIEW_UNDECIDED, filters: undecided(o), order },
			{ type: 'table', name: VIEW_UNASSIGNED, filters: unassigned(o), order },
			{ type: 'table', name: VIEW_CONFLICTS, filters: { and: [`${ref(o, 'conflict')} == true`] }, order },
		],
	});
}

/** Add missing agent and Source properties/columns to an existing base; refresh the plugin-managed views' filters. */
export function ensureAgentColumns(text: string, o: BaseOptions): string {
	const doc = parseDocument(text);
	const columns = [...o.agents.map((a) => ({ id: a.id, label: a.label })), { id: 'source', label: 'Source' }];
	for (const c of columns) {
		const has = doc.hasIn(['properties', col(o, c.id)]) || doc.hasIn(['properties', orderCol(o, c.id)]);
		if (!has) doc.setIn(['properties', col(o, c.id)], doc.createNode({ displayName: c.label }));
	}
	const formulaKey = `formula.${skillFormulaId(o)}`;
	if (!doc.hasIn(['formulas', skillFormulaId(o)])) doc.setIn(['formulas', skillFormulaId(o)], skillFormula(o));
	if (!doc.hasIn(['properties', formulaKey])) doc.setIn(['properties', formulaKey], doc.createNode({ displayName: 'Skill' }));
	const views = doc.get('views');
	if (isSeq(views)) {
		for (const view of views.items) {
			if (!isMap(view) || view.get('type') !== 'table') continue;
			let order = view.get('order');
			if (!isSeq(order)) {
				order = doc.createNode([]);
				view.set('order', order);
			}
			if (isSeq(order)) {
				const seen = dedupeOrder(order);
				if (!seen.has(formulaKey)) order.items.unshift(doc.createNode(formulaKey));
				for (const c of columns) if (!seen.has(orderCol(o, c.id))) order.add(doc.createNode(orderCol(o, c.id)));
			}
			const name = view.get('name');
			if (name === VIEW_UNDECIDED) view.set('filters', doc.createNode(undecided(o)));
			if (name === VIEW_UNASSIGNED) view.set('filters', doc.createNode(unassigned(o)));
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

/** This computer's base file: the shared pattern with the computer's name before .base. */
export function deviceBasePath(pattern: string, deviceName: string): string {
	const stem = pattern.endsWith('.base') ? pattern.slice(0, -'.base'.length) : pattern;
	return `${stem} (${deviceName}).base`;
}
