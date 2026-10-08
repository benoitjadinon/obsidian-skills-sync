/**
 * The locale for showing dates, from the system's locale string. macOS reports a region chosen
 * separately from the language as e.g. "en-US@rg=bezzzz" (English, Belgian formats): that becomes
 * "en-BE", so dates follow the region (day before month) while the language stays English.
 */
export function localeFromSystem(raw: string | null | undefined, fallback = 'en'): string {
	const value = (raw ?? '').trim();
	const m = /^([a-z]{2,3})(?:[-_]([a-z]{2}))?(?:@rg=([a-z]{2}))?/i.exec(value);
	if (!m?.[1]) return fallback;
	const region = m[3] ?? m[2];
	const tag = region ? `${m[1].toLowerCase()}-${region.toUpperCase()}` : m[1].toLowerCase();
	try {
		return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 ? tag : fallback;
	} catch {
		return fallback;
	}
}
