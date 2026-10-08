// Regenerates src/core/agentPresets.generated.json from the agent table of vercel-labs/skills
// (MIT, https://github.com/vercel-labs/skills). Usage: npm run presets:update [-- <tag>]
// The table is evaluated in a child process with a fake HOME and an empty environment, so paths
// come out as "~/…" and no local env overrides (CLAUDE_CONFIG_DIR, …) leak in.
// Every agent with a global folder under home is kept, even when several share one folder.
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TAG = process.argv[2] ?? 'v1.7.1';
const SOURCE = `https://raw.githubusercontent.com/vercel-labs/skills/${TAG}/src/agents.ts`;
const FAKE_HOME = '/__ASH_HOME__';
const OUT = new URL('../src/core/agentPresets.generated.json', import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Download failed (${res.status}): ${SOURCE}`);
const source = await res.text();

const dir = mkdtempSync(join(tmpdir(), 'ash-presets-'));
try {
	writeFileSync(join(dir, 'agents.ts'), source);
	writeFileSync(join(dir, 'types.ts'), 'export type AgentConfig = any; export type AgentType = string;\n');
	writeFileSync(
		join(dir, 'entry.ts'),
		`import { agents } from './agents.ts';
const out = Object.values(agents).map((a: any) => ({ name: a.name, displayName: a.displayName, globalSkillsDir: a.globalSkillsDir ?? null, skillsDir: a.skillsDir ?? null }));
process.stdout.write(JSON.stringify(out));
`,
	);
	await build({
		entryPoints: [join(dir, 'entry.ts')],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile: join(dir, 'entry.mjs'),
		logLevel: 'silent',
		plugins: [{
			name: 'stub-xdg',
			setup(b) {
				b.onResolve({ filter: /^xdg-basedir$/ }, () => ({ path: 'xdg', namespace: 'stub' }));
				b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const xdgConfig = undefined;', loader: 'js' }));
			},
		}],
	});
	const raw = execFileSync(process.execPath, [join(dir, 'entry.mjs')], {
		env: { HOME: FAKE_HOME, PATH: process.env.PATH ?? '' },
		encoding: 'utf8',
	});
	const rows = JSON.parse(raw);
	const presets = [];
	const seen = new Set();
	for (const r of rows) {
		if (typeof r.name !== 'string' || typeof r.displayName !== 'string') throw new Error(`Unexpected agent shape: ${JSON.stringify(r)}`);
		if (typeof r.globalSkillsDir !== 'string' || !r.globalSkillsDir.startsWith(`${FAKE_HOME}/`)) continue; // no global folder, or not under home
		if (seen.has(r.name)) continue;
		seen.add(r.name);
		// Agents sharing a folder (e.g. ~/.agents/skills) are all kept; the plugin resolves overlaps.
		presets.push({
			name: r.name,
			label: r.displayName,
			path: `~${r.globalSkillsDir.slice(FAKE_HOME.length)}`,
			// Project-relative skills folder (e.g. .claude/skills), used for project columns.
			projectDir: typeof r.skillsDir === 'string' && !r.skillsDir.startsWith('/') ? r.skillsDir : null,
		});
	}
	if (presets.length < 10) throw new Error(`Only ${presets.length} presets extracted; the source format probably changed`);
	writeFileSync(OUT, `${JSON.stringify({ source: `vercel-labs/skills@${TAG}`, presets }, null, '\t')}\n`);
	console.log(`Wrote ${presets.length} presets from vercel-labs/skills@${TAG} (${rows.length} agents in the table).`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
