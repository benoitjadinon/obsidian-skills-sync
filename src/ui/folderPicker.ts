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
