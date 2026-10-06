import { App, normalizePath, Notice, PluginSettingTab, Setting } from 'obsidian';
import { existsSync } from 'fs';
import { expandHome, PRESETS, slugify, validateAgentId } from './core/agents';
import type { AgentConfig } from './core/model';
import type AgentSkillsHub from './main';

export interface HubSettings {
	hubFolder: string;
	propPrefix: string;
	basePath: string;
	/** Paths may start with "~". */
	agents: AgentConfig[];
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
	autoPullExternal: 'ask',
	autoSync: true,
	mergeCommand: 'code --wait --merge {ours} {theirs} {base} {result}',
	initialized: false,
};

export class HubSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: AgentSkillsHub) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Skills folder')
			.setDesc('Vault folder holding one subfolder per skill.')
			.addText((t) => t.setValue(s.hubFolder).onChange(async (v) => {
				s.hubFolder = normalizePath(v);
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName('Property prefix')
			.setDesc('Prefix of the per-agent checkbox properties. Changing it later orphans existing properties.')
			.addText((t) => t.setValue(s.propPrefix).onChange(async (v) => {
				s.propPrefix = v;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
			.setName('Base file')
			.setDesc('Created if missing; an existing base gets the missing agent columns.')
			.addText((t) => t.setValue(s.basePath).onChange(async (v) => {
				s.basePath = normalizePath(v);
				await this.plugin.saveSettings();
			}))
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
		new Setting(containerEl)
			.setName('Merge tool command')
			.setDesc('Placeholders: {ours} {base} {theirs} {result}. Use an absolute path if the tool is not found.')
			.addText((t) => t.setValue(s.mergeCommand).onChange(async (v) => {
				s.mergeCommand = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName('Agents').setHeading();
		for (const a of s.agents.filter((x) => x.kind === 'agent')) this.renderAgent(containerEl, a);
		const available = PRESETS.filter((p) => !s.agents.some((a) => a.id === p.id));
		if (available.length > 0) {
			let chosen = available[0]?.id ?? '';
			new Setting(containerEl)
				.setName('Add a preset')
				.addDropdown((d) => {
					for (const p of available) d.addOption(p.id, `${p.label} (${p.path})`);
					d.setValue(chosen).onChange((v) => (chosen = v));
				})
				.addButton((b) => b.setButtonText('Add').onClick(async () => {
					const p = PRESETS.find((x) => x.id === chosen);
					if (!p) return;
					if (!existsSync(expandHome(p.path))) new Notice(`${p.path} does not exist yet; it will be used once created.`);
					s.agents.push({ ...p });
					await this.changed();
				}));
		}
		this.renderAddForm(containerEl, 'agent');

		new Setting(containerEl).setName('Projects').setHeading();
		for (const a of s.agents.filter((x) => x.kind === 'project')) this.renderAgent(containerEl, a);
		this.renderAddForm(containerEl, 'project');
	}

	private async changed(): Promise<void> {
		await this.plugin.saveSettings();
		await this.plugin.onAgentsChanged();
		this.display();
	}

	private renderAgent(el: HTMLElement, a: AgentConfig): void {
		const s = this.plugin.settings;
		new Setting(el)
			.setName(a.label)
			.setDesc(`${a.path} · property ${s.propPrefix}${a.id}`)
			.addDropdown((d) => d
				.addOption('flat', 'Flat folder')
				.addOption('nested', 'Category subfolders')
				.setValue(a.layout)
				.onChange(async (v) => {
					a.layout = v === 'nested' ? 'nested' : 'flat';
					await this.plugin.saveSettings();
				}))
			.addText((t) => t.setPlaceholder('Archive folder').setValue(a.archiveDir).onChange(async (v) => {
				a.archiveDir = v.trim();
				await this.plugin.saveSettings();
			}))
			.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(async () => {
				s.agents = s.agents.filter((x) => x !== a);
				await this.changed();
			}));
	}

	private renderAddForm(el: HTMLElement, kind: 'agent' | 'project'): void {
		let label = '';
		let path = '';
		new Setting(el)
			.setName(kind === 'agent' ? 'Add custom agent' : 'Add project')
			.setDesc(kind === 'agent' ? 'Any folder an agent reads skills from.' : 'A project skills folder, for example ~/Workspaces/foo/.claude/skills.')
			.addText((t) => t.setPlaceholder('Name').onChange((v) => (label = v)))
			.addText((t) => t.setPlaceholder('Folder path').onChange((v) => (path = v)))
			.addButton((b) => b.setButtonText('Add').onClick(async () => {
				const s = this.plugin.settings;
				const id = slugify(label);
				const err = validateAgentId(id, s.agents);
				if (err) return void new Notice(err);
				if (!existsSync(expandHome(path))) return void new Notice('That folder does not exist.');
				s.agents.push({ id, label: label.trim(), path: path.trim(), kind, layout: 'flat', archiveDir: '' });
				await this.changed();
			}));
	}
}
