import { Notice, type Setting, type TextComponent } from 'obsidian';


interface OpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}

interface ElectronDialog {
	showOpenDialog(options: { title?: string; defaultPath?: string; properties: string[] }): Promise<OpenDialogResult>;
}

function nativeDialog(): ElectronDialog | null {
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = req?.('electron') as { remote?: { dialog?: ElectronDialog } } | undefined;
		return electron?.remote?.dialog ?? null;
	} catch {
		return null;
	}
}

export function canPickFolder(): boolean {
	return nativeDialog() !== null;
}

/** Open the OS folder picker. Resolves to the chosen absolute path, or null when cancelled/unavailable. */
export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
	const dialog = nativeDialog();
	if (!dialog) return null;
	const r = await dialog.showOpenDialog({
		title,
		defaultPath,
		properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
	});
	return r.canceled ? null : (r.filePaths[0] ?? null);
}

/**
 * Adds a folder button next to a path text field: the native picker fills the field,
 * typing or pasting a path still works.
 */
export function addFolderBrowse(
	setting: Setting,
	text: () => TextComponent | undefined,
	title: string,
	io: { toAbs: (value: string) => string; fromAbs: (abs: string) => string | null },
): void {
	setting.addExtraButton((b) => b.setIcon('folder-open').setTooltip('Choose folder').onClick(async () => {
		const t = text();
		if (!t) return;
		if (!canPickFolder()) return void new Notice('The folder picker is not available; type the path instead.');
		const current = t.getValue().trim();
		const picked = await pickFolder(title, current ? io.toAbs(current) : undefined);
		if (picked === null) return;
		const value = io.fromAbs(picked);
		if (value === null) return;
		t.setValue(value);
		t.onChanged();
	}));
}
