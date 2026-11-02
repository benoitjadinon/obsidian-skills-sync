import { describe, expect, it } from 'vitest';
import { formatAgentNote, isAgentAvailable, isAgentForDevice, parseAgentNote, stateKeyForAgent } from '../src/core/agentNotes';
import type { AgentConfig } from '../src/core/model';

describe('stateKeyForAgent', () => {
	it('returns bare id-device for single device', () => {
		expect(stateKeyForAgent('codex', ['macbook'])).toBe('codex-macbook');
	});

	it('returns bare id for multiple devices', () => {
		expect(stateKeyForAgent('codex', ['macbook', 'desktop'])).toBe('codex');
	});

	it('returns bare id for no devices or empty array', () => {
		expect(stateKeyForAgent('codex')).toBe('codex');
		expect(stateKeyForAgent('codex', [])).toBe('codex');
	});
});

describe('parseAgentNote', () => {
	it('parses valid note with single device as array', () => {
		const raw = `---
agent-id: codex
agent-device:
  - macbook
agent-path: ~/.codex/skills
agent-layout: flat
---
# Codex notes
`;
		const parsed = parseAgentNote(raw, 'Codex (macbook).md');
		expect(parsed).not.toBeNull();
		expect(parsed?.id).toBe('codex');
		expect(parsed?.label).toBe('Codex (macbook)');
		expect(parsed?.stateKey).toBe('codex-macbook');
		expect(parsed?.devices).toEqual(['macbook']);
		expect(parsed?.path).toBe('~/.codex/skills');
		expect(parsed?.layout).toBe('flat');
	});

	it('parses note with single device as scalar string', () => {
		const raw = `---
agent-id: hermes
agent-device: macbook
agent-path: ~/.hermes/skills
agent-layout: nested
agent-archive: .archive
---
`;
		const parsed = parseAgentNote(raw, 'Hermes.md');
		expect(parsed).not.toBeNull();
		expect(parsed?.id).toBe('hermes');
		expect(parsed?.stateKey).toBe('hermes-macbook');
		expect(parsed?.devices).toEqual(['macbook']);
		expect(parsed?.layout).toBe('nested');
		expect(parsed?.archiveDir).toBe('.archive');
	});

	it('parses note without device as shared', () => {
		const raw = `---
agent-id: claude
agent-path: ~/.claude/skills
---
`;
		const parsed = parseAgentNote(raw, 'Claude.md');
		expect(parsed).not.toBeNull();
		expect(parsed?.id).toBe('claude');
		expect(parsed?.stateKey).toBe('claude');
		expect(parsed?.devices).toBeUndefined();
	});

	it('parses note with multiple devices as shared across them', () => {
		const raw = `---
agent-id: claude
agent-device:
  - macbook
  - work-pc
agent-path: ~/.claude/skills
---
`;
		const parsed = parseAgentNote(raw, 'Claude.md');
		expect(parsed).not.toBeNull();
		expect(parsed?.id).toBe('claude');
		expect(parsed?.stateKey).toBe('claude');
		expect(parsed?.devices).toEqual(['macbook', 'work-pc']);
	});

	it('preserves or infers projectDir', () => {
		const rawWithExplicit = `---
agent-id: custom
agent-path: ~/.custom/skills
agent-project-dir: .custom/skills
---
`;
		expect(parseAgentNote(rawWithExplicit, 'Custom.md')?.projectDir).toBe('.custom/skills');

		const rawWithPreset = `---
agent-id: claude
agent-path: ~/.claude/skills
---
`;
		expect(parseAgentNote(rawWithPreset, 'Claude.md')?.projectDir).toBe('.claude/skills');
	});

	it('returns null on invalid YAML or missing required keys', () => {
		expect(parseAgentNote('not frontmatter', 'test.md')).toBeNull();
		expect(parseAgentNote('---\nagent-id: codex\n---\n', 'test.md')).toBeNull(); // missing path
		expect(parseAgentNote('---\nagent-path: ~/.codex\n---\n', 'test.md')).toBeNull(); // missing id
		expect(parseAgentNote('---\nagent-id: delete\nagent-path: ~/.d\n---\n', 'test.md')).toBeNull(); // reserved id
	});
});

describe('formatAgentNote', () => {
	it('formats complete note and roundtrips with parseAgentNote', () => {
		const cfg: AgentConfig = {
			id: 'codex',
			label: 'Codex (macbook)',
			path: '~/.codex/skills',
			kind: 'agent',
			layout: 'flat',
			archiveDir: '.archive',
			devices: ['macbook'],
		};
		const formatted = formatAgentNote(cfg, '# Notes\nSome guide.');
		expect(formatted).toContain('agent-id: codex');
		expect(formatted).toContain('agent-path: ~/.codex/skills');
		expect(formatted).toContain('# Notes\nSome guide.');

		const reparsed = parseAgentNote(formatted, 'Codex (macbook).md');
		expect(reparsed).not.toBeNull();
		expect(reparsed?.id).toBe(cfg.id);
		expect(reparsed?.devices).toEqual(cfg.devices);
		expect(reparsed?.stateKey).toBe('codex-macbook');
	});
});

describe('isAgentForDevice', () => {
	const agentWith = (devices?: string[]): AgentConfig => ({
		id: 'test',
		label: 'test',
		path: '~/.test',
		kind: 'agent',
		layout: 'flat',
		archiveDir: '',
		devices,
	});

	it('returns true when currentDevice is undefined', () => {
		expect(isAgentForDevice(agentWith(['macbook']))).toBe(true);
	});

	it('returns true for shared agents (no devices or empty array)', () => {
		expect(isAgentForDevice(agentWith(), 'macbook')).toBe(true);
		expect(isAgentForDevice(agentWith([]), 'macbook')).toBe(true);
	});

	it('returns true when currentDevice matches', () => {
		expect(isAgentForDevice(agentWith(['macbook']), 'macbook')).toBe(true);
		expect(isAgentForDevice(agentWith(['desktop', 'macbook']), 'macbook')).toBe(true);
	});

	it('returns false when currentDevice does not match', () => {
		expect(isAgentForDevice(agentWith(['desktop']), 'macbook')).toBe(false);
	});
});

describe('isAgentAvailable', () => {
	it('checks both device match and folder existence', () => {
		const agent: AgentConfig = {
			id: 'test',
			label: 'test',
			path: '/mock/path/skills',
			kind: 'agent',
			layout: 'flat',
			archiveDir: '',
			devices: ['macbook'],
		};
		const existsTrue = () => true;
		const existsFalse = () => false;

		// Matches device and folder exists
		expect(isAgentAvailable(agent, 'macbook', existsTrue)).toBe(true);
		// Wrong device even if folder exists
		expect(isAgentAvailable(agent, 'desktop', existsTrue)).toBe(false);
		// Matches device but folder missing
		expect(isAgentAvailable(agent, 'macbook', existsFalse)).toBe(false);
	});
});

