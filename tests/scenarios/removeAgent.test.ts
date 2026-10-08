import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultBase, removeAgentColumn } from '../../src/core/base';
import { readMeta } from '../../src/core/frontmatter';
import { removeAgentFromNotes } from '../../src/core/sync';
import { T0, skillMd } from '../helpers';
import { world } from './harness';

describe('removeAgentFromNotes', () => {
	it('deletes the agent property from every skill note and nothing else', async () => {
		const w = world([{ id: 'claude' }, { id: 'codex' }]);
		w.put('vault', {
			'a/SKILL.md': w.vaultMd(skillMd('a'), { claude: true, codex: false }, 'rating: 5\n'),
			'b/SKILL.md': w.vaultMd(skillMd('b'), { claude: null, codex: true }),
		}, T0);
		w.put('codex', { 'b/SKILL.md': skillMd('b') }, T0);
		// The agent was removed from settings first: the config no longer lists it.
		const remaining = { ...w.cfg, agents: w.cfg.agents.filter((a) => a.id !== 'codex') };
		const changed = await removeAgentFromNotes(remaining, 'codex');
		expect(changed.sort()).toEqual(['a', 'b']);
		const a = w.tree('vault')['a/SKILL.md'] ?? '';
		expect(a).not.toContain('agent-codex');
		expect(a).toContain('rating: 5\n');
		expect(readMeta(a, 'agent-').states).toEqual({ claude: true });
		expect(w.tree('codex')['b/SKILL.md']).toBe(skillMd('b'));
		expect(await removeAgentFromNotes(remaining, 'codex')).toEqual([]);
	});
});

describe('removeAgentColumn', () => {
	it('drops the property, the columns and the managed filters of that agent', () => {
		const o = (ids: string[]) => ({ hubFolder: 'Skills', prefix: 'agent-', agents: ids.map((id) => ({ id, label: id })) });
		const text = removeAgentColumn(defaultBase(o(['claude', 'codex'])), o(['claude']), 'codex');
		expect(text).not.toContain('agent-codex');
		interface B { properties: Record<string, unknown>; views: { name: string; order: string[]; filters?: { or?: string[] } }[] }
		const b = parse(text) as B;
		expect(Object.keys(b.properties)).toContain('note.agent-claude');
		expect(b.views.find((v) => v.name === 'Undecided')?.filters?.or).toEqual(['note["agent-claude"] == null']);
	});
});
