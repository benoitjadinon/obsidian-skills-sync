import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultBase, ensureAgentColumns } from '../src/core/base';

const opts = (ids: string[]) => ({ hubFolder: 'Skills', prefix: 'agent-', agents: ids.map((id) => ({ id, label: id.toUpperCase() })) });

interface View { name: string; order: string[]; filters?: { or?: string[]; and?: string[] } }
interface Base { filters: { and: string[] }; properties: Record<string, { displayName: string }>; views: View[] }

describe('defaultBase', () => {
	it('lists SKILL.md files of the hub with one column per agent', () => {
		const b = parse(defaultBase(opts(['claude', 'codex']))) as Base;
		expect(b.filters.and).toEqual(['file.inFolder("Skills")', 'file.name == "SKILL"']);
		expect(b.properties['note.agent-claude']?.displayName).toBe('CLAUDE');
		expect(b.views.map((v) => v.name)).toEqual(['All skills', 'Undecided', 'Unassigned', 'Conflicts']);
		expect(b.views[0]?.order).toEqual(['formula.skill', 'description', 'note.agent-claude', 'note.agent-codex', 'note.agent-source', 'note.agent-path']);
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
		expect(b.views[0]?.order).toEqual(['file.name', 'name', 'description', 'note.agent-claude', 'note.agent-source']);
	});
	it('refreshes the managed Undecided and Unassigned filters when agents are added', () => {
		const b = parse(ensureAgentColumns(defaultBase(opts(['claude'])), opts(['claude', 'hermes']))) as Base;
		expect(b.views.find((v) => v.name === 'Undecided')?.filters?.or).toEqual(['note["agent-claude"] == null', 'note["agent-hermes"] == null']);
		expect(b.views.find((v) => v.name === 'Unassigned')?.filters?.and).toHaveLength(2);
	});
});
