import { describe, expect, it } from 'vitest';
import { localeFromSystem } from '../src/core/dates';

describe('localeFromSystem', () => {
	it('applies a macOS region override (language en, region Belgium)', () => {
		expect(localeFromSystem('en-US@rg=bezzzz')).toBe('en-BE');
		expect(localeFromSystem('en_US@rg=bezzzz')).toBe('en-BE');
	});
	it('keeps plain locales and normalises underscores', () => {
		expect(localeFromSystem('fr-BE')).toBe('fr-BE');
		expect(localeFromSystem('de_DE')).toBe('de-DE');
	});
	it('falls back for empty or invalid values', () => {
		expect(localeFromSystem('', 'en-GB')).toBe('en-GB');
		expect(localeFromSystem('!!!', 'en-GB')).toBe('en-GB');
	});
});
