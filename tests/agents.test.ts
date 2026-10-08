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
