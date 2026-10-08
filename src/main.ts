import { FileSystemAdapter, normalizePath, Notice, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian';
import { join, relative, sep } from 'path';
import { detectPresets, expandHome, inferPreset, presetsFor } from './core/agents';
import { type BaseOptions, defaultBase, ensureAgentColumns, isUnavailableColumn, listTableViews, removeAgentColumn } from './core/base';
import { mergeOnSave, migrateSettings } from './core/settingsStore';
import { existsSync } from 'fs';
import { resolveConflictFiles } from './core/conflictFiles';
import { hasMarkers } from './core/merge';
import type { SyncConfig } from './core/model';
import { isConflictFile } from './core/scan';
import { projectColumns, switchStates, syncTargets } from './core/projects';
import { createSkill, deleteEverywhere, removeAgentFromNotes, rewriteStates, fillMissingSources, findAgentCopies, removeFromAgents, runSync } from './core/sync';
import { Watcher } from './core/watcher';
import { DEFAULT_SETTINGS, type HubSettings, HubSettingTab } from './settings';
import { ObsidianResolver } from './ui/resolver';
import { ConfirmModal, NewSkillModal } from './ui/simpleModals';

/** Per-computer settings in Obsidian's per-device storage (never synced with the vault). */
const LOCAL_KEY = 'skills-sync-local';
/** Where the previous version kept this computer's id (to pick up its merge tool once). */
const OLD_DEVICE_KEY = 'skills-sync-device';

interface LocalSettings {
	mergeCommand: string;
	/** This computer's installed agents were already added to the shared list. */
	detected: boolean;
}

interface MetadataTypeManager {
	setType?(name: string, type: string): void;
}

export default class AgentSkillsHub extends Plugin {
	settings: HubSettings = { ...DEFAULT_SETTINGS };
	/** Settings as last loaded from disk (to merge with another computer's changes on save). */
	private loaded: HubSettings = { ...DEFAULT_SETTINGS };
	private migrated = false;
	private observers = new Map<HTMLElement, MutationObserver>();
	private availableCache: string[] = [];
	private settingTab: HubSettingTab | null = null;
	private watcher: Watcher | null = null;
	private busy = false;
	private again = false;
	private quietUntil = 0;
	private vaultTimer: number | null = null;
	private resolver!: ObsidianResolver;

	async onload(): Promise<void> {
		await this.loadSettings();
		// Remember which agents came from a preset (settings saved before the field existed).
		let migrated = false;
		const known = presetsFor();
		for (const a of this.settings.agents) {
			if (a.kind !== 'agent') continue;
			if (!a.preset) {
				const preset = inferPreset(a);
				if (preset) {
					a.preset = preset;
					migrated = true;
				}
			}
			// Agents saved before project folders existed get their preset's project skills folder.
			if (a.projectDir === undefined && a.preset) {
				const projectDir = known.find((p) => p.id === a.preset)?.projectDir;
				if (projectDir) {
					a.projectDir = projectDir;
					migrated = true;
				}
			}
		}
		// First start on this computer: add its installed agents to the shared list.
		const local = this.local();
		if (!local.detected) {
			for (const a of detectPresets()) {
				const path = expandHome(a.path);
				if (!this.settings.agents.some((x) => x.id === a.id || expandHome(x.path) === path)) this.settings.agents.push(a);
			}
			this.saveLocal({ ...local, detected: true });
			migrated = true;
		}
		if (migrated || this.migrated) await this.saveSettings();
		this.resolver = new ObsidianResolver(this.app, {
			getConfig: () => this.config(),
			mergeCommand: () => this.settings.mergeCommand,
			openPath: (p) => this.openAbsolute(p),
		});
		this.settingTab = new HubSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
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
		for (const o of this.observers.values()) o.disconnect();
		this.observers.clear();
	}

	private local(): LocalSettings {
		const saved = this.app.loadLocalStorage(LOCAL_KEY) as Partial<LocalSettings> | null;
		return { mergeCommand: saved?.mergeCommand ?? '', detected: saved?.detected ?? false };
	}

	private saveLocal(local: LocalSettings): void {
		this.app.saveLocalStorage(LOCAL_KEY, local);
	}

	async loadSettings(): Promise<void> {
		const { settings, mergeCommands, changed } = migrateSettings(await this.loadData());
		const local = this.local();
		// Earlier versions kept the merge tool in data.json (per computer since v2): move it here once.
		if (!local.mergeCommand) {
			const oldId = (this.app.loadLocalStorage(OLD_DEVICE_KEY) as { id?: string } | null)?.id ?? '';
			const moved = mergeCommands[oldId] ?? mergeCommands[''];
			if (moved) this.saveLocal({ ...local, mergeCommand: moved, detected: local.detected || Boolean(oldId) || '' in mergeCommands });
		}
		if (changed && !this.local().detected) this.saveLocal({ ...this.local(), detected: true });
		this.migrated = changed;
		this.settings = { ...settings, mergeCommand: this.local().mergeCommand };
		this.loaded = structuredClone(this.settings);
	}

	async saveSettings(): Promise<void> {
		this.saveLocal({ ...this.local(), mergeCommand: this.settings.mergeCommand });
		// Merge with what is on disk now: another computer may have added agents or projects (git pull, Sync).
		const stored = mergeOnSave(await this.loadData(), this.loaded, this.settings);
		await this.saveData(stored);
		this.settings = { ...stored, mergeCommand: this.settings.mergeCommand };
		this.loaded = structuredClone(this.settings);
		this.migrated = false;
		this.updateGreying();
	}

	/** data.json changed on disk (e.g. the other computer's settings arrived): reload. */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.registerPropertyTypes();
		this.restartWatcher();
		this.updateGreying();
		this.settingTab?.refreshIfOpen();
	}

	/** Table views of the base file, for the view selector. */
	async baseViews(): Promise<string[]> {
		const file = this.app.vault.getAbstractFileByPath(this.basePath());
		return file instanceof TFile ? listTableViews(await this.app.vault.cachedRead(file)) : [];
	}

	/** The base file (shared by every computer). */
	basePath(): string {
		return normalizePath(this.settings.basePath);
	}

	/** Whether an agent or project can sync on this computer (its folder exists here). */
	isAvailable(item: { path?: string; root?: string }): boolean {
		return existsSync(expandHome(item.root ?? item.path ?? ''));
	}

	/** Columns of agents and projects available on this computer. */
	availableColumns(): string[] {
		const s = this.settings;
		return [
			...s.agents.filter((a) => this.isAvailable(a)).map((a) => a.id),
			...s.projects.filter((p) => this.isAvailable(p)).flatMap((p) => projectColumns(p, s.agents).map((c) => c.id)),
		];
	}

	/**
	 * Grey (on screen only) the base cells of agents and projects not available on this computer:
	 * mark them with a class styled in styles.css, and keep marking rows Bases renders later.
	 */
	updateGreying(): void {
		this.availableCache = this.availableColumns();
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			const root = leaf.view.containerEl;
			if (!this.observers.has(root)) {
				const observer = new MutationObserver(() => this.markCells(root));
				observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-property'] });
				this.observers.set(root, observer);
			}
			this.markCells(root);
		}
	}

	private markCells(root: HTMLElement): void {
		const prefix = this.settings.propPrefix;
		for (const cell of Array.from(root.querySelectorAll<HTMLElement>('.bases-td[data-property]'))) {
			cell.toggleClass('ash-unavailable', isUnavailableColumn(cell.getAttribute('data-property') ?? '', prefix, this.availableCache));
		}
	}

	/** Earlier versions named the base after the computer ("skills (Mac).base"): restore the shared name. */
	private async restoreBaseName(): Promise<void> {
		const path = this.basePath();
		if (this.app.vault.getAbstractFileByPath(path)) return;
		const stem = path.replace(/\.base$/, '');
		const old = this.app.vault.getFiles().find((f) => f.extension === 'base' && f.path.startsWith(`${stem} (`) && f.path.endsWith(').base'));
		if (old) await this.app.fileManager.renameFile(old, path);
	}

	private async startup(): Promise<void> {
		await this.restoreBaseName();
		this.registerPropertyTypes();
		this.updateGreying();
		this.registerEvent(this.app.workspace.on('layout-change', () => this.updateGreying()));
		if (!this.settings.autoSync) return;
		await this.sync();
		this.restartWatcher();
	}

	restartWatcher(): void {
		this.watcher?.stop();
		this.watcher = null;
		if (!this.settings.autoSync) return;
		this.watcher = new Watcher(this.config().agents.map((a) => a.path), () => void this.sync(), {
			setTimeout: (fn, ms) => window.setTimeout(fn, ms),
			clearTimeout: (id) => window.clearTimeout(id),
		});
		this.watcher.start();
	}

	private vaultBase(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error('Skills Sync needs the desktop app.');
		return adapter.getBasePath();
	}

	config(): SyncConfig {
		const s = this.settings;
		return {
			hubDir: join(this.vaultBase(), normalizePath(s.hubFolder)),
			prefix: s.propPrefix,
			agents: syncTargets(s.agents.map((a) => ({ ...a, path: expandHome(a.path) })), s.projects),
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
				if (changes > 0) new Notice(`Synced ${changes} skill change${changes === 1 ? '' : 's'}.`);
				if (report.errors.length > 0) {
					for (const e of report.errors) console.error('[skills-sync]', e);
					new Notice(`Skill sync hit ${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}, see the developer console.`);
				}
			} catch (e) {
				console.error('[skills-sync]', e);
				new Notice('Skill sync failed, see the developer console.');
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
		const opts = { hubFolder: normalizePath(s.hubFolder), prefix: s.propPrefix, agents: this.columns(), view: s.baseView };
		const path = this.basePath();
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

	/** After an agent or project was removed from settings: delete its properties from every skill note and its base columns. */
	async removeColumns(ids: string[]): Promise<void> {
		await this.exclusive(async () => {
			const changed = new Set<string>();
			for (const id of ids) for (const name of await removeAgentFromNotes(this.config(), id)) changed.add(name);
			await this.processBase((t, remaining) => ids.reduce((text, id) => removeAgentColumn(text, remaining, id), t));
			new Notice(`Removed ${ids.length === 1 ? `${this.settings.propPrefix}${ids[0]}` : `${ids.length} columns`} from ${changed.size} skill note${changed.size === 1 ? '' : 's'}.`);
		});
	}

	/** A project switched between one column and one per agent: move every skill's choices, drop the old columns. */
	async switchColumns(from: string[], to: string[]): Promise<void> {
		await this.exclusive(async () => {
			await rewriteStates(this.config(), (states) => switchStates(states, from, to));
			const gone = from.filter((id) => !to.includes(id));
			await this.processBase((t, remaining) => gone.reduce((text, id) => removeAgentColumn(text, remaining, id), t));
		});
	}

	private async processBase(fn: (text: string, remaining: BaseOptions) => string): Promise<void> {
		const base = this.app.vault.getAbstractFileByPath(this.basePath());
		if (!(base instanceof TFile)) return;
		const s = this.settings;
		const remaining: BaseOptions = { hubFolder: normalizePath(s.hubFolder), prefix: s.propPrefix, agents: this.columns() };
		await this.app.vault.process(base, (t) => fn(t, remaining));
	}

	async onAgentsChanged(): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(this.basePath())) await this.ensureBase();
		this.registerPropertyTypes();
		this.restartWatcher();
		await this.sync();
	}

	/** Every checkbox column of the base: one per agent, then the projects' columns. */
	columns(): { id: string; label: string }[] {
		const agents = this.settings.agents;
		return [...agents.map((a) => ({ id: a.id, label: a.label })), ...this.settings.projects.flatMap((p) => projectColumns(p, agents))];
	}

	private registerPropertyTypes(): void {
		const mtm = (this.app as unknown as { metadataTypeManager?: MetadataTypeManager }).metadataTypeManager;
		if (!mtm?.setType) return;
		const p = this.settings.propPrefix;
		for (const c of this.columns()) mtm.setType(`${p}${c.id}`, 'checkbox');
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
