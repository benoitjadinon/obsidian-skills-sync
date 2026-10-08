import { FileSystemAdapter, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian';
import { join, relative, sep } from 'path';
import { detectPresets, expandHome } from './core/agents';
import { defaultBase, ensureAgentColumns } from './core/base';
import { resolveConflictFiles } from './core/conflictFiles';
import { hasMarkers } from './core/merge';
import type { SyncConfig } from './core/model';
import { isConflictFile } from './core/scan';
import { createSkill, deleteEverywhere, fillMissingSources, findAgentCopies, removeFromAgents, runSync } from './core/sync';
import { Watcher } from './core/watcher';
import { DEFAULT_SETTINGS, type HubSettings, HubSettingTab } from './settings';
import { ObsidianResolver } from './ui/resolver';
import { ConfirmModal, NewSkillModal } from './ui/simpleModals';

interface MetadataTypeManager {
	setType?(name: string, type: string): void;
}

export default class AgentSkillsHub extends Plugin {
	settings: HubSettings = { ...DEFAULT_SETTINGS };
	private watcher: Watcher | null = null;
	private busy = false;
	private again = false;
	private quietUntil = 0;
	private vaultTimer: number | null = null;
	private resolver!: ObsidianResolver;

	async onload(): Promise<void> {
		await this.loadSettings();
		if (!this.settings.initialized) {
			this.settings.agents = detectPresets();
			this.settings.initialized = true;
			await this.saveSettings();
		}
		this.resolver = new ObsidianResolver(this.app, {
			getConfig: () => this.config(),
			mergeCommand: () => this.settings.mergeCommand,
			openPath: (p) => this.openAbsolute(p),
		});
		this.addSettingTab(new HubSettingTab(this.app, this));
		this.addRibbonIcon('refresh-cw', 'Sync agent skills', () => void this.sync());

		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.sync() });
		this.addCommand({
			id: 'new-skill', name: 'New skill',
			callback: () => new NewSkillModal(this.app, this.skillNames(), (n, d) => void this.newSkill(n, d)).open(),
		});
		this.addCommand({ id: 'create-base', name: 'Create or update the skills base', callback: () => void this.ensureBase(true) });
		this.addCommand({ id: 'fill-missing-sources', name: 'Fill in missing skill sources', callback: () => void this.fillSources() });
		this.addCommand({
			id: 'delete-skill-everywhere', name: 'Delete current skill everywhere',
			checkCallback: (checking) => {
				const name = this.activeSkill();
				if (!name) return false;
				if (!checking) void this.deleteSkillEverywhere(name);
				return true;
			},
		});
		this.addCommand({
			id: 'resolve-conflict', name: 'Resolve conflict for current skill',
			checkCallback: (checking) => {
				const name = this.activeSkill();
				if (!name) return false;
				if (!checking) void this.resolveConflict(name);
				return true;
			},
		});

		this.registerEvent(this.app.vault.on('modify', (f) => this.onVaultChange(f)));
		this.registerEvent(this.app.vault.on('create', (f) => this.onVaultChange(f)));
		this.registerEvent(this.app.vault.on('rename', (f) => this.onVaultChange(f)));
		this.registerEvent(this.app.vault.on('delete', (f) => void this.onVaultDelete(f)));
		this.app.workspace.onLayoutReady(() => void this.startup());
	}

	onunload(): void {
		this.watcher?.stop();
		if (this.vaultTimer !== null) window.clearTimeout(this.vaultTimer);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<HubSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async startup(): Promise<void> {
		this.registerPropertyTypes();
		if (!this.settings.autoSync) return;
		await this.sync();
		this.restartWatcher();
	}

	restartWatcher(): void {
		this.watcher?.stop();
		this.watcher = null;
		if (!this.settings.autoSync) return;
		this.watcher = new Watcher(this.config().agents.map((a) => a.path), () => void this.sync());
		this.watcher.start();
	}

	private vaultBase(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error('Agent Skills Hub needs the desktop app.');
		return adapter.getBasePath();
	}

	config(): SyncConfig {
		const s = this.settings;
		return {
			hubDir: join(this.vaultBase(), normalizePath(s.hubFolder)),
			prefix: s.propPrefix,
			agents: s.agents.map((a) => ({ ...a, path: expandHome(a.path) })),
			autoPullExternal: s.autoPullExternal,
		};
	}

	private hubPrefix(): string {
		return `${normalizePath(this.settings.hubFolder)}/`;
	}

	private skillNameOf(path: string): string {
		return path.slice(this.hubPrefix().length).split('/')[0] ?? '';
	}

	private activeSkill(): string | null {
		const f = this.app.workspace.getActiveFile();
		if (!f || !f.path.startsWith(this.hubPrefix())) return null;
		return this.skillNameOf(f.path) || null;
	}

	/** Run fn with sync, the watcher and vault handlers quiet; queue a sync if already busy. */
	private async exclusive<T>(fn: () => Promise<T>): Promise<T | undefined> {
		if (this.busy) {
			this.again = true;
			return undefined;
		}
		this.busy = true;
		this.watcher?.pause();
		try {
			return await fn();
		} finally {
			this.busy = false;
			this.quietUntil = Date.now() + 1500;
			window.setTimeout(() => this.watcher?.resume(), 1000);
			if (this.again) {
				this.again = false;
				window.setTimeout(() => void this.sync(), 1600);
			}
		}
	}

	async sync(): Promise<void> {
		await this.exclusive(async () => {
			try {
				const report = await runSync(this.config(), this.resolver);
				const changes = report.applied.filter((a) => a.type !== 'conflict' && a.type !== 'setStates').length;
				if (changes > 0) new Notice(`Agent skills: ${changes} change${changes === 1 ? '' : 's'} synced.`);
				if (report.errors.length > 0) {
					for (const e of report.errors) console.error('[agent-skills-hub]', e);
					new Notice(`Agent skills: ${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}, see the developer console.`);
				}
			} catch (e) {
				console.error('[agent-skills-hub]', e);
				new Notice('Agent skills: sync failed, see the developer console.');
			}
		});
	}

	private onVaultChange(f: TAbstractFile): void {
		if (!f.path.startsWith(this.hubPrefix()) || this.busy) return;
		if (f instanceof TFile && isConflictFile(f.name)) {
			void this.autoResolve(f);
			return;
		}
		if (!this.settings.autoSync || Date.now() < this.quietUntil) return;
		if (this.vaultTimer !== null) window.clearTimeout(this.vaultTimer);
		this.vaultTimer = window.setTimeout(() => {
			this.vaultTimer = null;
			void this.sync();
		}, 1500);
	}

	private async autoResolve(file: TFile): Promise<void> {
		if (hasMarkers(await this.app.vault.read(file))) return;
		const name = this.skillNameOf(file.path);
		await this.exclusive(async () => {
			if ((await resolveConflictFiles(this.config(), name)) === 'ok') new Notice(`Conflict in "${name}" resolved and synced.`);
		});
	}

	private async onVaultDelete(f: TAbstractFile): Promise<void> {
		if (this.busy || Date.now() < this.quietUntil || !f.path.startsWith(this.hubPrefix())) return;
		const parts = f.path.slice(this.hubPrefix().length).split('/');
		const name = parts[0];
		if (!name || !(parts.length === 1 || (parts.length === 2 && parts[1] === 'SKILL.md'))) return;
		await this.exclusive(async () => {
			const copies = await findAgentCopies(this.config(), name);
			if (copies.length === 0) return;
			const ok = await new ConfirmModal(
				this.app,
				'Skill deleted',
				`Also remove "${name}" from ${copies.length} agent folder${copies.length === 1 ? '' : 's'}? If you keep them, the next sync imports the skill again.`,
				'Remove from agents',
			).openAndWait();
			if (!ok) return;
			const removed = await removeFromAgents(this.config(), name);
			new Notice(`Removed "${name}" from ${removed.length} agent folder${removed.length === 1 ? '' : 's'}.`);
		});
	}

	private skillNames(): string[] {
		const hub = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.hubFolder));
		return hub instanceof TFolder ? hub.children.filter((c) => c instanceof TFolder).map((c) => c.name) : [];
	}

	private async newSkill(name: string, description: string): Promise<void> {
		try {
			await this.openAbsolute(await createSkill(this.config(), name, description));
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async deleteSkillEverywhere(name: string): Promise<void> {
		const ok = await new ConfirmModal(
			this.app,
			'Delete skill everywhere',
			`Delete "${name}" from the vault and from every agent folder? This cannot be undone.`,
			'Delete',
		).openAndWait();
		if (!ok) return;
		await this.exclusive(async () => {
			const removed = await deleteEverywhere(this.config(), name);
			new Notice(`Deleted "${name}" (${removed.length} folder${removed.length === 1 ? '' : 's'}).`);
		});
	}

	private async fillSources(): Promise<void> {
		await this.exclusive(async () => {
			const changed = await fillMissingSources(this.config());
			new Notice(changed.length > 0
				? `Recorded the source of ${changed.length} skill${changed.length === 1 ? '' : 's'} (agents holding a copy now).`
				: 'Every skill already has a source.');
		});
	}

	private async resolveConflict(name: string): Promise<void> {
		await this.exclusive(async () => {
			const r = await resolveConflictFiles(this.config(), name);
			if (r === 'ok') new Notice(`Conflict in "${name}" resolved and synced.`);
			else if (r === 'markers') new Notice('Conflict markers are still present; edit the conflict file first.');
			else new Notice('This skill has no conflict files.');
		});
	}

	async ensureBase(open = false): Promise<void> {
		const s = this.settings;
		const opts = { hubFolder: normalizePath(s.hubFolder), prefix: s.propPrefix, agents: s.agents.map((a) => ({ id: a.id, label: a.label })) };
		const path = normalizePath(s.basePath);
		let file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.process(file, (t) => ensureAgentColumns(t, opts));
		} else {
			const dir = path.split('/').slice(0, -1).join('/');
			if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
			file = await this.app.vault.create(path, defaultBase(opts));
		}
		this.registerPropertyTypes();
		if (open && file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
	}

	async onAgentsChanged(): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(normalizePath(this.settings.basePath))) await this.ensureBase();
		this.registerPropertyTypes();
		this.restartWatcher();
		await this.sync();
	}

	private registerPropertyTypes(): void {
		const mtm = (this.app as unknown as { metadataTypeManager?: MetadataTypeManager }).metadataTypeManager;
		if (!mtm?.setType) return;
		const p = this.settings.propPrefix;
		for (const a of this.settings.agents) mtm.setType(`${p}${a.id}`, 'checkbox');
		mtm.setType(`${p}conflict`, 'checkbox');
		mtm.setType(`${p}skill-keys`, 'multitext');
		mtm.setType(`${p}source`, 'multitext');
		mtm.setType(`${p}path`, 'text');
		mtm.setType(`${p}folder`, 'text');
	}

	private async openAbsolute(abs: string): Promise<void> {
		const rel = normalizePath(relative(this.vaultBase(), abs).split(sep).join('/'));
		for (let i = 0; i < 10; i++) {
			const f = this.app.vault.getAbstractFileByPath(rel);
			if (f instanceof TFile) {
				await this.app.workspace.getLeaf(false).openFile(f);
				return;
			}
			await new Promise((r) => window.setTimeout(r, 200));
		}
		new Notice(`Created ${rel}`);
	}
}
