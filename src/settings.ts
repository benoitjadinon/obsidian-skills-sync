import { App, FileSystemAdapter, normalizePath, Notice, PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import { existsSync } from 'fs';
import { isAbsolute, join, relative, sep } from 'path';
import { expandHome } from './core/agents';
import type { AgentConfig } from './core/model';
import type AgentSkillsHub from './main';
import { AgentModal } from './ui/AgentModal';
import { showFieldError } from './ui/fieldErrors';
import { addFolderBrowse } from './ui/folderPicker';
import { validateBasePath, validateHubFolder, validateMergeCommand, validatePrefix } from './core/validate';
import { ConfirmModal } from './ui/simpleModals';

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
		const merge = new Setting(containerEl)
			.setName('Merge tool command')
			.setDesc('Placeholders: {ours} {base} {theirs} {result}. Use an absolute path if the tool is not found.');
		merge.addText((t) => t.setValue(s.mergeCommand).onChange((v) => this.saveIfValid(merge, t, validateMergeCommand(v), () => {
			s.mergeCommand = v.trim();
		})));

		this.renderList(containerEl, 'agent');
		this.renderList(containerEl, 'project');
	}

	private renderList(el: HTMLElement, kind: AgentConfig['kind']): void {
		const s = this.plugin.settings;
		new Setting(el).setName(kind === 'agent' ? 'Agents' : 'Projects').setHeading();
		const items = s.agents.filter((a) => a.kind === kind);
		if (items.length === 0) {
			el.createEl('p', { cls: 'setting-item-description', text: kind === 'agent' ? 'No agents yet.' : 'No project skills folders yet.' });
		}
		for (const a of items) {
			const layout = a.layout === 'nested' ? 'category subfolders' : 'flat';
			const archive = a.archiveDir ? ` · archive ${a.archiveDir}` : '';
			const missing = existsSync(expandHome(a.path)) ? '' : ' · folder not found';
			new Setting(el)
				.setName(a.label)
				.setDesc(`${a.path} · ${layout}${archive} · ${s.propPrefix}${a.id}${missing}`)
				.addExtraButton((b) => b.setIcon('pencil').setTooltip('Edit').onClick(() => this.openForm(kind, a)))
				.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove').onClick(async () => {
					const ok = await new ConfirmModal(
						this.app,
						`Remove ${a.label}?`,
						`Agent Skills Hub stops syncing ${a.path}. Its skill files and the ${s.propPrefix}${a.id} properties in your notes are kept.`,
						'Remove',
					).openAndWait();
					if (!ok) return;
					s.agents = s.agents.filter((x) => x !== a);
					await this.changed();
				}));
		}
		new Setting(el).addButton((b) => b
			.setButtonText(kind === 'agent' ? 'Add agent…' : 'Add project…')
			.onClick(() => this.openForm(kind)));
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
