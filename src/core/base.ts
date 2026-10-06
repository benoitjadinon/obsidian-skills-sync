import { isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml';

export interface BaseOptions {
	hubFolder: string;
	prefix: string;
	agents: { id: string; label: string }[];
}

export const VIEW_ALL = 'All skills';
export const VIEW_UNDECIDED = 'Undecided';
export const VIEW_UNASSIGNED = 'Unassigned';
export const VIEW_CONFLICTS = 'Conflicts';

const col = (o: BaseOptions, id: string): string => `note.${o.prefix}${id}`;
const ref = (o: BaseOptions, id: string): string => `note[${JSON.stringify(o.prefix + id)}]`;
const undecided = (o: BaseOptions) => ({ or: o.agents.map((a) => `${ref(o, a.id)} == null`) });
const unassigned = (o: BaseOptions) => ({ and: o.agents.map((a) => `${ref(o, a.id)} != true`) });

export function defaultBase(o: BaseOptions): string {
	const order = ['formula.skill', 'description', ...o.agents.map((a) => col(o, a.id)), `note.${o.prefix}path`];
	const properties: Record<string, { displayName: string }> = {
		'formula.skill': { displayName: 'Skill' },
		[`note.${o.prefix}path`]: { displayName: 'Path' },
	};
	for (const a of o.agents) properties[col(o, a.id)] = { displayName: a.label };
	return stringify({
		filters: { and: [`file.inFolder(${JSON.stringify(o.hubFolder)})`, 'file.name == "SKILL"'] },
		formulas: { skill: `file.asLink(file.folder.replace(${JSON.stringify(`${o.hubFolder}/`)}, ""))` },
		properties,
		views: [
			{ type: 'table', name: VIEW_ALL, order },
			{ type: 'table', name: VIEW_UNDECIDED, filters: undecided(o), order },
			{ type: 'table', name: VIEW_UNASSIGNED, filters: unassigned(o), order },
			{ type: 'table', name: VIEW_CONFLICTS, filters: { and: [`${ref(o, 'conflict')} == true`] }, order },
		],
	});
}

/** Add missing agent properties/columns to an existing base; refresh the plugin-managed views' filters. */
export function ensureAgentColumns(text: string, o: BaseOptions): string {
	const doc = parseDocument(text);
	for (const a of o.agents) {
		if (!doc.hasIn(['properties', col(o, a.id)])) doc.setIn(['properties', col(o, a.id)], doc.createNode({ displayName: a.label }));
	}
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
				const have = new Set(order.items.map((i) => String(isScalar(i) ? i.value : i)));
				for (const a of o.agents) if (!have.has(col(o, a.id))) order.add(doc.createNode(col(o, a.id)));
			}
			const name = view.get('name');
			if (name === VIEW_UNDECIDED) view.set('filters', doc.createNode(undecided(o)));
			if (name === VIEW_UNASSIGNED) view.set('filters', doc.createNode(unassigned(o)));
		}
	}
	return doc.toString();
}
