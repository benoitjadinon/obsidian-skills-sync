import { describe, expect, it } from 'vitest';
import { emptyMeta, newSkillText, readMeta, setMeta, toAgentText, toVaultText } from '../src/core/frontmatter';

const P = 'agent-';
const ORDER = ['claude', 'codex', 'gemini'];
const imported = (agentText: string, existing: string | null = null) =>
	toVaultText(agentText, existing, P, { ...emptyMeta(), states: { claude: true } }, ORDER);

describe('round trip agent → vault → agent is byte-identical', () => {
	const cases: Record<string, string> = {
		'no frontmatter': '# Plain\n\nbody\n',
		'name + description': '---\nname: x\ndescription: Does x\n---\n# X\n',
		'multi-line and quoted values': '---\nname: x\ndescription: >-\n  folded\n  text: with colon\nurl: "http://a:b"\ntags:\n  - one\n  - two\n---\n\nBody\n',
		'CRLF': '---\r\nname: x\r\ndescription: y\r\n---\r\n# X\r\n',
		'leading comment': '---\n# comment\nname: x\n---\nb\n',
	};
	for (const [label, text] of Object.entries(cases)) {
		it(label, () => {
			expect(toAgentText(imported(text), P)).toBe(text);
		});
	}
});

describe('toVaultText', () => {
	it('adds plugin keys after the skill keys, tri-state, in agent order', () => {
		const v = imported('---\nname: x\n---\nb\n');
		expect(v).toBe('---\nname: x\nagent-skill-keys: [name]\nagent-claude: true\nagent-codex:\nagent-gemini:\n---\nb\n');
	});
	it('records [] when the original had no frontmatter', () => {
		expect(imported('b\n')).toContain('agent-skill-keys: []\n');
	});
	it('keeps user keys and states, picks up new skill keys', () => {
		const v1 = imported('---\nname: x\ndescription: d\n---\nold\n').replace('agent-skill-keys', 'rating: 5\nagent-skill-keys');
		const meta = readMeta(v1, P);
		const v2 = toVaultText('---\nname: x\ndescription: d\nversion: 2\n---\nnew\n', v1, P, meta, ORDER);
		expect(v2).toContain('rating: 5\n');
		expect(readMeta(v2, P).skillKeys).toEqual(['name', 'description', 'version']);
		expect(readMeta(v2, P).states).toEqual({ claude: true, codex: null, gemini: null });
		expect(toAgentText(v2, P)).toBe('---\nname: x\ndescription: d\nversion: 2\n---\nnew\n');
	});
});

describe('toAgentText', () => {
	it('never exports user or plugin keys', () => {
		const v = imported('---\nname: x\n---\nb\n').replace('agent-skill-keys', 'rating: 5\nagent-skill-keys');
		expect(toAgentText(v, P)).toBe('---\nname: x\n---\nb\n');
	});
	it('exports edited skill key values', () => {
		const v = imported('---\nname: x\ndescription: old\n---\nb\n').replace('description: old', 'description: new');
		expect(toAgentText(v, P)).toBe('---\nname: x\ndescription: new\n---\nb\n');
	});
	it('treats every non-plugin key as a skill key when skill-keys is absent', () => {
		expect(toAgentText('---\nname: x\nfoo: 1\nagent-claude: true\n---\nb\n', P)).toBe('---\nname: x\nfoo: 1\n---\nb\n');
	});
	it('reads block-style skill-keys written by Obsidian', () => {
		const v = '---\nname: x\nrating: 1\nagent-skill-keys:\n  - name\nagent-claude: true\n---\nb\n';
		expect(toAgentText(v, P)).toBe('---\nname: x\n---\nb\n');
	});
});

describe('readMeta', () => {
	it('parses tri-state, path, folder, conflict', () => {
		const m = readMeta('---\nagent-claude: true\nagent-codex: false\nagent-gemini:\nagent-path: "A/B"\nagent-folder: plan\nagent-conflict: true\n---\n', P);
		expect(m.states).toEqual({ claude: true, codex: false, gemini: null });
		expect(m.path).toBe('A/B');
		expect(m.folder).toBe('plan');
		expect(m.conflict).toBe(true);
	});
});

describe('setMeta', () => {
	it('replaces plugin lines and keeps everything else', () => {
		const v = imported('---\nname: x\n---\nb\n').replace('agent-skill-keys', 'rating: 5\nagent-skill-keys');
		const out = setMeta(v, { ...readMeta(v, P), states: { claude: false, codex: true, gemini: null } }, P, ORDER);
		expect(out).toBe('---\nname: x\nrating: 5\nagent-skill-keys: [name]\nagent-claude: false\nagent-codex: true\nagent-gemini:\n---\nb\n');
	});
});

describe('newSkillText', () => {
	it('creates a skill with every agent undecided', () => {
		const v = newSkillText('my-new', 'Does new things', P, ORDER);
		expect(toAgentText(v, P)).toBe('---\nname: my-new\ndescription: "Does new things"\n---\n\n# my-new\n');
		expect(readMeta(v, P).states).toEqual({ claude: null, codex: null, gemini: null });
	});
});

describe('propertyDiff', () => {
	it('lists the properties whose values differ (by value, not formatting), in order', async () => {
		const { propertyDiff } = await import('../src/core/frontmatter');
		const a = '---\nname: x\ndescription: "Old text"\ntags: [a, b]\nversion: 1\n---\nbody\n';
		const b = '---\nname: x\ndescription: New text\ntags:\n  - a\n  - b\nlicense: MIT\n---\nbody\n';
		expect(propertyDiff(a, b)).toEqual([
			{ key: 'description', left: 'Old text', right: 'New text' },
			{ key: 'version', left: '1', right: undefined },
			{ key: 'license', left: undefined, right: 'MIT' },
		]);
		expect(propertyDiff('no frontmatter', '---\nname: y\n---\n')).toEqual([{ key: 'name', left: undefined, right: 'y' }]);
		expect(propertyDiff(a, a)).toEqual([]);
	});
});
