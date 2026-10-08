import { readdirSync, watch, type FSWatcher } from 'fs';
import { join } from 'path';

/** Timer functions, injected so the plugin can use popout-safe window timers and tests can use Node's. */
export interface Timers {
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(id: number): void;
}

export class Watcher {
	private watchers: FSWatcher[] = [];
	private timer: number | null = null;
	private paused = 0;

	constructor(
		private readonly paths: string[],
		private readonly onChange: () => void,
		private readonly timers: Timers,
		private readonly delayMs = 1500,
	) {}

	start(): void {
		const recursive = process.platform !== 'linux';
		for (const p of this.paths) {
			const targets = [p];
			if (!recursive) {
				try {
					for (const e of readdirSync(p, { withFileTypes: true })) if (e.isDirectory()) targets.push(join(p, e.name));
				} catch {
					continue;
				}
			}
			for (const t of targets) {
				try {
					const w = watch(t, { recursive }, () => this.trigger());
					w.on('error', () => undefined);
					this.watchers.push(w);
				} catch {
					// Folder missing: nothing to watch.
				}
			}
		}
	}

	stop(): void {
		for (const w of this.watchers) w.close();
		this.watchers = [];
		if (this.timer !== null) this.timers.clearTimeout(this.timer);
		this.timer = null;
	}

	pause(): void {
		this.paused++;
	}

	resume(): void {
		this.paused = Math.max(0, this.paused - 1);
	}

	private trigger(): void {
		if (this.paused > 0) return;
		if (this.timer !== null) this.timers.clearTimeout(this.timer);
		this.timer = this.timers.setTimeout(() => {
			this.timer = null;
			this.onChange();
		}, this.delayMs);
	}
}
