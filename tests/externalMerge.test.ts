import { describe, expect, it } from 'vitest';
import { describeMergeError, MERGE_TOOL_PRESETS, runExternalMerge } from '../src/core/externalMerge';
import { validateMergeCommand } from '../src/core/validate';

describe('merge tool errors', () => {
	it('explains a missing tool instead of showing the raw shell error', async () => {
		const template = 'definitely-not-a-merge-tool-xyz {ours} {theirs} {result}';
		const err = await runExternalMerge(template, { ours: 'a', base: null, theirs: 'b', initial: 'x' }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect(describeMergeError(err, template)).toBe(
			'Merge tool not found: "definitely-not-a-merge-tool-xyz". Install it, add it to your PATH, or set a different command in settings.',
		);
	});
	it('keeps other failures readable', () => {
		expect(describeMergeError(Object.assign(new Error('Command failed'), { code: 2 }), 'meld {ours} {theirs} {result}')).toBe(
			'The merge tool "meld" exited with an error (code 2). Nothing was applied.',
		);
	});
});

describe('merge tool presets', () => {
	it('are all valid commands', () => {
		expect(MERGE_TOOL_PRESETS.length).toBeGreaterThanOrEqual(4);
		for (const p of MERGE_TOOL_PRESETS) expect(validateMergeCommand(p.command)).toBeNull();
	});
});
