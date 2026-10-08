import { mkdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { detectPresets, expandHome, slugify, validateAgentId } from '../src/core/agents';
import { tmp } from './helpers';

describe('agents helpers', () => {
	it('expands ~', () => {
		expect(expandHome('~/x/y', '/h')).toBe(join('/h', 'x/y'));
		expect(expandHome('/abs', '/h')).toBe('/abs');
	});
	it('slugifies labels', () => {
		expect(slugify('Foo (Claude)')).toBe('foo-claude');
	});
	it('validates ids', () => {
		expect(validateAgentId('skill-keys', [])).toMatch(/reserved/);
		expect(validateAgentId('Bad Id', [])).toMatch(/lowercase/);
		expect(validateAgentId('claude', [{ id: 'claude', label: '', path: '', kind: 'agent', layout: 'flat', archiveDir: '' }])).toMatch(/exists/);
		expect(validateAgentId('foo-claude', [])).toBeNull();
	});
	it('detects installed presets, Hermes as nested with archive', () => {
		const home = tmp();
		mkdirSync(join(home, '.claude/skills'), { recursive: true });
		mkdirSync(join(home, '.hermes/skills'), { recursive: true });
		const found = detectPresets(home);
		expect(found.map((a) => a.id)).toEqual(['claude', 'hermes']);
		expect(found[1]).toMatchObject({ layout: 'nested', archiveDir: '.archive' });
	});
});

describe('contractHome', () => {
	it('shortens paths under home to ~ and leaves others alone', async () => {
		const { contractHome } = await import('../src/core/agents');
		expect(contractHome(join('/h', '.claude/skills'), '/h')).toBe('~/.claude/skills');
		expect(contractHome('/h', '/h')).toBe('~');
		expect(contractHome('/hx/y', '/h')).toBe('/hx/y');
		expect(contractHome('/opt/skills', '/h')).toBe('/opt/skills');
	});
});

describe('generated presets', () => {
	it('come from the generated table with our overrides applied', async () => {
		const { PRESETS, validateAgentId } = await import('../src/core/agents');
		expect(PRESETS.length).toBeGreaterThan(50);
		const by = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
		expect(by['claude']).toMatchObject({ label: 'Claude Code', path: '~/.claude/skills', layout: 'flat' });
		expect(by['gemini']?.path).toBe('~/.gemini/skills');
		expect(by['hermes']).toMatchObject({ path: '~/.hermes/skills', layout: 'nested', archiveDir: '.archive' });
		expect(by['agents']).toMatchObject({ label: 'Shared agents folder', path: '~/.agents/skills' });
		expect(by['claude-code']).toBeUndefined();
	});
	it('have valid, unique ids and unique paths', async () => {
		const { PRESETS, validateAgentId } = await import('../src/core/agents');
		const ids = new Set<string>();
		for (const p of PRESETS) {
			expect(validateAgentId(p.id, [])).toBeNull();
			ids.add(p.id);
		}
		expect(ids.size).toBe(PRESETS.length);
		expect(new Set(PRESETS.map((p) => p.path)).size).toBe(PRESETS.length);
	});
	it('availablePresets hides configured folders and lists installed ones first', async () => {
		const { availablePresets } = await import('../src/core/agents');
		const home = tmp();
		mkdirSync(join(home, '.hermes/skills'), { recursive: true });
		mkdirSync(join(home, '.codex/skills'), { recursive: true });
		const configured = [{ id: 'my-codex', label: 'x', path: '~/.codex/skills', kind: 'agent' as const, layout: 'flat' as const, archiveDir: '' }];
		const list = availablePresets(configured, home);
		expect(list.some((p) => p.preset.path === '~/.codex/skills')).toBe(false);
		expect(list[0]).toMatchObject({ installed: true, preset: { id: 'hermes' } });
		expect(list[1]?.installed).toBe(false);
	});
});

describe('archiveRoot', () => {
	it('resolves relative, ~ and absolute archive folders', async () => {
		const { archiveRoot } = await import('../src/core/agents');
		const a = { id: 'h', label: 'H', path: '/agents/h', kind: 'agent' as const, layout: 'nested' as const, archiveDir: '' };
		expect(archiveRoot(a)).toBeNull();
		expect(archiveRoot({ ...a, archiveDir: '.archive' })).toBe(join('/agents/h', '.archive'));
		expect(archiveRoot({ ...a, archiveDir: '../h-archive' })).toBe(join('/agents', 'h-archive'));
		expect(archiveRoot({ ...a, archiveDir: '/backups/skills' }, '/home/me')).toBe('/backups/skills');
		expect(archiveRoot({ ...a, archiveDir: '~/Archive/skills' }, '/home/me')).toBe(join('/home/me', 'Archive/skills'));
	});
});
