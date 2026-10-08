# Agent Skills Hub

## What it does

Agent Skills Hub keeps your agent skills (folders with a `SKILL.md` plus optional `scripts/`, `references/`, …) in one vault folder, lists them in a `.base` with one checkbox column per agent, and syncs **real copies** of each skill folder to and from every agent's skills folder (`~/.claude/skills`, `~/.codex/skills`, `~/.hermes/skills`, project folders, …). It never uses symlinks, and it keeps no sync database: all state lives in each skill note's frontmatter.

| Property (default prefix `agent-`) | Meaning |
|---|---|
| `agent-<id>` | Tri-state per agent. `true`: share the skill with that agent. `false`: don't share; the plugin removes (or archives) the agent's copy. Empty: undecided; the plugin never touches that agent's copy. |
| `agent-skill-keys` | The skill's own frontmatter keys, in original order. Only these keys are written to agents' `SKILL.md`; an empty list means no frontmatter block. |
| `agent-source` | The agents the skill was imported from (every agent holding a copy at import time, archived copies included). Written once on import, never changed by sync, so you can correct it by hand. Skills created with **New skill** start with `[]`. |
| `agent-path` | Category path for agents with category subfolders (for example Hermes: `github` → `~/.hermes/skills/github/<skill>/`). Flat agents ignore it. |
| `agent-folder` | Folder name to export under, when it differs from the vault folder (two different skills with the same name in different categories). |
| `agent-conflict` | Set to `true` when a conflict was skipped, so the base's **Conflicts** view lists it. |

## Setup

1. Install the plugin: copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/agent-skills-hub/`, then enable it in **Settings → Community plugins**. The plugin is desktop only.
2. In **Settings → Agent Skills Hub**, set the **Skills folder** (default `Skills`). Each skill is a subfolder of it.
3. Check the detected agents. On first start, every known agent whose skills folder exists is added. The list of known agents (about 70, from Claude Code and Codex to Hermes and Windsurf) is generated from the agent table of [vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT); the **Start from** menu of the agent form offers the ones you haven't configured, those installed on your computer first. Agents and projects are listed read-only; use **Add agent…** / **Add project…** or the pencil button to open the full form (preset, name, ID, skills folder, layout, archive folder). The ID becomes the property name (`agent-<id>`) and can't change after creation. Removing an agent only stops syncing it; files and note properties are kept. Every folder path can be typed or pasted, or chosen with the folder button next to it (native picker, hidden folders shown); paths under your home folder are stored as `~/…`.
4. Run the command **Create or update the skills base**. It creates the base (default `Skills/Skills.base`) or adds the missing agent and **Source** columns to an existing one.
5. Upgrading from a version without `agent-source`: run **Fill in missing skill sources** once. Notes without the property get the agents that currently hold a copy (not necessarily the true origin; edit it if you remember better). Notes that already have it are left alone.

Sync runs on startup, when an agent folder changes, and shortly after you edit a skill in the vault (turn off **Sync automatically** to only sync with **Sync now** or the ribbon icon).

## Commands

| Command | What it does |
|---|---|
| **Sync now** (also the ribbon icon) | Runs a full sync. |
| **New skill** | Creates `<skills folder>/<name>/SKILL.md` with every agent undecided. Nothing is pushed until you tick agents. |
| **Create or update the skills base** | Creates the base, or adds missing agent and Source columns to it. |
| **Fill in missing skill sources** | Backfills `agent-source` on notes that don't have it yet. |
| **Delete current skill everywhere** | Deletes the skill from the vault and from every agent folder (asks first). |
| **Resolve conflict for current skill** | Applies edited `*.conflict*` files once no markers are left. |

## How sync decides

For each skill name (the union of vault skills and agent copies), only agents ticked `true` whose copy exists count as the "consensus". Agents left empty are ignored completely.

1. **New in an agent**: a skill found in an agent but not in the vault is imported. Agents holding it are ticked (archived copies unticked), the others stay empty, and all of them are recorded in `agent-source`. If several agents hold different versions, you pick one.
2. **Ticked but missing**: an agent ticked `true` without a copy gets one.
3. **Unticked**: an agent set to `false` that still has a copy loses it, if it matches the vault. If it differs, you are asked first (keep the vault version, or pull the agent's version into the vault, then remove). Agents with an archive folder get the copy moved to the archive instead, and ticking moves it back. The archive folder can be relative to the agent's skills folder (`.archive`) or anywhere else (`~/archives/hermes-skills`, `/mnt/backup/skills`), including another disk.
4. **Everything equal**: nothing happens.
5. **Vault changed**: if the vault differs while the ticked agents agree among themselves, a newer vault copy is pushed; an older one is a conflict.
6. **Updated by another tool**: if some ticked agents differ while the rest still match the vault, that's an external update. You are asked, or it's pulled into the vault and pushed to the other agents automatically when **Updates made by other tools** is set to pull automatically.
7. **Several versions**: three or more distinct versions, or the vault and a single agent both changed with ambiguous dates, are a conflict.
8. **Symlinks**: a skill folder that is a symlink is replaced by a real copy of its target, after you confirm (the target is imported into the vault first if it lives outside it).

Comparison is lenient: line endings, trailing whitespace and blank lines at the edges don't count, and frontmatter is compared by value, so Obsidian reformatting the YAML when you tick a checkbox isn't a change. Writes copy the winning version byte for byte.

## Conflicts

The conflict dialog shows each version (vault, agents, and the inferred common base) with its folder and date, the three panes side by side and a unified diff, per file. Options:

- **Keep vault version** / **Keep <agent>**: that version wins everywhere.
- **Apply clean merge**: offered only when a three-way merge has no overlapping changes.
- **Edit in Obsidian**: writes `<skill>/SKILL.conflict.md` (and `<file>.conflict` for other files) with git-style markers (`<<<<<<< vault`, `||||||| base`, `=======`, `>>>>>>> <agent>`). Sync of that skill pauses while the file exists. Remove the markers and save, or run **Resolve conflict for current skill**: the result becomes the new version, is pushed to the ticked agents, and the conflict file is deleted.
- **Open merge tool**: writes ours, base, theirs and result to a temp folder and runs the **Merge tool command**. The result is applied when the tool exits without markers left.
- **Keep as separate skills** / **Import as separate skills**: the versions are really different skills.
- **Skip**: nothing is changed, `agent-conflict` is set, and you are asked again on the next sync.

Merge tool command examples (placeholders `{ours}`, `{base}`, `{theirs}`, `{result}`; use an absolute path if the tool isn't found):

| Tool | Command |
|---|---|
| VS Code (default) | `code --wait --merge {ours} {theirs} {base} {result}` |
| FileMerge | `opendiff {ours} {theirs} -ancestor {base} -merge {result}` |
| Kaleidoscope | `ksdiff --merge --output {result} --base {base} {ours} {theirs}` |
| Meld | `meld {ours} {base} {theirs} --output {result}` |

## Known limitations

- Deletions made while Obsidian is closed are re-imported: the plugin keeps no record of what existed before. Use **Delete current skill everywhere**, or delete the skill note while Obsidian is running and confirm removing it from agents.
- With a single ticked agent, a skill edited both in the vault and externally resolves by newest file date.
- Binary-file conflicts can only be resolved by picking a version.
- Desktop only (uses the file system directly).
