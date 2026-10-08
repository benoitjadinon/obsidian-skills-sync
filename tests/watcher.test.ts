import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { type Timers, Watcher } from '../src/core/watcher';
import { tmp } from './helpers';

/** Timers you advance by hand: no real waiting, no flakiness. */
function manualTimers(): Timers & { flush(): void; pending(): number } {
	let next = 1;
	const queue = new Map<number, () => void>();
	return {
		setTimeout: (fn) => {
			const id = next++;
			queue.set(id, fn);
			return id;
		},
		clearTimeout: (id) => void queue.delete(id),
		flush: () => {
			const fns = [...queue.values()];
			queue.clear();
			for (const fn of fns) fn();
		},
		pending: () => queue.size,
	};
}

describe('Watcher debounce and pause', () => {
	it('collapses a burst of changes into one callback', () => {
		const timers = manualTimers();
		let calls = 0;
		const w = new Watcher([], () => calls++, timers, 300);
		w.notify();
		w.notify();
		w.notify();
		expect(timers.pending()).toBe(1);
		timers.flush();
		expect(calls).toBe(1);
	});

	it('ignores changes while paused and reacts again after resume', () => {
		const timers = manualTimers();
		let calls = 0;
		const w = new Watcher([], () => calls++, timers, 300);
		w.pause();
		w.notify();
		expect(timers.pending()).toBe(0);
		w.resume();
		w.notify();
		timers.flush();
		expect(calls).toBe(1);
	});
});

describe('Watcher on a real folder', () => {
	it('notices a file change and tolerates missing folders', async () => {
		const dir = tmp();
		let calls = 0;
		const timers = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number) => clearTimeout(id) };
		const w = new Watcher([dir, join(dir, 'missing')], () => calls++, timers, 50);
		w.start();
		writeFileSync(join(dir, 'a'), '1');
		for (let i = 0; i < 60 && calls === 0; i++) await new Promise((r) => setTimeout(r, 50));
		w.stop();
		expect(calls).toBeGreaterThanOrEqual(1);
	});
});
