import { App, type DropdownComponent, FileSystemAdapter, normalizePath, Notice, PluginSettingTab, Setting, type TextComponent, TFile } from 'obsidian';
import { isAbsolute, join, relative, sep } from 'path';
import { detectPresets, expandHome, inferPreset, sortAgentsForList } from './core/agents';
import type { AgentConfig, ProjectConfig } from './core/model';
import type AgentSkillsHub from './main';
import { AgentModal } from './ui/AgentModal';
import { ProjectModal } from './ui/ProjectModal';
import { projectColumns, projectFolders } from './core/projects';
import { showFieldError } from './ui/fieldErrors';
import { addFolderBrowse } from './ui/folderPicker';
import { MERGE_TOOL_PRESETS } from './core/externalMerge';
import { validateBasePath, validateHubFolder, validateMergeCommand, validatePrefix } from './core/validate';
import { RemoveAgentModal } from './ui/simpleModals';
import { formatAgentNote, isAgentForDevice } from './core/agentNotes';

export { DEFAULT_SETTINGS, type HubSettings } from './core/settingsStore';

export class HubSettingTab extends PluginSettingTab {
	private viewSetting?: Setting;
	private viewDropdown?: DropdownComponent;
	private viewRenderToken = 0;
	constructor(app: App, private readonly plugin: AgentSkillsHub) {
		super(app, plugin);
	}

	/** Show the field's error; apply and save the value only when it is valid. */
	private async saveIfValid(setting: Setting, input: TextComponent, error: string | null, apply: () => void | Promise<void>): Promise<void> {
		showFieldError(setting, input, error);
		if (error) return;
		await apply();
		await this.plugin.saveSettings();
	}

	/** Fill the view selector from the base file (first table view by default). */
	private async renderViewOptions(): Promise<void> {
		const d = this.viewDropdown;
		if (!d) return;
		const s = this.plugin.settings;
		const token = ++this.viewRenderToken;
		const views = await this.plugin.baseViews();
		// The tab may have re-rendered meanwhile: only the latest call fills the list.
		if (token !== this.viewRenderToken || d !== this.viewDropdown) return;
		d.selectEl.empty();
		if (views.length === 0) {
			d.addOption('', 'No base yet');
			d.setDisabled(true);
			return;
		}
		d.setDisabled(false);
		for (const v of views) d.addOption(v, v);
		d.setValue(views.includes(s.baseView) ? s.baseView : (views[0] ?? ''));
	}

	/** Re-render when the settings changed on disk (another computer's profile arrived). */
	refreshIfOpen(): void {
		if (this.containerEl.isShown()) this.display();
	}

	private vaultAbsolute(rel: string): string {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? join(adapter.getBasePath(), rel) : rel;
	}

	private vaultRelative(abs: string): string | null {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return null;
		const rel = relative(adapter.getBasePath(), abs);
		if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
			new Notice('Choose a folder inside this vault.');
			return null;
		}
		return normalizePath(rel.split(sep).join('/'));
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();
		containerEl.addClass('ash-settings');

		new Setting(containerEl)
			.setName("This computer's name")
			.setDesc('Identifier for this device (saved locally on this machine). Used to match agents configured for this computer.')
			.addText((t) => t.setValue(this.plugin.currentDevice()).onChange((v) => {
				this.plugin.saveDeviceName(v);
			}));

		const prefix = new Setting(containerEl)
			.setName('Property prefix')
			.setDesc('Prefix of the plugin properties, for example agent-. Changing it later orphans existing properties.');
		prefix.addText((t) => t.setValue(s.propPrefix).onChange((v) => this.saveIfValid(prefix, t, validatePrefix(v), () => {
			s.propPrefix = v;
		})));

		let hubText: TextComponent | undefined;
		const hub = new Setting(containerEl)
			.setName('Skills folder')
			.setDesc('Vault folder holding one subfolder per skill.')
			.addText((t) => (hubText = t).setValue(s.hubFolder).onChange((v) => this.saveIfValid(hub, t, validateHubFolder(v), () => {
				s.hubFolder = normalizePath(v.trim());
			})));
		addFolderBrowse(hub, () => hubText, 'Skills folder', { toAbs: (v) => this.vaultAbsolute(v), fromAbs: (abs) => this.vaultRelative(abs) });

		const base = new Setting(containerEl)
			.setName('Skills base file')
			.setDesc('Vault path ending in .base, shared by every computer. Created if missing; an existing base gets the missing columns.');
		base.addText((t) => t.setValue(s.basePath).onChange((v) => this.saveIfValid(base, t, validateBasePath(v), async () => {
			s.basePath = normalizePath(v.trim());
			await this.renderViewOptions();
		})))
			.addButton((b) => b.setButtonText('Create or update').onClick(async () => {
				await this.plugin.ensureBase(true);
				await this.renderViewOptions();
			}));

		this.viewSetting = new Setting(containerEl)
			.setName('Skills base view')
			.setDesc('The view in the skills base that gets the agent and project columns. Your other views are left alone.')
			.addDropdown((d) => {
				this.viewDropdown = d;
				d.onChange(async (v) => {
					s.baseView = v;
					await this.plugin.saveSettings();
					await this.plugin.ensureBase();
				});
			});
		void this.renderViewOptions();

		let agentsText: TextComponent | undefined;
		const agentsFolder = new Setting(containerEl)
			.setName('Agents folder')
			.setDesc('Vault folder holding agent Markdown notes.')
			.addText((t) => (agentsText = t).setValue(s.agentsFolder).onChange((v) => this.saveIfValid(agentsFolder, t, v.trim() ? null : 'Required.', () => {
				s.agentsFolder = normalizePath(v.trim());
			})));
		addFolderBrowse(agentsFolder, () => agentsText, 'Agents folder', { toAbs: (v) => this.vaultAbsolute(v), fromAbs: (abs) => this.vaultRelative(abs) });

		const agentsBase = new Setting(containerEl)
			.setName('Agents base file')
			.setDesc('Vault path ending in .base for the agents database view.')
			.addText((t) => t.setValue(s.agentsBasePath).onChange((v) => this.saveIfValid(agentsBase, t, validateBasePath(v), () => {
				s.agentsBasePath = normalizePath(v.trim());
			})))
			.addButton((b) => b.setButtonText('Create or update').onClick(async () => {
				await this.plugin.ensureAgentsBase(true);
			}));
		new Setting(containerEl)
			.setName('Sync automatically')
			.setDesc('Sync on startup, when agent folders change, and when skills are edited in the vault.')
			.addToggle((t) => t.setValue(s.autoSync).onChange(async (v) => {
				s.autoSync = v;
				await this.plugin.saveSettings();
				this.plugin.restartWatcher();
			}));
		new Setting(containerEl)
			.setName('Updates made by other tools')
			.setDesc('When a tool updates a skill inside some agent folders.')
			.addDropdown((d) => d
				.addOption('ask', 'Ask me')
				.addOption('auto', 'Pull into the vault automatically')
				.setValue(s.autoPullExternal)
				.onChange(async (v) => {
					s.autoPullExternal = v === 'auto' ? 'auto' : 'ask';
					await this.plugin.saveSettings();
				}));
		const presetFor = (cmd: string): string => (cmd.trim() ? (MERGE_TOOL_PRESETS.find((p) => p.command === cmd.trim())?.id ?? 'custom') : '');
		let mergeText: TextComponent | undefined;
		let mergeDropdown: DropdownComponent | undefined;
		// One block: description on top, then the app presets and the full-width command.
		const merge = new Setting(containerEl)
			.setClass('ash-stacked')
			.setName('Merge tool')
			.setDesc('Optional. Lets the conflict dialog open the merge in another app; without one, conflicts are resolved in Obsidian. Pick an app to fill in its command, or type your own with the placeholders {ours} {base} {theirs} {result}. Rebased, IntelliJ IDEA, and WebStorm need their command-line launcher enabled; use an absolute path if a tool is not found.')
			.addDropdown((d) => {
				mergeDropdown = d;
				d.addOption('', 'None');
				for (const p of MERGE_TOOL_PRESETS) d.addOption(p.id, p.label);
				d.addOption('custom', 'Custom command');
				d.setValue(presetFor(s.mergeCommand)).onChange((v) => {
					if (v === 'custom') return mergeText?.inputEl.focus();
					mergeText?.setValue(MERGE_TOOL_PRESETS.find((p) => p.id === v)?.command ?? '');
					mergeText?.onChanged();
				});
			});
		merge.addText((t) => {
			mergeText = t;
			t.setPlaceholder('tool {ours} {theirs} {base} {result}').setValue(s.mergeCommand).onChange((v) => {
				mergeDropdown?.setValue(presetFor(v));
				void this.saveIfValid(merge, t, validateMergeCommand(v), () => {
					s.mergeCommand = v.trim();
				});
			});
		});

		this.renderList(containerEl, 'agent');
		this.renderProjects(containerEl);
	}

	private renderProjects(el: HTMLElement): void {
		const s = this.plugin.settings;
		const agents = this.plugin.getAgents();
		new Setting(el)
			.setName('Projects')
			.setHeading()
			.addButton((b) => b.setButtonText('Add project…').onClick(() => this.openProjectForm()));
		const folders = projectFolders(agents);
		if (s.projects.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: 'No projects yet. A project syncs skills into the skills folders your agents read inside a code project.' });
		}
		for (const p of [...s.projects].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))) {
			const columns = projectColumns(p, agents);
			const available = this.plugin.isAvailable(p);
			const mode = p.perAgentColumns ? `${columns.length} columns` : `${s.propPrefix}${p.id}`;
			const row = new Setting(el)
				.setName(createFragment((f) => {
					f.appendText(p.label);
					if (!available) f.createSpan({ cls: 'ash-tag ash-tag-unavailable', text: 'Not available on this machine' });
				}))
				.setDesc(`${p.root} · ${folders.length} skills folder${folders.length === 1 ? '' : 's'} · ${mode}`)
				.addExtraButton((b) => b.setIcon('pencil').setTooltip('Edit').onClick(() => this.openProjectForm(p)))
				.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(async () => {
					const property = p.perAgentColumns ? `${s.propPrefix}${p.id}-… properties` : `${s.propPrefix}${p.id} property`;
					const r = await new RemoveAgentModal(this.app, p.label, p.root, property).openAndWait();
					if (!r.confirmed) return;
					s.projects = s.projects.filter((x) => x !== p);
					await this.plugin.saveSettings();
					if (r.removeProperties) await this.plugin.removeColumns(columns.map((c) => c.id));
					await this.changed();
				}));
			row.settingEl.toggleClass('ash-unavailable', !available);
		}
	}

	private openProjectForm(project?: ProjectConfig): void {
		const s = this.plugin.settings;
		const agents = this.plugin.getAgents();
		new ProjectModal(this.app, {
			project,
			agents,
			projects: s.projects,
			prefix: s.propPrefix,
			hubDir: this.plugin.config().hubDir,
			onSave: async (saved) => {
				if (project) {
					const before = projectColumns(project, agents).map((c) => c.id);
					Object.assign(project, saved);
					const after = projectColumns(project, agents).map((c) => c.id);
					if (before.join() !== after.join()) await this.plugin.switchColumns(before, after);
				} else {
					s.projects.push(saved);
				}
				await this.changed();
			},
		}).open();
	}

	private renderList(el: HTMLElement, kind: 'agent'): void {
		const s = this.plugin.settings;
		new Setting(el)
			.setName('Agents')
			.setHeading()
			.addButton((b) => b
				.setButtonText('Add agent…')
				.onClick(() => this.openForm(kind)));
		const items = sortAgentsForList(this.plugin.getAgents());
		if (items.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: `No agents configured yet in ${s.agentsFolder}/.` });
		}
		for (const a of items) {
			const layout = a.layout === 'nested' ? ' · category subfolders' : '';
			const archive = a.archiveDir ? ` · archive ${a.archiveDir}` : '';
			const available = this.plugin.isAvailable(a);
			const deviceLabel = a.devices && a.devices.length > 0 ? a.devices.join(', ') : 'All devices';
			const name = createFragment((f) => {
				f.appendText(a.label);
				const preset = inferPreset(a) !== undefined;
				f.createSpan({ cls: `ash-tag ${preset ? 'ash-tag-preset' : 'ash-tag-custom'}`, text: preset ? 'Preset' : 'Custom' });
				f.createSpan({ cls: 'ash-tag', text: deviceLabel });
				if (!available) f.createSpan({ cls: 'ash-tag ash-tag-unavailable', text: 'Not available on this machine' });
			});
			const row = new Setting(el)
				.setName(name)
				.setDesc(`${a.path}${layout}${archive} · ${s.propPrefix}${a.stateKey ?? a.id}`)
				.addExtraButton((b) => b.setIcon('file-text').setTooltip('Open note').onClick(async () => {
					const path = normalizePath(`${s.agentsFolder}/${a.label}.md`);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
				}))
				.addExtraButton((b) => b.setIcon('folder-sync').setTooltip('Resync with its folder…').setDisabled(!available).onClick(() => void this.plugin.adoptExisting(a.id, a.label)))
				.addExtraButton((b) => b.setIcon('pencil').setTooltip('Edit').onClick(() => this.openForm(kind, a)))
				.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(async () => {
					const r = await new RemoveAgentModal(this.app, a.label, a.path, `${s.propPrefix}${a.stateKey ?? a.id} property`).openAndWait();
					if (!r.confirmed) return;
					const path = normalizePath(`${s.agentsFolder}/${a.label}.md`);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) await this.app.fileManager.trashFile(file);
					await this.plugin.reloadAgentNotes();
					if (r.removeProperties) await this.plugin.removeColumns([a.stateKey ?? a.id]);
					await this.changed();
				}));
			row.settingEl.toggleClass('ash-unavailable', !available);
		}

		// Detected presets on this computer
		const detected = detectPresets();
		const currentDev = this.plugin.currentDevice();
		const configuredAgents = this.plugin.getAgents();
		const unconfigured = detected.filter((p) => {
			const path = expandHome(p.path);
			return !configuredAgents.some((a) => (a.id === p.id || expandHome(a.path) === path) && isAgentForDevice(a, currentDev));
		});
		if (unconfigured.length > 0) {
			new Setting(el)
				.setName('Detected on this computer')
				.setHeading();
			for (const p of unconfigured) {
				new Setting(el)
					.setName(p.label)
					.setDesc(p.path)
					.addButton((b) => b.setButtonText('Add to agents').onClick(() => {
						this.openForm('agent', {
							...p,
							devices: currentDev ? [currentDev] : undefined,
						}, true);
					}));
			}
		}
	}

	private openForm(kind: AgentConfig['kind'], agent?: AgentConfig, isNewFromPreset = false): void {
		const s = this.plugin.settings;
		const agents = this.plugin.getAgents();
		new AgentModal(this.app, {
			agent,
			isNew: isNewFromPreset,
			kind,
			existing: agents,
			prefix: s.propPrefix,
			hubDir: this.plugin.config().hubDir,
			agentsFolder: s.agentsFolder,
			defaultDevice: this.plugin.currentDevice(),
			onSave: async (saved, oldLabel) => {
				const folder = normalizePath(s.agentsFolder);
				const newPath = `${folder}/${saved.label}.md`;
				let body = '';
				if (oldLabel) {
					const oldPath = `${folder}/${oldLabel}.md`;
					const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile instanceof TFile) {
						const oldContent = await this.app.vault.read(oldFile);
						const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(oldContent);
						if (m && m[1]) body = m[1];
						if (oldPath !== newPath) await this.app.fileManager.trashFile(oldFile);
					}
				}
				const noteText = formatAgentNote(saved, body);
				const existingNew = this.app.vault.getAbstractFileByPath(newPath);
				if (existingNew instanceof TFile) {
					await this.app.vault.modify(existingNew, noteText);
				} else {
					if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
					await this.app.vault.create(newPath, noteText);
				}
				await this.plugin.reloadAgentNotes();
				await this.changed();
			},
			onDelete: async (target) => {
				const path = normalizePath(`${s.agentsFolder}/${target.label}.md`);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) await this.app.fileManager.trashFile(file);
				await this.plugin.reloadAgentNotes();
				await this.changed();
			},
		}).open();
	}

	private async changed(): Promise<void> {
		await this.plugin.saveSettings();
		await this.plugin.onAgentsChanged();
		this.display();
	}
}
