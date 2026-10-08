import { localeFromSystem } from '../core/dates';

let cached: string | null = null;

/** This computer's date locale: the system region (Electron), else the browser language. */
function dateLocale(): string {
	if (cached) return cached;
	let raw: string | null = null;
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = req?.('electron') as { remote?: { app?: { getSystemLocale?: () => string } } } | undefined;
		raw = electron?.remote?.app?.getSystemLocale?.() ?? null;
	} catch {
		raw = null;
	}
	cached = localeFromSystem(raw ?? navigator.language, navigator.language || 'en');
	return cached;
}

/** A date and time in this computer's regional format, e.g. "09 Oct 2026, 07:05" in Belgium. */
export function formatDateTime(ms: number): string {
	return new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}
