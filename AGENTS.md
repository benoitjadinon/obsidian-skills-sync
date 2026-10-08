# Skills Sync (Obsidian community plugin)

## Project overview

- Plugin id `skills-sync`, desktop only (`isDesktopOnly: true`, uses Node `fs`), `minAppVersion` 1.9.0.
- Entry point: `src/main.ts` compiled to `main.js`. Release artifacts: `main.js`, `manifest.json`, `styles.css`.
- Purpose: keep AI agent skills (folders with `SKILL.md`) in one vault folder, list them in a `.base` with one tri-state checkbox column per agent, and sync real copies (never symlinks) to and from each agent's skills folder. User-facing behavior is documented in `README.md`. Local design and planning notes may live in `docs/superpowers/` (git-ignored, not part of the repo).

### Architecture

- `src/core/` holds all sync logic and **must not import `obsidian`**, so it runs under vitest on temp folders. Import Node builtins without the `node:` prefix (`fs`, `path`, `os`, `crypto`, `child_process`), so esbuild's externals match.
- Pipeline: `scan.ts` reads the vault and agent folders into `SkillCopy` snapshots (lenient `contentKey`) → `group.ts` matches copies to skills by leaf folder name (duplicates are dropped or split) → `engine.ts` `planGroup` turns them into `Action[]` (pure, no I/O) → `executor.ts` applies them to disk → `sync.ts` `runSync` orchestrates and sends conflicts to an injected `Resolver`.
- Other core modules:
  - `frontmatter.ts`: textual frontmatter editing that never re-serializes YAML, so exports stay byte-identical.
  - `merge.ts`, `conflictFiles.ts`, `externalMerge.ts`: three-way merge, `SKILL.conflict.md`, and the external merge tool.
  - `migrate.ts`: symlink → copy migration.
  - `base.ts`: `.base` generation and column updates.
  - `agents.ts`: agent presets, built from `agentPresets.generated.json` plus a small `OVERRIDES` map (short legacy ids like `claude`, the shared `~/.agents` label, and the Hermes layout and archive).
  - `watcher.ts`: `fs.watch` with debounce.
- The Obsidian layer: `main.ts` (commands, vault events, watcher gating via `exclusive()`), `settings.ts`, and `ui/` (modals, and `ObsidianResolver`, the resolver backed by them).

### Invariants (don't break these)

- No sync state outside frontmatter (no JSON or database). Plugin keys share a prefix (default `agent-`):
  - `agent-<id>` (tri-state);
  - `agent-skill-keys`;
  - `agent-source`;
  - `agent-path`;
  - `agent-folder`;
  - `agent-conflict`.

  The suffixes in `RESERVED` (`frontmatter.ts`) can't be agent ids.
- Exported `SKILL.md` keeps only the keys listed in `agent-skill-keys`, raw and in order; an empty list means no frontmatter block. User keys and plugin keys never reach agents.
- Undecided (empty) agents are never pushed to, pulled from or deleted from.
- `agent-source` is written only on import (and by the **Fill in missing skill sources** backfill when absent); sync must preserve it as is.
- Every delete or move goes through `assertInside` (agent root) and never writes through a symlinked skill folder.

### Validating user input

- Every rule lives in `src/core/validate.ts` (pure, unit-tested in `tests/validate.test.ts`). Validators return a short message or `null`.
- In the UI:
  - show errors with `showFieldError` (`ui/fieldErrors.ts`);
  - never save an invalid settings value (`saveIfValid` in `settings.ts`);
  - keep Save/Add/Create buttons disabled until the form is valid;
  - on new forms, show errors only for fields the user has touched.
- Normalize as the user types where possible, for example `normalizeIdInput` for agent IDs.

### Updating the agent presets

- `npm run presets:update [-- <tag>]` (`scripts/update-presets.mjs`) downloads `src/agents.ts` from vercel-labs/skills at a pinned tag (default in the script, currently `v1.7.1`). It evaluates the table in a child process with a fake `HOME` and an empty environment, then rewrites `src/core/agentPresets.generated.json`.
- Commit the regenerated JSON. The plugin never fetches presets at runtime.
- Only agents with a global skills folder under home are kept, and the first agent wins when several share a folder.
- Keep the ids of already-shipped presets stable through `OVERRIDES`: they become property names in users' notes.

### Adding a plugin property

1. Add it to `PluginMeta` (`model.ts`) and `emptyMeta`.
2. Add it to `readMeta` and `renderMeta` (`frontmatter.ts`), and add its suffix to `RESERVED`.
3. Set it where skills are created or imported (`engine.ts` import action, `executor.importSkill`, `sync.applyResolution`).
4. If it should show in the base, add a column in `base.ts` (`defaultBase` and `ensureAgentColumns`).
5. Register its property type in `main.ts` `registerPropertyTypes`.
6. Document it in `README.md`.

## Environment & tooling

- Node.js: use current LTS (Node 18+ recommended).
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- ESLint is preconfigured with `eslint-plugin-obsidianmd` for Obsidian-specific rules.
- Run `npm run lint` to lint the project.
- A GitHub Action automatically lints every commit on all branches.

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Actual file structure**:
    ```
    src/
      main.ts            # Plugin lifecycle, commands, vault events, watcher gating
      settings.ts        # Settings interface, defaults, settings tab
      core/              # Obsidian-free sync logic (see Architecture)
      ui/                # ConflictModal, simpleModals, resolver
    tests/
      helpers.ts         # temp dirs, put/tree/touch, skillMd, fixed dates
      *.test.ts          # unit tests per core module
      scenarios/         # end-to-end sync scenarios (harness.ts: world(), StubResolver, keep())
    ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):
    - `id` (plugin ID; for local dev it should match the folder name)
    - `name`
    - `version` (Semantic Versioning `x.y.z`)
    - `minAppVersion`
    - `description`
    - `isDesktopOnly` (boolean)
    - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- `npm test` runs vitest (pinned to v3, because v5 conflicts with esbuild 0.25). Unit tests cover each core module; `tests/scenarios/` builds a temp vault plus temp agent folders and runs a full `runSync` with a `StubResolver`.
- Tests must use temp dirs only. Never touch real agent folders (`~/.claude`, `~/.hermes`, …) or a real vault.
- Set file mtimes explicitly (`put(..., T0)` / `touch`). Sync direction depends on dates; for example, a single ticked agent loses to a newer vault note.
- `tests/watcher.test.ts` is timing-based and can flake under heavy load; rerun before investigating.
- `npm run build` runs `tsc` (`moduleResolution: bundler`, which `node-diff3` types need) and esbuild. `npm run lint` must report 0 errors; the remaining warnings are known.
- Manual check: `docs/e2e-checklist.md`, in a scratch vault whose `data.json` is pre-seeded with `initialized: true` and `agents: []`, so the plugin doesn't auto-detect real agent folders.
- Manual install: copy `main.js`, `manifest.json` and `styles.css` to `<Vault>/.obsidian/plugins/skills-sync/`, then reload Obsidian and enable the plugin.

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` to map plugin version → minimum app version.
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process to add/update your plugin in the community catalog as required.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**

- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**

- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):

```ts
import { Plugin } from 'obsidian';
import { MySettings, DEFAULT_SETTINGS } from './settings';
import { registerCommands } from './commands';

export default class MyPlugin extends Plugin {
	settings!: MySettings;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MySettings>,
		);
		registerCommands(this);
	}
}
```

**settings.ts**:

```ts
export interface MySettings {
	enabled: boolean;
	apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
	enabled: true,
	apiKey: '',
};
```

**commands/index.ts**:

```ts
import { Plugin } from 'obsidian';
import { doSomething } from './my-command';

export function registerCommands(plugin: Plugin) {
	plugin.addCommand({
		id: 'do-something',
		name: 'Do something',
		callback: () => doSomething(plugin),
	});
}
```

### Add a command

```ts
this.addCommand({
	id: 'your-command-id',
	name: 'Do the thing',
	callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MySettings>);
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(
	this.app.workspace.on('file-open', (f) => {
		/* ... */
	}),
);
this.registerDomEvent(activeWindow, 'resize', () => {
	/* ... */
});
this.registerInterval(
	window.setInterval(() => {
		/* ... */
	}, 1000),
);
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`.
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
