import { App, Modal, Notice, Setting, type TextComponent } from 'obsidian';
import { existsSync } from 'fs';
import { isAbsolute, relative, sep } from 'path';
import { archiveRoot, availablePresets, contractHome, expandHome, PRESETS, PRESETS_SOURCE, slugify, validateAgentId } from '../core/agents';
import type { AgentConfig } from '../core/model';
import { addFolderBrowse } from './folderPicker';

export interface AgentModalOptions {
	/** Agent being edited; omit to create a new one. */
	agent?: AgentConfig;
	/** Kind preselected for a new entry. */
	kind: AgentConfig['kind'];
	/** All configured agents (for id validation and preset filtering). */
	existing: AgentConfig[];
	prefix: string;
	onSave: (agent: AgentConfig) => Promise<void>;
}

/** Full-size form to create or edit an agent or project. Works on a draft; nothing changes until Save. */
export class AgentModal extends Modal {
	private draft: AgentConfig;
	private readonly creating: boolean;
	private idTouched = false;

	constructor(app: App, private readonly opts: AgentModalOptions) {
		super(app);
		this.creating = !opts.agent;
		this.draft = opts.agent
			? { ...opts.agent }
			: { id: '', label: '', path: '', kind: opts.kind, layout: 'flat', archiveDir: '' };
	}

	onOpen(): void {
		this.modalEl.addClass('ash-agent-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const d = this.draft;
		const noun = d.kind === 'project' ? 'project' : 'agent';
		this.setTitle(this.creating ? `Add ${noun}` : `Edit ${d.label || noun}`);

		if (this.creating && d.kind === 'agent') {
			const presets = availablePresets(this.opts.existing);
			if (presets.length > 0) {
				new Setting(el)
					.setName('Start from')
					.setDesc(`Fill the form with a known agent (${PRESETS_SOURCE}), or start from scratch. Agents installed on this computer are listed first.`)
					.addDropdown((dd) => {
						dd.addOption('', 'Custom');
						for (const { preset, installed } of presets) dd.addOption(preset.id, `${preset.label}${installed ? ' (installed)' : ''} — ${preset.path}`);
						dd.setValue(PRESETS.some((p) => p.id === d.id) ? d.id : '').onChange((v) => {
							const p = PRESETS.find((x) => x.id === v);
							this.draft = p ? { ...p } : { id: '', label: '', path: '', kind: d.kind, layout: 'flat', archiveDir: '' };
							this.idTouched = Boolean(p);
							this.render();
						});
					});
			}
		}

		let idText: TextComponent | undefined;
		new Setting(el)
			.setName('Name')
			.setDesc('Shown as the column title in the base.')
			.addText((t) => t.setValue(d.label).onChange((v) => {
				d.label = v;
				if (this.creating && !this.idTouched) {
					d.id = slugify(v);
					idText?.setValue(d.id);
					this.updateIdDesc(idSetting);
				}
			}));

		const idSetting = new Setting(el).setName('ID').addText((t) => {
			idText = t;
			t.setValue(d.id).setDisabled(!this.creating).onChange((v) => {
				this.idTouched = true;
				d.id = v.trim();
				this.updateIdDesc(idSetting);
			});
		});
		this.updateIdDesc(idSetting);

		new Setting(el)
			.setName('Type')
			.setDesc('Projects are skills folders inside a repository; they are listed separately.')
			.addDropdown((dd) => dd
				.addOption('agent', 'Agent')
				.addOption('project', 'Project')
				.setValue(d.kind)
				.onChange((v) => (d.kind = v === 'project' ? 'project' : 'agent')));

		let pathText: TextComponent | undefined;
		const pathSetting = new Setting(el)
			.setName('Skills folder')
			.addText((t) => {
				pathText = t;
				t.setPlaceholder('~/.agent/skills').setValue(d.path).onChange((v) => {
					d.path = v.trim();
					this.updatePathDesc(pathSetting);
				});
				t.inputEl.addClass('ash-wide-input');
			});
		addFolderBrowse(pathSetting, () => pathText, `Skills folder for ${d.label || noun}`, {
			toAbs: (v) => expandHome(v),
			fromAbs: (abs) => contractHome(abs),
		});
		this.updatePathDesc(pathSetting);

		new Setting(el)
			.setName('Layout')
			.setDesc('Flat: one subfolder per skill. Category subfolders: skills sit inside nested category folders (some agents group skills this way); the category is kept in the path property of each skill note.')
			.addDropdown((dd) => dd
				.addOption('flat', 'Flat folder')
				.addOption('nested', 'Category subfolders')
				.setValue(d.layout)
				.onChange((v) => (d.layout = v === 'nested' ? 'nested' : 'flat')));

		let archiveText: TextComponent | undefined;
		const archiveSetting = new Setting(el)
			.setName('Archive folder')
			.setDesc('Optional folder where this agent keeps disabled skills. When set, unticking moves the skill there instead of deleting it, and ticking moves it back. Relative to the skills folder (.archive), or anywhere else (~/archives/hermes-skills, /mnt/backup/skills). Leave empty if the agent has none.')
			.addText((t) => {
				archiveText = t;
				t.setPlaceholder('.archive').setValue(d.archiveDir).onChange((v) => (d.archiveDir = v.trim()));
				t.inputEl.addClass('ash-wide-input');
			});
		addFolderBrowse(archiveSetting, () => archiveText, `Archive folder for ${d.label || noun}`, {
			toAbs: (v) => archiveRoot({ ...this.draft, path: expandHome(this.draft.path), archiveDir: v }) ?? expandHome(this.draft.path),
			fromAbs: (abs) => {
				const skills = expandHome(this.draft.path);
				const rel = skills ? relative(skills, abs) : '';
				return skills && rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : contractHome(abs);
			},
		});

		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.creating ? 'Add' : 'Save').setCta().onClick(() => void this.save()));
	}

	private updateIdDesc(s: Setting): void {
		const id = this.draft.id || '<id>';
		s.setDesc(this.creating
			? `Property name: ${this.opts.prefix}${id}. Can't be changed later.`
			: `Property name: ${this.opts.prefix}${id}. Fixed, because skill notes already use it.`);
	}

	private updatePathDesc(s: Setting): void {
		const p = this.draft.path;
		const status = !p ? '' : existsSync(expandHome(p)) ? ' Folder found.' : " This folder doesn't exist yet; it will be used once created.";
		s.setDesc(`Folder this ${this.draft.kind} reads skills from. Type a path or use the folder button.${status}`);
	}

	private async save(): Promise<void> {
		const d = this.draft;
		d.label = d.label.trim();
		if (!d.label) return void new Notice('Give it a name.');
		if (!d.path) return void new Notice('Choose its skills folder.');
		if (this.creating) {
			const err = validateAgentId(d.id, this.opts.existing);
			if (err) return void new Notice(err);
		}
		if (d.archiveDir && archiveRoot({ ...d, path: expandHome(d.path) }) === expandHome(d.path)) return void new Notice('The archive folder must differ from the skills folder.');
		await this.opts.onSave({ ...d });
		this.close();
	}
}
