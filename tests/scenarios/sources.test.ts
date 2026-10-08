import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultBase, ensureAgentColumns } from '../../src/core/base';
import { planGroup } from '../../src/core/engine';
import { emptyMeta, newSkillText, readMeta, setMeta, toAgentText, toVaultText } from '../../src/core/frontmatter';
import type { SkillCopy, SyncConfig } from '../../src/core/model';
import { fillMissingSources, runSync } from '../../src/core/sync';
import { T0, skillMd } from '../helpers';
import { keep, StubResolver, world } from './harness';

const P = 'agent-';

describe('agent-source in frontmatter', () => {
	it('reads flow and block lists, absent → null', () => {
		expect(readMeta('---\nagent-source: [hermes, claude]\n---\n', P).sources).toEqual(['hermes', 'claude']);
		expect(readMeta('---\nagent-source:\n  - hermes\n---\n', P).sources).toEqual(['hermes']);
		expect(readMeta('---\nname: x\n---\n', P).sources).toBeNull();
	});
	it('is rendered when set, never exported, and survives toVaultText', () => {
		const v = toVaultText('---\nname: x\n---\nb\n', null, P, { ...emptyMeta(), sources: ['hermes'] }, ['claude']);
		expect(v).toContain('agent-source: [hermes]\n');
		expect(toAgentText(v, P)).toBe('---\nname: x\n---\nb\n');
		const v2 = toVaultText('---\nname: x\n---\nnew\n', v, P, readMeta(v, P), ['claude']);
		expect(readMeta(v2, P).sources).toEqual(['hermes']);
	});
	it('keeps a user-edited list through setMeta', () => {
		const v = '---\nname: x\nagent-skill-keys: [name]\nagent-source: [hermes, claude]\nagent-claude: true\n---\nb\n';
		const out = setMeta(v, { ...readMeta(v, P), states: { claude: false } }, P, ['claude']);
		expect(readMeta(out, P).sources).toEqual(['hermes', 'claude']);
	});
	it('new skills start with an empty source list', () => {
		expect(readMeta(newSkillText('n', 'd', P, ['claude']), P).sources).toEqual([]);
	});
});

describe('engine import records every holder, archived included', () => {
	it('lists sources in agent order', () => {
		const cfg: SyncConfig = {
			hubDir: '/h', prefix: P, autoPullExternal: 'ask',
			agents: ['claude', 'hermes'].map((id) => ({ id, label: id, path: `/${id}`, kind: 'agent', layout: 'flat', archiveDir: '.archive' })),
		};
		const c = (owner: string, archived: boolean): SkillCopy => ({
			owner, archived, key: 'k', mtimeMs: 0, dir: `/${owner}/x`, folder: 'x', relPath: '', files: new Map(),
		});
		const [a] = planGroup({ name: 'x', copies: [c('hermes', false), c('claude', true)] }, cfg);
		if (a?.type !== 'import') throw new Error('expected import');
		expect(a.sources).toEqual(['claude', 'hermes']);
	});
});

describe('scenario: source is remembered across syncs', () => {
	it('is set on import and survives a pull and an untick', async () => {
		const w = world([{ id: 'claude' }, { id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
		w.put('hermes', { 'tools/x/SKILL.md': skillMd('x') }, T0);
		await runSync(w.cfg, new StubResolver());
		const raw = () => w.tree('vault')['x/SKILL.md'] ?? '';
		expect(readMeta(raw(), P).sources).toEqual(['hermes']);

		// Single ticked agent: the newer side wins, so the external update must be newer than the import.
		w.put('hermes', { 'tools/x/SKILL.md': skillMd('x', '# v2\n') }, new Date(Date.now() + 60_000));
		await runSync(w.cfg, new StubResolver(keep('hermes')));
		expect(raw()).toContain('# v2');
		expect(readMeta(raw(), P).sources).toEqual(['hermes']);

		w.put('vault', { 'x/SKILL.md': setMeta(raw(), { ...readMeta(raw(), P), states: { claude: null, hermes: false } }, P, ['claude', 'hermes']) });
		await runSync(w.cfg, new StubResolver());
		expect(readMeta(raw(), P).sources).toEqual(['hermes']);
	});
});

describe('fillMissingSources', () => {
	it('sets current holders only on notes without agent-source', async () => {
		const w = world([{ id: 'claude' }, { id: 'hermes', layout: 'nested', archiveDir: '.archive' }]);
		w.put('vault', {
			'a/SKILL.md': w.vaultMd(skillMd('a'), { claude: true, hermes: false }),
			'b/SKILL.md': w.vaultMd(skillMd('b'), { claude: true, hermes: null }).replace('agent-claude', 'agent-source: [codex]\nagent-claude'),
		}, T0);
		w.put('claude', { 'a/SKILL.md': skillMd('a'), 'b/SKILL.md': skillMd('b') }, T0);
		w.put('hermes', { '.archive/a/SKILL.md': skillMd('a') }, T0);
		const changed = await fillMissingSources(w.cfg);
		expect(changed).toEqual(['a']);
		expect(readMeta(w.tree('vault')['a/SKILL.md'] ?? '', P).sources).toEqual(['claude', 'hermes']);
		expect(readMeta(w.tree('vault')['b/SKILL.md'] ?? '', P).sources).toEqual(['codex']);
		expect(await fillMissingSources(w.cfg)).toEqual([]);
	});
});

describe('base Source column', () => {
	const o = { hubFolder: 'Skills', prefix: P, agents: [{ id: 'claude', label: 'Claude' }] };
	interface B { properties: Record<string, { displayName: string }>; views: { order: string[] }[] }
	it('is in the default base', () => {
		const b = parse(defaultBase(o)) as B;
		expect(b.properties['note.agent-source']?.displayName).toBe('Source');
		expect(b.views[0]?.order).toContain('agent-source');
	});
	it('is added to existing bases once', () => {
		const existing = 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n';
		const once = ensureAgentColumns(existing, o);
		expect(ensureAgentColumns(once, o)).toBe(once);
		const b = parse(once) as B;
		expect(b.properties['note.agent-source']?.displayName).toBe('Source');
		expect(b.views[0]?.order).toEqual(['formula.agent-skillfile', 'file.name', 'agent-claude', 'agent-source', 'agent-delete']);
	});
});
