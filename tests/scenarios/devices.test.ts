import { describe, expect, it } from 'vitest';
import { readMeta } from '../../src/core/frontmatter';
import { runSync } from '../../src/core/sync';
import { skillMd, T0 } from '../helpers';
import { StubResolver, world } from './harness';

describe('multi-device sync scenario', () => {
	it('syncs agents matching currentDevice, skips foreign devices, preserves vault states', async () => {
		const w = world(
			[
				{ id: 'codex-mb', stateKey: 'codex-macbook', devices: ['macbook'] },
				{ id: 'codex-dt', stateKey: 'codex-desktop', devices: ['desktop'] },
				{ id: 'claude', stateKey: 'claude', devices: [] }, // shared
			],
			{ currentDevice: 'macbook' },
		);

		const skillContent = skillMd('x', '# Shared skill content\n');
		// Vault note has enabled state for all three targets
		w.put(
			'vault',
			{
				'x/SKILL.md': w.vaultMd(skillContent, {
					'codex-macbook': true,
					'codex-desktop': true,
					'claude': true,
				}),
			},
			T0,
		);

		const report = await runSync(w.cfg, new StubResolver());
		expect(report.errors).toEqual([]);

		// Pushed to local matching agent and shared agent
		expect(w.tree('codex-mb')['x/SKILL.md']).toBe(skillContent);
		expect(w.tree('claude')['x/SKILL.md']).toBe(skillContent);

		// Skipped foreign device (folder remains empty)
		expect(w.tree('codex-dt')['x/SKILL.md']).toBeUndefined();

		// Vault note still preserves state for the skipped desktop agent
		const vaultRaw = w.tree('vault')['x/SKILL.md'] ?? '';
		const meta = readMeta(vaultRaw, 'agent-');
		expect(meta.states['codex-desktop']).toBe(true);
		expect(meta.states['codex-macbook']).toBe(true);
		expect(meta.states['claude']).toBe(true);
	});
});
