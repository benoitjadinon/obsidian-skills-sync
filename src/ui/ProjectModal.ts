import { App, type ButtonComponent, Modal, Setting, type TextComponent } from 'obsidian';
import { contractHome, expandHome, slugify, validateAgentId } from '../core/agents';
import type { AgentConfig, ProjectConfig } from '../core/model';
import { projectColumns, projectFolders } from '../core/projects';
import { normalizeIdInput, validateProjectFolder } from '../core/validate';
import { showFieldError } from './fieldErrors';
import { addFolderBrowse } from './folderPicker';

export interface ProjectModalOptions {
	/** Project being edited; omit to create one. */
	project?: ProjectConfig;
	agents: AgentConfig[];
	projects: ProjectConfig[];
	prefix: string;
	hubDir: string;
	onSave: (project: ProjectConfig) => Promise<void>;
}

/** Form to add or edit a code project. Works on a draft; nothing changes until Save. */
export class ProjectModal extends Modal {
	private draft: ProjectConfig;
	private readonly creating: boolean;
	private idTouched = false;
	private touched = new Set<'name' | 'id' | 'root'>();
	private saveButton?: ButtonComponent;
	private fields: { name?: Setting; nameInput?: TextComponent; id?: Setting; idInput?: TextComponent; root?: Setting; rootInput?: TextComponent } = {};
	private previewEl?: HTMLElement;

	constructor(app: App, private readonly opts: ProjectModalOptions) {
		super(app);
		this.creating = !opts.project;
		this.draft = opts.project ? { ...opts.project } : { id: '', label: '', root: '', perAgentColumns: false };
	}

	onOpen(): void {
		this.modalEl.addClass('ash-agent-modal');
		this.setTitle(this.creating ? 'Add project' : `Edit ${this.draft.label}`);
		const el = this.contentEl;
		const d = this.draft;

		const root = new Setting(el).setName('Project folder').setDesc('The project root, for example a code repository. Type a path or use the folder button.');
		root.addText((t) => {
			this.fields.rootInput = t;
			t.setPlaceholder('~/code/my-app').setValue(d.root).onChange((v) => {
				d.root = v.trim();
				this.touched.add('root');
				if (this.creating && !d.label) {
					const base = d.root.split('/').filter(Boolean).pop() ?? '';
					if (base) this.fields.nameInput?.setValue(base).onChanged();
				}
				this.validate();
			});
			t.inputEl.addClass('ash-wide-input');
		});
		addFolderBrowse(root, () => this.fields.rootInput, 'Project folder', { toAbs: (v) => expandHome(v), fromAbs: (abs) => contractHome(abs) });
		this.fields.root = root;

		const name = new Setting(el).setName('Name').setDesc('Shown as the column title in the base.');
		name.addText((t) => {
			this.fields.nameInput = t;
			t.setValue(d.label).onChange((v) => {
				d.label = v;
				this.touched.add('name');
				if (this.creating && !this.idTouched) {
					d.id = slugify(v);
					this.fields.idInput?.setValue(d.id);
				}
				this.validate();
			});
		});
		this.fields.name = name;

		const id = new Setting(el).setName('ID');
		id.addText((t) => {
			this.fields.idInput = t;
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

		new Setting(el)
			.setName('A column per agent')
			.setDesc('Off: one column for the project; ticking it copies the skill into every agent folder of the project. On: one column per agent folder, to choose agent by agent. Switching later keeps your choices.')
			.addToggle((t) => t.setValue(d.perAgentColumns).onChange((v) => {
				d.perAgentColumns = v;
				this.validate();
			}));

		this.previewEl = el.createDiv({ cls: 'ash-project-preview' });

		new Setting(el)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => {
				this.saveButton = b;
				b.setButtonText(this.creating ? 'Add' : 'Save').setCta().onClick(() => void this.save());
			});
		this.validate();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Every id already used by a checkbox column (agents and other projects' columns). */
	private takenIds(): AgentConfig[] {
		const others = this.opts.projects.filter((p) => p !== this.opts.project);
		const ids = [...this.opts.agents.map((a) => a.id), ...others.flatMap((p) => projectColumns(p, this.opts.agents).map((c) => c.id))];
		return ids.map((x) => ({ id: x, label: x, path: '', kind: 'agent', layout: 'flat', archiveDir: '' }));
	}

	private validate(): boolean {
		const d = this.draft;
		const f = this.fields;
		const others = this.opts.projects.filter((p) => p !== this.opts.project);
		const rootError = validateProjectFolder(d.root, { hubDir: this.opts.hubDir, others });
		const nameError = d.label.trim() ? null : 'Required.';
		const finalId = normalizeIdInput(d.id);
		let idError: string | null = null;
		if (this.creating) {
			idError = finalId ? validateAgentId(finalId, this.takenIds()) : 'Required.';
			// Per-agent columns are named <id>-<agent>; make sure none collides either.
			if (!idError && d.perAgentColumns) {
				const taken = new Set(this.takenIds().map((a) => a.id));
				const clash = projectColumns({ ...d, id: finalId }, this.opts.agents).find((c) => taken.has(c.id));
				if (clash) idError = `The column ${this.opts.prefix}${clash.id} already exists.`;
			}
		}
		f.id?.setDesc(this.creating
			? `Lowercase letters, digits and dashes. Property name: ${this.opts.prefix}${finalId || '<id>'}. Can't be changed later.`
			: `Property name: ${this.opts.prefix}${d.id}. Fixed, because skill notes already use it.`);

		const show = (setting: Setting | undefined, input: TextComponent | undefined, key: 'name' | 'id' | 'root', error: string | null, visible = this.touched.has(key)): void => {
			if (setting) showFieldError(setting, input, !this.creating || visible ? error : null);
		};
		show(f.root, f.rootInput, 'root', rootError);
		show(f.name, f.nameInput, 'name', nameError);
		show(f.id, f.idInput, 'id', idError, this.touched.has('name') || this.touched.has('id') || this.touched.has('root'));
		this.renderPreview(finalId);

		const ok = !rootError && !nameError && !idError;
		this.saveButton?.setDisabled(!ok);
		return ok;
	}

	private renderPreview(id: string): void {
		const el = this.previewEl;
		if (!el) return;
		el.empty();
		const d = this.draft;
		const folders = projectFolders(this.opts.agents);
		if (folders.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: 'None of your agents has a project skills folder yet; set one in an agent\'s form.' });
			return;
		}
		el.createEl('p', { cls: 'setting-item-description', text: d.perAgentColumns ? 'Columns and the folders they sync:' : `Ticking the ${this.opts.prefix}${id || '<id>'} column syncs these folders:` });
		const list = el.createEl('ul', { cls: 'ash-project-folders' });
		const root = d.root || '<project>';
		const columns = projectColumns({ ...d, id: id || '<id>' }, this.opts.agents);
		folders.forEach((f, i) => {
			const li = list.createEl('li');
			li.createEl('code', { text: `${root.replace(/\/+$/, '')}/${f.dir}` });
			li.appendText(` (${f.agents.map((a) => a.label).join(', ')})`);
			if (d.perAgentColumns && columns[i]) li.appendText(` → ${this.opts.prefix}${columns[i].id}`);
		});
	}

	private async save(): Promise<void> {
		if (!this.validate()) return;
		const d = this.draft;
		await this.opts.onSave({ ...d, label: d.label.trim(), id: this.creating ? normalizeIdInput(d.id) : d.id });
		this.close();
	}
}
