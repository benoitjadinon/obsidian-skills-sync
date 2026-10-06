import { describe, expect, it } from 'vitest';
import { isBinary, normalizeText } from '../src/core/normalize';

describe('normalizeText', () => {
	it('treats CRLF, CR and LF the same', () => {
		expect(normalizeText('a\r\nb\rc\n')).toBe(normalizeText('a\nb\nc\n'));
	});
	it('ignores a missing or extra final newline', () => {
		expect(normalizeText('a\nb')).toBe(normalizeText('a\nb\n\n\n'));
	});
	it('ignores trailing whitespace on lines', () => {
		expect(normalizeText('a  \nb\t\n')).toBe(normalizeText('a\nb\n'));
	});
	it('ignores leading blank lines and a BOM', () => {
		expect(normalizeText('﻿\n\na\n')).toBe('a');
	});
	it('collapses blank lines right after the frontmatter', () => {
		expect(normalizeText('---\nname: x\n---\n\n\n# T\n')).toBe(normalizeText('---\nname: x\n---\n# T\n'));
	});
	it('keeps real changes', () => {
		expect(normalizeText('hello world\n')).not.toBe(normalizeText('hello there\n'));
	});
	it('keeps blank lines inside the body', () => {
		expect(normalizeText('a\n\nb\n')).not.toBe(normalizeText('a\nb\n'));
	});
});

describe('isBinary', () => {
	it('detects NUL bytes', () => {
		expect(isBinary(new Uint8Array([0x89, 0x50, 0x00, 0x01]))).toBe(true);
		expect(isBinary(new TextEncoder().encode('plain text'))).toBe(false);
	});
});
