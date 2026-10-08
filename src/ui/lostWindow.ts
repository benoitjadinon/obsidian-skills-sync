import type { Modal } from 'obsidian';

/**
 * A dialog the sync waits on can vanish without closing (e.g. it opened in a popout window that was
 * then closed). Check every 2 s and call onLost once if its window is gone, so the sync never waits
 * forever. Returns a function that stops checking (call it when the dialog closes normally).
 */
export function guardLostWindow(modal: Modal, onLost: () => void): () => void {
	const id = window.setInterval(() => {
		const el = modal.containerEl;
		const win = el.ownerDocument.defaultView;
		if (!win || win.closed || !el.isConnected) {
			window.clearInterval(id);
			onLost();
		}
	}, 2000);
	return () => window.clearInterval(id);
}
