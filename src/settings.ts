import { App, type DropdownComponent, FileSystemAdapter, normalizePath, Notice, PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import { existsSync } from 'fs';
import { isAbsolute, join, relative, sep } from 'path';
import { expandHome, inferPreset, sortAgentsForList } from './core/agents';
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

export interface HubSettings {
	hubFolder: string;
	propPrefix: string;
	basePath: string;
	/** Paths may start with "~". */
	agents: AgentConfig[];
	/** Code projects: their agents' project skills folders, synced from one column or one per folder. */
	projects: ProjectConfig[];
	autoPullExternal: 'ask' | 'auto';
	autoSync: boolean;
	mergeCommand: string;
	initialized: boolean;
}

export const DEFAULT_SETTINGS: HubSettings = {
	hubFolder: 'Skills',
	propPrefix: 'agent-',
	basePath: 'Skills/Skills.base',
	agents: [],
	projects: [],
	autoPullExternal: 'ask',
	autoSync: true,
	mergeCommand: '',
	initialized: false,
};

export class HubSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: AgentSkillsHub) {
		super(app, plugin);
	}

	/** Show the field's error; apply and save the value only when it is valid. */
	private async saveIfValid(setting: Setting, input: TextComponent, error: string | null, apply: () => void): Promise<void> {
		showFieldError(setting, input, error);
		if (error) return;
		apply();
		await this.plugin.saveSettings();
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

		let hubText: TextComponent | undefined;
		const hub = new Setting(containerEl)
			.setName('Skills folder')
			.setDesc('Vault folder holding one subfolder per skill.')
			.addText((t) => (hubText = t).setValue(s.hubFolder).onChange((v) => this.saveIfValid(hub, t, validateHubFolder(v), () => {
				s.hubFolder = normalizePath(v.trim());
			})));
		addFolderBrowse(hub, () => hubText, 'Skills folder', { toAbs: (v) => this.vaultAbsolute(v), fromAbs: (abs) => this.vaultRelative(abs) });
		const prefix = new Setting(containerEl)
			.setName('Property prefix')
			.setDesc('Prefix of the per-agent checkbox properties, for example agent-. Changing it later orphans existing properties.');
		prefix.addText((t) => t.setValue(s.propPrefix).onChange((v) => this.saveIfValid(prefix, t, validatePrefix(v), () => {
			s.propPrefix = v;
		})));
		const base = new Setting(containerEl)
			.setName('Base file')
			.setDesc('Vault path ending in .base. Created if missing; an existing base gets the missing agent columns.');
		base.addText((t) => t.setValue(s.basePath).onChange((v) => this.saveIfValid(base, t, validateBasePath(v), () => {
			s.basePath = normalizePath(v.trim());
		})))
			.addButton((b) => b.setButtonText('Create or update').onClick(() => void this.plugin.ensureBase(true)));
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
			.setDesc('Optional. Lets the conflict dialog open the merge in another app; without one, conflicts are resolved in Obsidian. Pick an app to fill in its command, or type your own with the placeholders {ours} {base} {theirs} {result}. IntelliJ IDEA and WebStorm need their command-line launcher enabled; use an absolute path if a tool is not found.')
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
		new Setting(el)
			.setName('Projects')
			.setHeading()
			.addButton((b) => b.setButtonText('Add project…').onClick(() => this.openProjectForm()));
		const folders = projectFolders(s.agents);
		if (s.projects.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: 'No projects yet. A project syncs skills into the skills folders your agents read inside a code project.' });
		}
		for (const p of [...s.projects].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))) {
			const columns = projectColumns(p, s.agents);
			const missing = existsSync(expandHome(p.root)) ? '' : ' · folder not found';
			const mode = p.perAgentColumns ? `${columns.length} columns` : `${s.propPrefix}${p.id}`;
			new Setting(el)
				.setName(p.label)
				.setDesc(`${p.root} · ${folders.length} skills folder${folders.length === 1 ? '' : 's'} · ${mode}${missing}`)
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
		}
	}

	private openProjectForm(project?: ProjectConfig): void {
		const s = this.plugin.settings;
		new ProjectModal(this.app, {
			project,
			agents: s.agents,
			projects: s.projects,
			prefix: s.propPrefix,
			hubDir: this.plugin.config().hubDir,
			onSave: async (saved) => {
				if (project) {
					const before = projectColumns(project, s.agents).map((c) => c.id);
					Object.assign(project, saved);
					const after = projectColumns(project, s.agents).map((c) => c.id);
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
			.setName(kind === 'agent' ? 'Agents' : 'Projects')
			.setHeading()
			.addButton((b) => b
				.setButtonText(kind === 'agent' ? 'Add agent…' : 'Add project…')
				.onClick(() => this.openForm(kind)));
		const items = sortAgentsForList(s.agents);
		if (items.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: kind === 'agent' ? 'No agents yet.' : 'No project skills folders yet.' });
		}
		for (const a of items) {
			const layout = a.layout === 'nested' ? ' · category subfolders' : '';
			const archive = a.archiveDir ? ` · archive ${a.archiveDir}` : '';
			const missing = existsSync(expandHome(a.path)) ? '' : ' · folder not found';
			const name = createFragment((f) => {
				f.appendText(a.label);
				{
					const preset = inferPreset(a) !== undefined;
					f.createSpan({ cls: `ash-tag ${preset ? 'ash-tag-preset' : 'ash-tag-custom'}`, text: preset ? 'Preset' : 'Custom' });
				}
			});
			new Setting(el)
				.setName(name)
				.setDesc(`${a.path}${layout}${archive} · ${s.propPrefix}${a.id}${missing}`)
				.addExtraButton((b) => b.setIcon('pencil').setTooltip('Edit').onClick(() => this.openForm(kind, a)))
				.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(async () => {
					const r = await new RemoveAgentModal(this.app, a.label, a.path, `${s.propPrefix}${a.id} property`).openAndWait();
					if (!r.confirmed) return;
					s.agents = s.agents.filter((x) => x !== a);
					await this.plugin.saveSettings();
					if (r.removeProperties) await this.plugin.removeColumns([a.id]);
					await this.changed();
				}));
		}
	}

	private openForm(kind: AgentConfig['kind'], agent?: AgentConfig): void {
		const s = this.plugin.settings;
		new AgentModal(this.app, {
			agent,
			kind,
			existing: s.agents,
			prefix: s.propPrefix,
			hubDir: this.plugin.config().hubDir,
			onSave: async (saved) => {
				if (agent) Object.assign(agent, saved);
				else s.agents.push(saved);
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
