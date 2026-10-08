# End-to-end checklist

Manual check of Skills Sync in a real Obsidian. Use a scratch vault and scratch agent folders only, never your real `~/.claude`, `~/.hermes`, … folders.

## Setup

1. Run `npm run build`.
2. Create a scratch vault.
3. Copy `main.js`, `manifest.json` and `styles.css` to `<scratch>/.obsidian/plugins/skills-sync/`.
4. Create the scratch agent folders, for example `mkdir -p ~/tmp/ash/claude ~/tmp/ash/hermes`.
5. Before enabling the plugin, write `<scratch>/.obsidian/plugins/skills-sync/data.json` containing `{"initialized": true, "agents": []}`. Otherwise the first start detects your real agent folders and syncs them.
6. Enable the plugin. In its settings, add custom agents:
   - `claude` → `~/tmp/ash/claude` (flat folder);
   - `hermes` → `~/tmp/ash/hermes`, layout **Category subfolders**, archive folder `.archive`.

## Checklist

Each line: action → expected result. Tick it and note anything unexpected.

- [ ] Put `foo/SKILL.md` in the claude scratch folder → within ~2 s a `Skills/foo/SKILL.md` note appears with `agent-claude` ticked and the others empty.
- [ ] Run **Create or update the skills base** → the base opens. Check:
  - [ ] one checkbox column per agent;
  - [ ] empty cells look different from unticked ones. If they don't, change the `Undecided` view filter to use `.isEmpty()` and record the outcome here: ______;
  - [ ] the `Skill` column is a clickable link.
- [ ] Tick the hermes column → `hermes/foo/SKILL.md` appears.
- [ ] Untick claude → the claude copy disappears; the vault note stays.
- [ ] Edit the body in Obsidian → after ~2 s the hermes copy matches. Its frontmatter has only `name` and `description`.
- [ ] Edit the hermes copy with another editor → the conflict dialog shows vault and agent paths, dates and a diff. **Keep Hermes** updates the vault.
- [ ] Edit the same line in both → **Edit in Obsidian** opens `SKILL.conflict.md`. Removing the markers and saving resolves and syncs.
- [ ] Add an agent in settings → a new base column appears, and every note gets an empty property for it.
- [ ] Symlink a skill into the claude folder → the migration dialog lists it. Accepting replaces it with a real folder.
- [ ] Delete a skill note in Obsidian → the "Also remove from agents?" prompt appears.

## Cleanup

Disable the plugin, delete the scratch vault and `~/tmp/ash`.
- Import a skill from an agent → the note has `agent-source: [<agent>]`; edit it by hand → it survives the next sync. On notes without `agent-source`, run **Fill in missing skill sources** → it is filled with the agents holding a copy; running it again changes nothing.
