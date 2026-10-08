import type { Setting, TextComponent } from 'obsidian';

/** Show (or clear) an inline error under a setting and outline its input. */
export function showFieldError(setting: Setting, input: TextComponent | undefined, error: string | null): void {
	let el = setting.descEl.querySelector<HTMLElement>('.ash-field-error');
	if (error) {
		if (!el) el = setting.descEl.createDiv({ cls: 'ash-field-error' });
		el.setText(error);
	} else {
		el?.remove();
	}
	input?.inputEl.toggleClass('ash-invalid', error !== null);
}
