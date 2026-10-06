/** True when the first 8000 bytes contain a NUL byte. */
export function isBinary(data: Uint8Array): boolean {
	const n = Math.min(data.length, 8000);
	for (let i = 0; i < n; i++) if (data[i] === 0) return true;
	return false;
}

/**
 * Canonical form used only for comparison, never written:
 * LF line endings, no BOM, no trailing whitespace, no leading/trailing blank lines,
 * no blank lines directly after a frontmatter block.
 */
export function normalizeText(text: string): string {
	const lines = text
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => l.replace(/[ \t]+$/, ''));
	if (lines[0] === '---') {
		const close = lines.indexOf('---', 1);
		if (close > 0) {
			let j = close + 1;
			while (j < lines.length && lines[j] === '') j++;
			lines.splice(close + 1, j - close - 1);
		}
	}
	while (lines.length > 0 && lines[0] === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines.join('\n');
}
