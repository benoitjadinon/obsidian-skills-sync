# Skills Sync

**Your AI agent skills are a Base.** Every skill is a Markdown note in your vault, every agent is a checkbox column, and Skills Sync keeps real copies in sync with Claude Code, Codex, Hermes, Gemini CLI, OpenCode, Cursor and about 60 other agents.

[Agent skills](https://docs.anthropic.com/en/docs/claude-code/skills) are folders with a `SKILL.md` file (plus optional `scripts/`, `references/`, …) that coding agents load from their own skills folder, such as `~/.claude/skills` or `~/.codex/skills`. Once you use several agents, the same skill ends up copied in several places, edited in some and updated by tools in others. Skills Sync gives them one home in your vault and keeps every agent up to date.

## Why Obsidian, why a Base

**Skills are Markdown, and Obsidian is a great place to write Markdown.** A `SKILL.md` is a note like any other, so you write and refine your skills with everything you already use: live preview, the properties editor for `name` and `description`, links between skills and to the projects that use them, backlinks, the graph, search, templates and your favorite plugins.

**A Base is the skills manager.** [Bases](https://help.obsidian.md/bases) are Obsidian's built-in database views, so there is no custom screen to learn. Skills Sync gives you a table with one row per skill and one checkbox column per agent: you see at a glance which agent has which skill, and changing that is a click.

| Skill | Description | Claude Code | Codex | Hermes | Gemini CLI |
|---|---|:---:|:---:|:---:|:---:|
| brainstorming | Turn ideas into designs… | ☑ | ☑ | ☐ | ☑ |
| github-auth | Authenticate with GitHub… | ☑ | ☐ | ☑ | |
| obsidian-bases | Create and edit Bases… | ☑ | ☑ | | |

Because it's a regular Base, it's also yours to shape:

- **Add your own columns.** Ratings, tags, "last reviewed", or a formula. They're just properties, and they never reach your agents.
- **Make your own views.** Group by agent category, filter "shared with Hermes only", show cards instead of a table, or embed a view in a project note.
- **Sort, filter and search** with the tools Obsidian already gives you.

## Features

- **One table for every skill and agent.** A ready-made Base lists your skills with one checkbox column per agent, plus views for undecided skills, unassigned skills and conflicts. Its first column, **Skill**, shows each skill's folder name and opens its `SKILL.md` when clicked (every file is named `SKILL`, so the file name alone doesn't tell skills apart). Tick a box to share a skill with that agent, untick it to remove it there.
- **One vault, several computers.** Share your vault between computers (Obsidian Sync, git, Syncthing…) and every computer keeps its own agents in sync from the same skill notes and the same Base. Each computer only syncs the agents and projects installed on it; the others are greyed out in the Base and marked *not available on this machine* in settings. Even dedicated skill manager apps rarely handle that.
- **Three states per agent.** Ticked: shared. Unticked: removed from that agent (or moved to its archive). Empty: undecided, so the plugin never touches that agent's copy. New agents and new skills start undecided, so adding an agent never floods it with skills.
- **Real copies, no symlinks.** Each agent gets a plain folder it can read like any other skill. Existing symlinked setups are migrated to copies, after you confirm.
- **Two-way sync without a database.** Edits in Obsidian are pushed to the ticked agents. Updates made by other tools inside an agent's folder (for example an agent updating its own bundled skills) are detected and offered for import into the vault and on to the other agents. All state lives in each skill's frontmatter.
- **Agents keep their exact files.** Agents receive the skill's original frontmatter, byte for byte. Your own properties and the plugin's properties stay in the vault.
- **Conflicts you can actually resolve.** When a skill changed in several places, a dialog shows each version with its folder and date, side by side, with a diff. You can keep one version, apply a clean three-way merge, edit the conflict in Obsidian with git-style markers, or open your merge tool (VS Code, FileMerge, Kaleidoscope, Meld, IntelliJ IDEA, WebStorm, or any command).
- **About 70 agents known out of the box**, with their skills folders. The agents installed on your computer are found automatically. Custom agents and per-project skills folders (`<repo>/.claude/skills`) can be added too.
- **Agents with category folders and archives**, like Hermes (`~/.hermes/skills/github/github-auth/`), with an archive folder anywhere you like.
- **Profiles and sub-agents are agents of their own.** Each Hermes profile (`~/.hermes/profiles/<name>/skills`) and each OpenClaw agent (its workspace's `skills` folder) gets its own column, so you can give a profile its own set of skills.

## Getting started

1. Install **Skills Sync** from **Settings → Community plugins → Browse**, and enable it. It runs on desktop only.
2. Open **Settings → Skills Sync**:
   - **Skills folder**: the vault folder that holds one subfolder per skill (default `Skills`).
   - **Agents**: the agents installed on your computer are already listed. Each one is tagged **Preset** (created from a known agent) or **Custom**, with preset agents first. Removing an agent only stops syncing it; its files are never touched, and you can choose to also remove its property from all skill notes (and its column from the base). Use **Add agent…** to add others: pick one of the known agents or enter your own skills folder. Use **Add project…** for a code project (see [Projects](#projects)).
3. Run the command **Create or update the skills base**. It creates `Skills/Skills.base` (or adds the agent columns to an existing base) and opens it.
4. The first sync imports every skill found in your agents' folders. Each one is ticked for the agents that already had it and left empty for the others. From then on, tick and untick boxes in the base.

Sync runs on startup, a moment after an agent's folder changes, and a moment after you edit a skill in Obsidian. You can also run **Sync now**, or click the ribbon icon. Turn off **Sync automatically** in settings to sync only on demand.

## Skill notes and their properties

Each skill is a folder in your skills folder. Its `SKILL.md` is the note you see in the base. The plugin adds a few properties to it, all starting with `agent-` (the prefix is configurable):

| Property | Meaning |
|---|---|
| `agent-<id>` | One per agent, for example `agent-claude`. `true`: share the skill with that agent. `false`: don't; the agent's copy is removed, or moved to its archive. Empty: undecided; the agent's copy is left alone. |
| `agent-source` | The agents the skill was imported from. Set once on import, never changed by sync, so you can correct it by hand. |
| `agent-skill-keys` | The skill's own frontmatter keys, in their original order. Only these keys are written to agents, and an empty list means the skill had no frontmatter at all. |
| `agent-path` | The category folder, for agents that group skills into folders (Hermes: `github` → `~/.hermes/skills/github/<skill>/`). |
| `agent-folder` | The skill's folder name in agents (always recorded, internal: not shown in the base). Agents keep this folder name even if you rename the note; it also tells apart two different skills that share a name. |
| `agent-delete` | **To Delete** column (always the last one): tick it and the next sync deletes the skill everywhere. |
| `agent-conflict` | `true` while a conflict is waiting for you (listed in the base's **Conflicts** view). |

You can add your own properties (ratings, tags, notes). They stay in the vault and are never copied to agents.

The default base has four views: **All skills**, **Undecided** (some agent not decided yet), **Unassigned** (shared with no agent) and **Conflicts**. It also defines a hidden **Renamed or split** formula (true when a skill's note name differs from its agent folder name, e.g. after **Keep as separate skills**); show it from a view's **Properties** menu.

## Projects

Agents also read skills from inside a code project, for example `<repo>/.claude/skills` for Claude Code and `<repo>/.agents/skills` for Codex, Cursor, Gemini CLI, OpenCode, Pi and others. **Add project…** asks only for the project folder. Skills Sync then manages the project skills folder of every agent in your settings, writing each folder once even when several agents share it.

- **One column per project (default).** Ticking `agent-<project>` copies the skill into every one of those folders, creating them if needed. Unticking removes it from all of them.
- **A column per agent** (an option in the project form): one column per project skills folder, for example `agent-<project>-claude` and `agent-<project>-agents`, to choose folder by folder. Switching between the two keeps your choices.

Add or remove agents later and projects follow: ticked skills are copied into the new agent's project folder on the next sync. Each agent's project folder comes from its form (**Project skills folder**, prefilled for known agents). Skills already present in a project folder are imported and ticked for that project.

## How sync decides

For each skill, the plugin compares the vault version with the copy of every agent ticked `true`. Agents left empty are ignored.

| Situation | What happens |
|---|---|
| You add an agent that already has skills | Skills it already has are ticked (you're asked when its copy differs from the vault); archived ones are unticked; the rest stay undecided. For agents added earlier, use the **Resync with its folder…** button on the agent's row. |
| A skill exists in an agent but not in the vault | It's imported: ticked for the agents that have it, empty for the others. If they hold different versions, you choose. |
| An agent is ticked but has no copy | The skill is copied to it. |
| An agent is unticked but still has a copy | The copy is removed (or archived) if it matches the vault; otherwise you're asked first. |
| You edited the skill in Obsidian | Your version is pushed to the ticked agents. |
| Some agents' copies changed while others still match the vault | Another tool updated them. You're asked whether to take the update into the vault and the other agents, or it happens automatically if **Updates made by other tools** is set to do so. |
| The skill changed in several places | It's a conflict (see below). |

Comparisons ignore formatting noise: line endings, trailing spaces, blank lines at the edges, and how Obsidian rewrites properties when you tick a box. Files are always copied byte for byte.

## Deleting skills

Tick a skill's **To Delete** checkbox (the last column; the base's **To delete** view lists them). The next sync deletes it from every agent and project folder and from the vault:

- **Agent copies** (archived ones too) are moved to `~/.skills-sync-trash/<date>/<agent>/<skill>`, not erased: move them back to restore.
- **The skill's note** goes wherever Obsidian puts deleted files (**Settings → Files and links → Deleted files**: your system trash, the vault's `.trash` folder, or permanently).
- A notice lists what was deleted and how to restore it.
- **Other computers sharing the vault** remove their own copies at their next sync and never re-import the skill. Skills deleted in the last 30 days are remembered in the shared settings for that; creating a skill with the same name again works as usual.

## Resolving conflicts

Skills are matched by folder name, then compared on their whole content (body, other files and property values). Only identical copies are treated as the same without asking.

The conflict dialog lists every version (the vault, the agents, and the common original when one can be found) with folders and dates, a table of the properties whose values differ, then the changes (unchanged lines folded) and, collapsed, the full versions side by side. You can:

- **Keep** the vault version or one of the agents' versions; it then wins everywhere.
- **Apply clean merge**, offered when the changes don't overlap.
- **Edit in Obsidian**: the plugin writes `SKILL.conflict.md` with git-style markers (`<<<<<<< vault`, `||||||| base`, `=======`, `>>>>>>> agent`). Remove the markers and save, and the result is applied and synced.
- **Open merge tool**, if you chose one in settings.
- **Keep as separate skills…**, when the versions are really different skills that happen to share a name. You name the new note (suggested: the skill name with the agent as a suffix, for example `computer-use-hermes`); the agent keeps its folder name, and both skills stay apart from then on. When the versions are less than 50% alike, the dialog says they look like different skills and suggests this option.
- **Skip**, to decide later.

The merge tool is optional. Pick one in **Settings → Merge tool**, or enter any command using the placeholders `{ours}`, `{base}`, `{theirs}` and `{result}`:

| Tool | Command |
|---|---|
| VS Code | `code --wait --merge {ours} {theirs} {base} {result}` |
| FileMerge (Xcode) | `opendiff {ours} {theirs} -ancestor {base} -merge {result}` |
| Kaleidoscope | `ksdiff --merge --output {result} --base {base} {ours} {theirs}` |
| Meld | `meld {ours} {base} {theirs} --output {result}` |
| IntelliJ IDEA | `idea merge {ours} {theirs} {base} {result}` |
| WebStorm | `webstorm merge {ours} {theirs} {base} {result}` |

IntelliJ IDEA and WebStorm need their command-line launcher: in JetBrains Toolbox, go to Settings → Shell scripts, or in the IDE use Tools → Create Command-line Launcher. If a tool can't be found, use its absolute path.

## Using one vault on several computers

Skills Sync is made for vaults shared between computers, for example a Mac and a Linux desktop syncing the vault with Obsidian Sync, git or Syncthing.

- **One shared list of agents and projects.** Agent folders are stored as `~/…`, so the same entry works on macOS and Linux. On each computer, an agent is *available* when its skills folder exists there, and a project when its folder exists there. Use the same `~/…` paths on your computers and they just work everywhere.
- **Each computer syncs only what is available on it.** The others are marked **Not available on this machine** in settings, their columns are greyed out in the Base on that computer, and sync ignores them: their properties in your notes are kept, never changed.
- **Manage every computer from any computer.** A greyed column is still a checkbox: tick a skill for an agent that only exists on your other computer, and that computer applies it at its next sync.
- **One Base for all computers.** The Base file is shared and never edited per computer; the greying is display only.
- **First start on a new computer** adds the agents installed there to the shared list.
- **The merge tool is per computer** (FileMerge on a Mac, Meld on Linux).

Settings changes made on two computers before your vault sync runs are merged: agents and projects added on either side are kept.

## Commands

| Command | What it does |
|---|---|
| **Sync now** | Runs a full sync (also the ribbon icon). |
| **New skill** | Creates a skill in the vault with every agent undecided. |
| **Create or update the skills base** | Creates the base, or adds missing columns to it. |
| **Fill in missing skill sources** | Adds `agent-source` to skills imported before that property existed. |
| **Delete current skill everywhere** | Deletes the skill from the vault and from every agent (asks first). |
| **Resolve conflict for current skill** | Applies an edited conflict file once no markers are left. |

## Disclosures

- **Files outside your vault.** Syncing skills is the purpose of this plugin, so it reads, writes, moves and deletes files in the skills folders (and archive folders) of the agents and projects you configure, for example `~/.claude/skills`. It never touches other folders: every change is checked to stay inside a configured folder. On first start, it also checks which known agents' skills folders exist, to suggest them.
- **External programs.** If you set a merge tool, the plugin runs that command when you choose **Open merge tool** in the conflict dialog.
- **No network, no telemetry, no account.** The plugin never connects to the internet and collects nothing.

## Known limitations

- **Desktop only**, because it works with folders outside the vault.
- **Deleting a skill while Obsidian is closed** brings it back on the next sync, because the plugin doesn't keep a record of past skills. Delete skills from Obsidian instead: confirm removing the agents' copies when asked, or use **Delete current skill everywhere**.
- **When a skill is shared with a single agent** and was edited both in Obsidian and in that agent's folder, the newest file wins.
- **Conflicts in binary files** (images, PDFs) are resolved by picking a version.

## Credits

- The list of known agents and their skills folders is generated from [vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT License).
- Bundled libraries: [yaml](https://github.com/eemeli/yaml) (ISC), [node-diff3](https://github.com/bhousel/node-diff3) (MIT), [jsdiff](https://github.com/kpdecker/jsdiff) (BSD-3-Clause).

## Development

```bash
npm install
npm run dev      # rebuild on change
npm test         # unit and end-to-end sync scenarios (vitest)
npm run lint
npm run build
```

`npm run presets:update` regenerates the known agents from vercel-labs/skills. See [AGENTS.md](AGENTS.md) for the architecture and contribution notes, and [docs/e2e-checklist.md](docs/e2e-checklist.md) for the manual test checklist.

## License

[MIT](LICENSE) © Benoit Jadinon
