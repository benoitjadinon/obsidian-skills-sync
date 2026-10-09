import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultBase, ensureAgentColumns, removeAgentColumn } from '../src/core/base';

const opts = (ids: string[]) => ({ hubFolder: 'Skills', prefix: 'agent-', agents: ids.map((id) => ({ id, label: id.toUpperCase() })) });

interface View { name: string; order: string[]; filters?: { or?: string[]; and?: string[] } }
interface Base { filters: { and: string[] }; properties: Record<string, { displayName: string }>; views: View[] }

describe('defaultBase', () => {
	it('lists SKILL.md files of the hub with one column per agent', () => {
		const b = parse(defaultBase(opts(['claude', 'codex']))) as Base;
		expect(b.filters.and).toEqual(['file.inFolder("Skills")', 'file.name == "SKILL"']);
		expect(b.properties['note.agent-claude']?.displayName).toBe('CLAUDE');
		expect(b.views.map((v) => v.name)).toEqual(['All skills', 'Undecided', 'Unassigned', 'Conflicts', 'To delete']);
		expect(b.views[0]?.order).toEqual(['formula.agent-skillfile', 'description', 'agent-claude', 'agent-codex', 'agent-source', 'agent-path', 'agent-delete']);
		expect(b.views[1]?.filters?.or).toEqual(['note["agent-claude"] == null', 'note["agent-codex"] == null']);
	});
});

describe('ensureAgentColumns', () => {
	const existing = `model:
  version: 1
  kind: Table
  columns: []
pluginVersion: 1.0.0
filters:
  and:
    - file.folder.startsWith("AI/skills")
    - file.name == "SKILL"
views:
  - type: table
    name: Table
    order:
      - file.name
      - name
      - description
`;
	it('adds missing agent properties and columns, keeps everything else, is idempotent', () => {
		const once = ensureAgentColumns(existing, opts(['claude']));
		const twice = ensureAgentColumns(once, opts(['claude']));
		expect(twice).toBe(once);
		const b = parse(once) as Base & { pluginVersion: string };
		expect(b.pluginVersion).toBe('1.0.0');
		expect(b.filters.and[0]).toBe('file.folder.startsWith("AI/skills")');
		expect(b.properties['note.agent-claude']?.displayName).toBe('CLAUDE');
		expect(b.views[0]?.order).toEqual(['formula.agent-skillfile', 'file.name', 'name', 'description', 'agent-claude', 'agent-source', 'agent-delete']);
	});
	it('refreshes the managed Undecided and Unassigned filters when agents are added', () => {
		const b = parse(ensureAgentColumns(defaultBase(opts(['claude'])), opts(['claude', 'hermes']))) as Base;
		expect(b.views.find((v) => v.name === 'Undecided')?.filters?.or).toEqual(['note["agent-claude"] == null', 'note["agent-hermes"] == null']);
		expect(b.views.find((v) => v.name === 'Unassigned')?.filters?.and).toHaveLength(2);
	});
});

describe('plain and note.-prefixed column names (Obsidian saves plain ones)', () => {
	const o = (ids: string[]) => ({ hubFolder: 'AI/skills', prefix: 'agent-', agents: ids.map((id) => ({ id, label: id.toUpperCase() })) });
	// Shape of a real base after editing columns in Obsidian and a buggy earlier ensureAgentColumns.
	const messy = `properties:
  note.agent-claude:
    displayName: Claude Code
  note.agent-cursor:
    displayName: Cursor
views:
  - type: table
    name: Table
    order:
      - file.name
      - agent-claude
      - agent-cursor
      - agent-claude
      - agent-cursor
      - note.agent-claude
      - note.agent-source
`;
	interface B { properties: Record<string, { displayName: string }>; views: { order: string[] }[] }

	it('ensureAgentColumns treats both spellings as one column and removes duplicates', () => {
		const out = ensureAgentColumns(messy, o(['claude', 'cursor']));
		const b = parse(out) as B;
		expect(b.views[0]?.order).toEqual(['formula.agent-skillfile', 'file.name', 'agent-claude', 'agent-cursor', 'note.agent-source', 'agent-delete']);
		expect(ensureAgentColumns(out, o(['claude', 'cursor']))).toBe(out);
	});
	it('new columns use the plain spelling Obsidian writes', () => {
		const b = parse(ensureAgentColumns(messy, o(['claude', 'cursor', 'hermes']))) as B;
		expect(b.views[0]?.order).toContain('agent-hermes');
		expect(b.views[0]?.order).not.toContain('note.agent-hermes');
	});
	it('removeAgentColumn removes both spellings and the display name', () => {
		const out = removeAgentColumn(messy, o(['claude']), 'cursor');
		expect(out).not.toContain('agent-cursor');
		const b = parse(out) as B;
		expect(b.views[0]?.order).toEqual(['file.name', 'agent-claude', 'note.agent-source']);
		expect(b.properties['note.agent-claude']?.displayName).toBe('Claude Code');
	});
});

describe('skill link formula', () => {
	const o = { hubFolder: 'AI/skills', prefix: 'agent-', agents: [{ id: 'claude', label: 'Claude' }] };
	interface B { formulas: Record<string, string>; properties: Record<string, { displayName: string }>; views: { order: string[] }[] }
	const FORMULA = 'file.asLink(file.folder.replace("AI/skills/", ""))';
	it('is the first column of a new base, displayed as Skill', () => {
		const b = parse(defaultBase(o)) as B;
		expect(b.formulas['agent-skillfile']).toBe(FORMULA);
		expect(b.properties['formula.agent-skillfile']?.displayName).toBe('Skill');
		expect(b.views[0]?.order[0]).toBe('formula.agent-skillfile');
		expect(b.formulas['skill']).toBeUndefined();
	});
	it('is added first to every table view of an existing base, once', () => {
		const existing = 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - description\n';
		const once = ensureAgentColumns(existing, o);
		expect(ensureAgentColumns(once, o)).toBe(once);
		const b = parse(once) as B;
		expect(b.formulas['agent-skillfile']).toBe(FORMULA);
		expect(b.properties['formula.agent-skillfile']?.displayName).toBe('Skill');
		expect(b.views[0]?.order.slice(0, 3)).toEqual(['formula.agent-skillfile', 'file.name', 'description']);
	});
	it('keeps a user-edited formula and position', () => {
		const custom = 'formulas:\n  agent-skillfile: file.asLink("x")\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - formula.agent-skillfile\n';
		const b = parse(ensureAgentColumns(custom, o)) as B;
		expect(b.formulas['agent-skillfile']).toBe('file.asLink("x")');
		expect(b.views[0]?.order.slice(0, 2)).toEqual(['file.name', 'formula.agent-skillfile']);
	});
});

describe('managed view', () => {
	const two = `views:
  - type: table
    name: Mine
    order:
      - file.name
  - type: table
    name: Other
    order:
      - file.name
`;
	const o = (view?: string) => ({ hubFolder: 'Skills', prefix: 'agent-', agents: [{ id: 'claude', label: 'Claude' }], view });
	interface B { views: { name: string; order: string[] }[] }
	it('adds columns only to the chosen view', () => {
		const b = parse(ensureAgentColumns(two, o('Other'))) as B;
		expect(b.views[0]?.order).toEqual(['file.name']);
		expect(b.views[1]?.order).toContain('agent-claude');
	});
	it('defaults to the first table view when none (or an unknown one) is chosen', () => {
		for (const view of [undefined, '', 'Gone']) {
			const b = parse(ensureAgentColumns(two, o(view))) as B;
			expect(b.views[0]?.order).toContain('agent-claude');
			expect(b.views[1]?.order).toEqual(['file.name']);
		}
	});
	it('lists table views for the selector', async () => {
		const { listTableViews } = await import('../src/core/base');
		expect(listTableViews(two)).toEqual(['Mine', 'Other']);
		expect(listTableViews('not: [valid')).toEqual([]);
	});
});

describe('isUnavailableColumn', () => {
	it('greys agent and project columns not available here, never plugin columns or other properties', async () => {
		const { isUnavailableColumn } = await import('../src/core/base');
		const avail = ['claude', 'myapp'];
		expect(isUnavailableColumn('note.agent-hermes', 'agent-', avail)).toBe(true);
		expect(isUnavailableColumn('note.agent-claude', 'agent-', avail)).toBe(false);
		expect(isUnavailableColumn('note.agent-myapp', 'agent-', avail)).toBe(false);
		for (const meta of ['source', 'skill-keys', 'path', 'folder', 'conflict']) expect(isUnavailableColumn(`note.agent-${meta}`, 'agent-', avail)).toBe(false);
		expect(isUnavailableColumn('note.description', 'agent-', avail)).toBe(false);
		expect(isUnavailableColumn('formula.agent-skillfile', 'agent-', avail)).toBe(false);
	});
});

describe('Delete column', () => {
	const o = (ids: string[]) => ({ hubFolder: 'Skills', prefix: 'agent-', agents: ids.map((id) => ({ id, label: id })) });
	interface B { properties: Record<string, { displayName: string }>; views: { name: string; order: string[]; filters?: { and?: string[] } }[] }
	it('is the last column of a new base, with a To delete view', () => {
		const b = parse(defaultBase(o(['claude']))) as B;
		expect(b.views[0]?.order.at(-1)).toBe('agent-delete');
		expect(b.properties['note.agent-delete']?.displayName).toBe('To Delete');
		expect(b.views.find((v) => v.name === 'To delete')?.filters?.and).toEqual(['note["agent-delete"] == true']);
	});
	it('stays last when the base is updated with new agents', () => {
		const first = ensureAgentColumns('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n', o(['claude']));
		expect((parse(first) as B).views[0]?.order.at(-1)).toBe('agent-delete');
		const second = ensureAgentColumns(first, o(['claude', 'codex']));
		const order = (parse(second) as B).views[0]?.order ?? [];
		expect(order.at(-1)).toBe('agent-delete');
		expect(order).toContain('agent-codex');
	});
});

describe('folder-differs formula (hidden)', () => {
	const o = { hubFolder: 'AI/skills', prefix: 'agent-', agents: [{ id: 'claude', label: 'Claude' }] };
	interface B { formulas: Record<string, string>; properties: Record<string, { displayName: string }>; views: { order: string[] }[] }
	const F = 'if(note["agent-folder"], note["agent-folder"] != file.folder.replace("AI/skills/", ""), false)';
	it('is defined in new and existing bases but in no view', () => {
		for (const text of [defaultBase(o), ensureAgentColumns('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n', o)]) {
			const b = parse(text) as B;
			expect(b.formulas['agent-folder-differs']).toBe(F);
			expect(b.properties['formula.agent-folder-differs']?.displayName).toBe('Renamed or split');
			for (const v of b.views) expect(v.order).not.toContain('formula.agent-folder-differs');
		}
	});
});

describe('To Delete display name', () => {
	it('renames the old "Delete" name, keeps a custom one', () => {
		const o = { hubFolder: 'Skills', prefix: 'agent-', agents: [] };
		const old = 'properties:\n  note.agent-delete:\n    displayName: Delete\nviews: []\n';
		expect((parse(ensureAgentColumns(old, o)) as { properties: Record<string, { displayName: string }> }).properties['note.agent-delete']?.displayName).toBe('To Delete');
		const custom = old.replace('displayName: Delete', 'displayName: Bin');
		expect((parse(ensureAgentColumns(custom, o)) as { properties: Record<string, { displayName: string }> }).properties['note.agent-delete']?.displayName).toBe('Bin');
	});
});
