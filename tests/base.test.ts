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
		expect(b.views.map((v) => v.name)).toEqual(['All skills', 'Undecided', 'Unassigned', 'Conflicts']);
		expect(b.views[0]?.order).toEqual(['formula.skill', 'description', 'agent-claude', 'agent-codex', 'agent-source', 'agent-path']);
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
		expect(b.views[0]?.order).toEqual(['file.name', 'name', 'description', 'agent-claude', 'agent-source']);
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
		expect(b.views[0]?.order).toEqual(['file.name', 'agent-claude', 'agent-cursor', 'note.agent-source']);
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
