import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Watcher } from '../src/core/watcher';
import { tmp } from './helpers';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Watcher', () => {
	it('debounces changes into one callback and ignores them while paused', async () => {
		const dir = tmp();
		let calls = 0;
		const w = new Watcher([dir, join(dir, 'missing')], () => calls++, 300);
		w.start();
		writeFileSync(join(dir, 'a'), '1');
		writeFileSync(join(dir, 'b'), '2');
		await wait(1200);
		expect(calls).toBe(1);
		w.pause();
		writeFileSync(join(dir, 'c'), '3');
		await wait(800);
		expect(calls).toBe(1);
		w.resume();
		w.stop();
	});
});
