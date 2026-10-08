import { App, type ButtonComponent, Modal, Setting } from 'obsidian';
import { validateSkillName } from '../core/validate';
import { guardLostWindow } from './lostWindow';
import { showFieldError } from './fieldErrors';
import type { MigrationItem } from '../core/sync';

export class ConfirmModal extends Modal {
	private answer = false;
	private done: (ok: boolean) => void = () => undefined;
	private stopGuard: () => void = () => undefined;

	constructor(app: App, private readonly heading: string, private readonly message: string | string[], private readonly confirmText: string) {
		super(app);
	}

	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			let settled = false;
			this.done = (ok) => {
				if (settled) return;
				settled = true;
				this.stopGuard();
				resolve(ok);
			};
			this.open();
			// If the dialog's window disappears, answer "no" instead of leaving the caller waiting.
			this.stopGuard = guardLostWindow(this, () => this.done(false));
		});
	}

	onOpen(): void {
		this.setTitle(this.heading);
		for (const text of Array.isArray(this.message) ? this.message : [this.message]) this.contentEl.createEl('p', { text });
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

/** Confirm removing an agent, with an opt-in to also clean its property out of the skill notes. */
export class RemoveAgentModal extends Modal {
	private result = { confirmed: false, removeProperties: false };
	private removeProperties = false;
	private done: (r: { confirmed: boolean; removeProperties: boolean }) => void = () => undefined;

	constructor(app: App, private readonly label: string, private readonly path: string, private readonly property: string) {
		super(app);
	}

	openAndWait(): Promise<{ confirmed: boolean; removeProperties: boolean }> {
		return new Promise((resolve) => {
			this.done = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(`Remove ${this.label}?`);
		this.contentEl.createEl('p', { text: `Skills Sync stops syncing ${this.path}, on every computer sharing this vault. The skill files in that folder are never touched.` });
		new Setting(this.contentEl)
			.setName(`Also remove the ${this.property} from all skill notes`)
			.setDesc('Also removes its column from the skills base. Leave off to keep your choices, for example to add it back later.')
			.addToggle((t) => t.setValue(false).onChange((v) => (this.removeProperties = v)));
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Remove').setWarning().onClick(() => {
				this.result = { confirmed: true, removeProperties: this.removeProperties };
				this.close();
			}));
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.result);
	}
}

/** Name a skill kept separately (prefilled; must be a free, valid skill name). */
export class NameSkillModal extends Modal {
	private name: string;
	private result: string | null = null;
	private done: (name: string | null) => void = () => undefined;

	constructor(app: App, suggested: string, private readonly existing: string[]) {
		super(app);
		this.name = suggested;
	}

	openAndWait(): Promise<string | null> {
		return new Promise((resolve) => {
			this.done = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle('Keep as a separate skill');
		this.contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'The agent\'s version becomes its own skill note under this name. The agent keeps its folder name, so both skills stay apart from now on.',
		});
		let save: ButtonComponent | undefined;
		const field = new Setting(this.contentEl).setName('Name');
		field.addText((t) => {
			t.setValue(this.name).onChange((v) => {
				this.name = v.trim();
				const error = validateSkillName(this.name, this.existing);
				showFieldError(field, t, error);
				save?.setDisabled(error !== null);
			});
			window.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				save = b;
				b.setButtonText('Keep separately').setCta().setDisabled(validateSkillName(this.name, this.existing) !== null).onClick(() => {
					this.result = this.name;
					this.close();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.result);
	}
}
