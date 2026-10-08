import { App, type ButtonComponent, Modal, Setting } from 'obsidian';
import { validateSkillName } from '../core/validate';
import { showFieldError } from './fieldErrors';
import type { MigrationItem } from '../core/sync';

export class ConfirmModal extends Modal {
	private answer = false;
	private done: (ok: boolean) => void = () => undefined;

	constructor(app: App, private readonly heading: string, private readonly message: string, private readonly confirmText: string) {
		super(app);
	}

	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.done = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(this.confirmText).setCta().onClick(() => {
				this.answer = true;
				this.close();
			}))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.answer);
	}
}

export class MigrationModal extends ConfirmModal {
	constructor(app: App, private readonly items: MigrationItem[]) {
		super(
			app,
			'Replace symlinks with copies',
			`${items.length} skill folder${items.length === 1 ? ' is a symlink' : 's are symlinks'}. Skills Sync syncs real copies; replace them now?`,
			'Replace with copies',
		);
	}

	onOpen(): void {
		super.onOpen();
		const list = this.contentEl.createDiv({ cls: 'ash-migration-list' });
		for (const it of this.items) list.createDiv({ text: `${it.agent}: ${it.linkPath} → ${it.target}` });
		this.contentEl.prepend(list);
	}
}

export class NewSkillModal extends Modal {
	private name = '';
	private description = '';

	constructor(
		app: App,
		/** Names of existing skill folders, to refuse duplicates. */
		private readonly existing: string[],
		private readonly onSubmit: (name: string, description: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('New skill');
		let create: ButtonComponent | undefined;
		const name = new Setting(this.contentEl).setName('Name').setDesc('Folder name, for example my-skill.');
		const check = (): string | null => validateSkillName(this.name, this.existing);
		name.addText((t) => t.onChange((v) => {
			this.name = v.trim();
			const error = check();
			showFieldError(name, t, this.name ? error : null);
			create?.setDisabled(error !== null);
		}));
		new Setting(this.contentEl).setName('Description').setDesc('When an agent should use this skill.').addTextArea((t) => t.onChange((v) => (this.description = v.trim())));
		new Setting(this.contentEl).addButton((b) => {
			create = b;
			b.setButtonText('Create').setCta().setDisabled(true).onClick(() => {
				if (check() !== null) return;
				this.close();
				this.onSubmit(this.name, this.description);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
