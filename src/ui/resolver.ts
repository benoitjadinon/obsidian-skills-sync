import type { App } from 'obsidian';
import type { ConflictRequest, MigrationItem, Resolution, Resolver } from '../core/sync';
import { ConflictModal, type ConflictUiDeps } from './ConflictModal';
import { MigrationModal } from './simpleModals';

export class ObsidianResolver implements Resolver {
	/** Paths the user declined to migrate this session (asked again after a restart). */
	private declined = new Set<string>();

	constructor(private readonly app: App, private readonly deps: ConflictUiDeps) {}

	resolve(req: ConflictRequest): Promise<Resolution> {
		return new ConflictModal(this.app, req, this.deps).openAndWait();
	}

	async confirmMigration(items: MigrationItem[]): Promise<boolean> {
		const fresh = items.filter((i) => !this.declined.has(i.linkPath));
		if (fresh.length === 0) return false;
		const ok = await new MigrationModal(this.app, items).openAndWait();
		if (!ok) for (const i of items) this.declined.add(i.linkPath);
		return ok;
	}
}
