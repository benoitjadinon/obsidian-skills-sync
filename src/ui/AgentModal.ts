import { App, type ButtonComponent, Modal, Setting, type TextComponent } from 'obsidian';
import { existsSync } from 'fs';
import { isAbsolute, relative, sep } from 'path';
import { archiveRoot, availablePresets, contractHome, expandHome, PRESETS_SOURCE, slugify, validateAgentId } from '../core/agents';
import type { AgentConfig } from '../core/model';
import { normalizeIdInput, validateAgentFolder, validateArchiveFolder, validateProjectDir } from '../core/validate';
import { showFieldError } from './fieldErrors';
import { addFolderBrowse } from './folderPicker';

export interface AgentModalOptions {
	/** Agent being edited; omit to create a new one. */
	agent?: AgentConfig;
	/** Kind of a new entry (set by the list it is added from). */
	kind: AgentConfig['kind'];
	/** All configured agents (for validation and preset filtering). */
	existing: AgentConfig[];
	prefix: string;
	/** Absolute vault skills folder (an agent folder can't overlap it). */
	hubDir: string;
	onSave: (agent: AgentConfig) => Promise<void>;
}

interface Field {
	setting: Setting;
	input?: TextComponent;
}

/** Full-size form to create or edit an agent or project. Works on a draft; nothing changes until Save. */
export class AgentModal extends Modal {
	private draft: AgentConfig;
	private readonly creating: boolean;
	private idTouched = false;
	private fields: Record<'name' | 'id' | 'path' | 'archive' | 'project', Field | undefined> = { name: undefined, id: undefined, path: undefined, archive: undefined, project: undefined };
	private saveButton?: ButtonComponent;
	/** Fields the user has edited; errors show only for those (all of them when editing an existing agent). */
	private touched = new Set<keyof AgentModal['fields']>();

	constructor(app: App, private readonly opts: AgentModalOptions) {
		super(app);
		this.creating = !opts.agent;
		this.draft = opts.agent ? { ...opts.agent } : this.blank();
	}

	private blank(): AgentConfig {
		return { id: '', label: '', path: '', kind: this.opts.kind, layout: 'flat', archiveDir: '' };
	}

	private get others(): AgentConfig[] {
		return this.opts.existing.filter((a) => a !== this.opts.agent);
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
						const known = presets.map((x) => x.preset);
						dd.setValue(known.some((p) => p.id === d.id) ? d.id : '').onChange((v) => {
							const p = known.find((x) => x.id === v);
							this.draft = p ? { ...p } : this.blank();
							this.idTouched = Boolean(p);
							this.render();
						});
					});
			}
		}

		const name: Field = { setting: new Setting(el).setName('Name').setDesc('Shown as the column title in the base.') };
		name.setting.addText((t) => {
			name.input = t;
			t.setValue(d.label).onChange((v) => {
				d.label = v;
				this.touched.add('name');
				if (this.creating && !this.idTouched) {
					d.id = slugify(v);
					this.fields.id?.input?.setValue(d.id);
				}
				this.validate();
			});
		});
		this.fields.name = name;

		const id: Field = { setting: new Setting(el).setName('ID') };
		id.setting.addText((t) => {
			id.input = t;
			t.setValue(d.id).setDisabled(!this.creating).onChange((v) => {
				this.idTouched = true;
				this.touched.add('id');
				const clean = normalizeIdInput(v, false);
				if (clean !== v) t.setValue(clean);
				d.id = clean;
				this.validate();
			});
		});
		this.fields.id = id;

		const path: Field = { setting: new Setting(el).setName('Skills folder') };
		path.setting.addText((t) => {
			path.input = t;
			t.setPlaceholder('~/.agent/skills').setValue(d.path).onChange((v) => {
				d.path = v.trim();
				this.touched.add('path');
				this.validate();
			});
			t.inputEl.addClass('ash-wide-input');
		});
		addFolderBrowse(path.setting, () => path.input, `Skills folder for ${d.label || noun}`, {
			toAbs: (v) => expandHome(v),
			fromAbs: (abs) => contractHome(abs),
		});
		this.fields.path = path;

		// Known agents without a project skills folder (OpenClaw, Hermes profiles) can't have one.
		const noProjectFolder = Boolean(d.preset) && !d.projectDir;
		const project: Field = {
			setting: new Setting(el)
				.setName('Project skills folder')
				.setDesc(noProjectFolder
					? `${d.label || 'This agent'} doesn't read skills from code projects.`
					: 'Folder inside a code project where this agent reads skills, for example .claude/skills. Used by projects. Leave empty if the agent has none.'),
		};
		project.setting.addText((t) => {
			project.input = t;
			t.setPlaceholder('.agent/skills').setValue(d.projectDir ?? '').setDisabled(noProjectFolder).onChange((v) => {
				d.projectDir = v.trim() || undefined;
				this.touched.add('project');
				this.validate();
			});
		});
		this.fields.project = project;

		new Setting(el)
			.setName('Layout')
			.setDesc('Flat: one subfolder per skill. Category subfolders: skills sit inside nested category folders (some agents group skills this way); the category is kept in the path property of each skill note.')
			.addDropdown((dd) => dd
				.addOption('flat', 'Flat folder')
				.addOption('nested', 'Category subfolders')
				.setValue(d.layout)
				.onChange((v) => (d.layout = v === 'nested' ? 'nested' : 'flat')));

		const archive: Field = {
			setting: new Setting(el)
				.setName('Archive folder')
				.setDesc('Optional folder where this agent keeps disabled skills. When set, unticking moves the skill there instead of deleting it, and ticking moves it back. Relative to the skills folder (.archive), or anywhere else (~/archives/hermes-skills, /mnt/backup/skills). Leave empty if the agent has none.'),
		};
		archive.setting.addText((t) => {
			archive.input = t;
			t.setPlaceholder('.archive').setValue(d.archiveDir).onChange((v) => {
				d.archiveDir = v.trim();
				this.touched.add('archive');
				this.validate();
			});
			t.inputEl.addClass('ash-wide-input');
		});
		addFolderBrowse(archive.setting, () => archive.input, `Archive folder for ${d.label || noun}`, {
			toAbs: (v) => archiveRoot({ ...this.draft, path: expandHome(this.draft.path), archiveDir: v }) ?? expandHome(this.draft.path),
			fromAbs: (abs) => {
				const skills = expandHome(this.draft.path);
				const rel = skills ? relative(skills, abs) : '';
				return skills && rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : contractHome(abs);
			},
		});
		this.fields.archive = archive;

		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				this.saveButton = b;
				b.setButtonText(this.creating ? 'Add' : 'Save').setCta().onClick(() => void this.save());
			});

		this.validate();
	}

	/** Refresh every field's description and error, and enable Save only when the form is valid. */
	private validate(): boolean {
		const d = this.draft;
		const f = this.fields;
		const ctx = { others: this.others, hubDir: this.opts.hubDir };

		const nameError = d.label.trim() ? null : 'Required.';

		const finalId = normalizeIdInput(d.id);
		const idError = this.creating ? (finalId ? validateAgentId(finalId, this.others) : 'Required.') : null;
		f.id?.setting.setDesc(this.creating
			? `Lowercase letters, digits and dashes. Property name: ${this.opts.prefix}${finalId || '<id>'}. Can't be changed later.`
			: `Property name: ${this.opts.prefix}${d.id}. Fixed, because skill notes already use it.`);

		const pathError = validateAgentFolder(d.path, ctx);
		const status = pathError || !d.path ? '' : existsSync(expandHome(d.path)) ? ' Folder found.' : " This folder doesn't exist yet; it will be used once created.";
		f.path?.setting.setDesc(`Folder this ${d.kind} reads skills from. Type a path or use the folder button.${status}`);

		const archiveError = validateArchiveFolder(d.archiveDir, { ...ctx, skillsFolder: d.path });
		const projectError = validateProjectDir(d.projectDir ?? '');

		const show = (key: keyof AgentModal['fields'], error: string | null, visible = this.touched.has(key)): void => {
			const field = f[key];
			if (field) showFieldError(field.setting, field.input, !this.creating || visible ? error : null);
		};
		show('name', nameError);
		// The ID follows the name, so it is checked as soon as either was typed in.
		show('id', idError, this.touched.has('name') || this.touched.has('id'));
		show('path', pathError);
		show('archive', archiveError);
		show('project', projectError);

		const ok = !nameError && !idError && !pathError && !archiveError && !projectError;
		this.saveButton?.setDisabled(!ok);
		return ok;
	}

	private async save(): Promise<void> {
		if (!this.validate()) return;
		const d = this.draft;
		await this.opts.onSave({ ...d, label: d.label.trim(), id: this.creating ? normalizeIdInput(d.id) : d.id });
		this.close();
	}
}
