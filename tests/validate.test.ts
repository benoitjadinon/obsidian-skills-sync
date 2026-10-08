import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../src/core/model';
import {
	normalizeIdInput, validateAgentFolder, validateArchiveFolder, validateBasePath, validateHubFolder,
	validateMergeCommand, validatePrefix, validateSkillName,
} from '../src/core/validate';

const agent = (id: string, path: string): AgentConfig => ({ id, label: id, path, kind: 'agent', layout: 'flat', archiveDir: '' });
const HOME = '/home/me';

describe('normalizeIdInput', () => {
	it('lowercases and turns spaces/underscores into dashes, drops other characters', () => {
		expect(normalizeIdInput('My Agent_2!')).toBe('my-agent-2');
		expect(normalizeIdInput('  Été  ')).toBe('t');
	});
});

describe('validateAgentFolder', () => {
	const others = [agent('claude', '~/.claude/skills')];
	it('requires a path', () => expect(validateAgentFolder('', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/required/i));
	it('rejects a folder used by another agent', () => {
		expect(validateAgentFolder('/home/me/.claude/skills', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/already used by claude/i);
	});
	it('rejects the vault skills folder and folders inside or around it', () => {
		expect(validateAgentFolder('/v/Skills', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/vault/);
		expect(validateAgentFolder('/v/Skills/x', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/vault/);
		expect(validateAgentFolder('/v', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/vault/);
	});
	it('rejects relative paths', () => expect(validateAgentFolder('skills', { others, hubDir: '/v/Skills', home: HOME })).toMatch(/absolute/));
	it('accepts a free folder', () => expect(validateAgentFolder('~/.codex/skills', { others, hubDir: '/v/Skills', home: HOME })).toBeNull());
});

describe('validateArchiveFolder', () => {
	const ctx = { skillsFolder: '~/.hermes/skills', others: [agent('claude', '~/.claude/skills')], hubDir: '/v/Skills', home: HOME };
	it('is optional', () => expect(validateArchiveFolder('', ctx)).toBeNull());
	it('accepts relative, ~ and absolute archives', () => {
		expect(validateArchiveFolder('.archive', ctx)).toBeNull();
		expect(validateArchiveFolder('~/archives/hermes', ctx)).toBeNull();
		expect(validateArchiveFolder('/mnt/backup/skills', ctx)).toBeNull();
	});
	it('rejects the skills folder itself, another agent folder and the vault', () => {
		expect(validateArchiveFolder('.', ctx)).toMatch(/skills folder/);
		expect(validateArchiveFolder('~/.claude/skills', ctx)).toMatch(/claude/);
		expect(validateArchiveFolder('/v/Skills', ctx)).toMatch(/vault/);
	});
});

describe('settings fields', () => {
	it('prefix: lowercase letters, digits, dashes or underscores, not empty', () => {
		expect(validatePrefix('agent-')).toBeNull();
		expect(validatePrefix('')).toMatch(/required/i);
		expect(validatePrefix('Agent ')).toMatch(/lowercase/);
		expect(validatePrefix('-x')).toMatch(/start/);
	});
	it('hub folder: vault-relative, not empty, no ..', () => {
		expect(validateHubFolder('AI/skills')).toBeNull();
		expect(validateHubFolder('')).toMatch(/required/i);
		expect(validateHubFolder('../x')).toMatch(/inside the vault/);
		expect(validateHubFolder('/abs')).toMatch(/inside the vault/);
	});
	it('base path: ends with .base', () => {
		expect(validateBasePath('AI/skills.base')).toBeNull();
		expect(validateBasePath('AI/skills.md')).toMatch(/\.base/);
		expect(validateBasePath('../x.base')).toMatch(/inside the vault/);
	});
	it('merge command: needs {result} and at least {ours} and {theirs}', () => {
		expect(validateMergeCommand('code --wait --merge {ours} {theirs} {base} {result}')).toBeNull();
		expect(validateMergeCommand('code {ours} {theirs}')).toMatch(/\{result\}/);
		expect(validateMergeCommand('')).toBeNull(); // optional: no merge tool button
	});
	it('skill name: folder-safe', () => {
		expect(validateSkillName('my-skill', [])).toBeNull();
		expect(validateSkillName('', [])).toMatch(/required/i);
		expect(validateSkillName('a/b', [])).toMatch(/letters/);
		expect(validateSkillName('my-skill', ['my-skill'])).toMatch(/exists/);
	});
});

describe('validateProjectFolder', () => {
	it('needs an existing folder, outside the vault skills folder, not used by another project', async () => {
		const { validateProjectFolder } = await import('../src/core/validate');
		const { mkdtempSync } = await import('fs');
		const { tmpdir } = await import('os');
		const { join } = await import('path');
		const real = mkdtempSync(join(tmpdir(), 'ash-proj-'));
		const ctx = { hubDir: '/v/Skills', others: [{ id: 'a', label: 'A', root: '/work/a', perAgentColumns: false }], home: HOME };
		expect(validateProjectFolder('', ctx)).toMatch(/required/i);
		expect(validateProjectFolder('relative/path', ctx)).toMatch(/absolute/);
		expect(validateProjectFolder(join(real, 'missing'), ctx)).toMatch(/doesn't exist/);
		expect(validateProjectFolder('/work/a', ctx)).toMatch(/already a project/);
		expect(validateProjectFolder('/v', ctx)).toMatch(/vault/);
		expect(validateProjectFolder(real, ctx)).toBeNull();
	});
});

describe('validateProjectDir', () => {
	it('is optional and relative to the project, without ..', async () => {
		const { validateProjectDir } = await import('../src/core/validate');
		expect(validateProjectDir('')).toBeNull();
		expect(validateProjectDir('.claude/skills')).toBeNull();
		expect(validateProjectDir('/abs/skills')).toMatch(/relative/);
		expect(validateProjectDir('~/skills')).toMatch(/relative/);
		expect(validateProjectDir('../x')).toMatch(/inside/);
	});
});
