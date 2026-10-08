import { App, Modal, Notice, Setting } from 'obsidian';
import { diffLines } from 'diff';
import { writeConflictFiles } from '../core/conflictFiles';
import { guardLostWindow } from './lostWindow';
import { describeMergeError, resolveWithExternalTool } from '../core/externalMerge';
import { conflictLabels, mergeSkill } from '../core/merge';
import type { SkillCopy, SyncConfig } from '../core/model';
import { propertyDiff } from '../core/frontmatter';
import { isBinary } from '../core/normalize';
import { fileKey, toText } from '../core/scan';
import type { ConflictRequest, Resolution } from '../core/sync';

export interface ConflictUiDeps {
	getConfig(): SyncConfig;
	mergeCommand(): string;
	openPath(absPath: string): Promise<void>;
}

const TITLES = {
	import: 'Different versions to import',
	diverged: 'Skill changed in several places',
	external: 'Skill updated outside Obsidian',
	delete: 'Remove a modified copy?',
	path: 'Skill moved inside an agent',
} as const;

function textOf(copy: SkillCopy | undefined, rel: string): string {
	const d = copy?.files.get(rel);
	if (!d) return '';
	return isBinary(d) ? '(binary file)' : toText(d);
}

export class ConflictModal extends Modal {
	private result: Resolution = { kind: 'skip' };
	private done: (r: Resolution) => void = () => undefined;
	private stopGuard: () => void = () => undefined;
	private file = 'SKILL.md';

	constructor(app: App, private readonly req: ConflictRequest, private readonly deps: ConflictUiDeps) {
		super(app);
	}

	openAndWait(): Promise<Resolution> {
		return new Promise((resolve) => {
			let settled = false;
			this.done = (r) => {
				if (settled) return;
				settled = true;
				this.stopGuard();
				resolve(r);
			};
			this.open();
			// If the dialog's window disappears, the sync gets "skip" instead of waiting forever.
			this.stopGuard = guardLostWindow(this, () => this.done({ kind: 'skip' }));
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.done(this.result);
	}

	private finish(r: Resolution): void {
		this.result = r;
		this.close();
	}

	private label(owner: string): string {
		return this.req.labels[owner] ?? owner;
	}

	private holders(v: SkillCopy): string {
		return (this.req.conflict.owners[v.key] ?? [v.owner]).map((o) => this.label(o)).join(' + ');
	}

	private versions(): SkillCopy[] {
		const c = this.req.conflict;
		const all = [c.ours, ...c.theirs, c.base].filter((v): v is SkillCopy => v !== undefined);
		return all.filter((v, i) => all.indexOf(v) === i);
	}

	onOpen(): void {
		const { conflict: c, group: g } = this.req;
		this.modalEl.addClass('ash-conflict');
		this.setTitle(`${TITLES[c.kind]}: ${g.name}`);

		const cards = this.contentEl.createDiv({ cls: 'ash-cards' });
		for (const v of this.versions()) {
			const role = v === c.ours ? 'Vault' : v === c.base ? 'Base' : 'Agent';
			const card = cards.createDiv({ cls: 'ash-card' });
			card.createEl('strong', { text: `${role}: ${this.holders(v)}` });
			card.createDiv({ cls: 'ash-path', text: v.dir });
			card.createDiv({ text: `Modified ${new Date(v.mtimeMs).toLocaleString()}` });
		}

		const files = this.differingFiles();
		if (files.length > 0 && !files.includes(this.file)) this.file = files[0] ?? 'SKILL.md';
		const diffEl = createDiv({ cls: 'ash-diff' });
		if (files.length > 1) {
			new Setting(this.contentEl).setName('File').addDropdown((d) => {
				for (const f of files) d.addOption(f, f);
				d.setValue(this.file).onChange((v) => {
					this.file = v;
					this.renderDiff(diffEl);
				});
			});
		}
		this.contentEl.appendChild(diffEl);
		this.renderDiff(diffEl);
		this.renderActions();
	}

	private differingFiles(): string[] {
		const vs = this.versions();
		const rels = new Set(vs.flatMap((v) => [...v.files.keys()]));
		return [...rels].sort().filter((rel) => new Set(vs.map((v) => {
			const d = v.files.get(rel);
			return d ? fileKey(rel, d) : '';
		})).size > 1);
	}

	private renderDiff(el: HTMLElement): void {
		el.empty();
		const c = this.req.conflict;
		const left = c.ours ?? c.theirs[1];
		const right = c.theirs[0];
		const leftName = c.ours ? 'Vault' : this.holders(left ?? right ?? c.theirs[0]!);
		const rightName = right ? this.holders(right) : 'Agent';

		// 0. Properties whose values differ (SKILL.md), compared by value, not formatting.
		if (left && right && this.file === 'SKILL.md') {
			const rows = propertyDiff(textOf(left, this.file), textOf(right, this.file));
			if (rows.length > 0) {
				el.createEl('h4', { text: 'Properties that differ' });
				const table = el.createEl('table', { cls: 'ash-props' });
				const head = table.createEl('tr');
				for (const h of ['Property', leftName, rightName]) head.createEl('th', { text: h });
				for (const row of rows) {
					const tr = table.createEl('tr');
					tr.createEl('td', { cls: 'ash-prop-key', text: row.key });
					tr.createEl('td', { cls: row.left === undefined ? 'ash-prop-missing' : 'ash-del', text: row.left ?? '(none)' });
					tr.createEl('td', { cls: row.right === undefined ? 'ash-prop-missing' : 'ash-add', text: row.right ?? '(none)' });
				}
			}
		}

		// 1. The differences first, full height: only the dialog scrolls (its buttons stay pinned).
		if (left && right) {
			const head = el.createDiv({ cls: 'ash-diff-head' });
			head.createEl('h4', { text: `Changes · ${this.file}` });
			const legend = head.createDiv({ cls: 'ash-diff-legend' });
			legend.createSpan({ cls: 'ash-del', text: `− ${leftName}` });
			legend.createSpan({ cls: 'ash-add', text: `+ ${rightName}` });
			const pre = el.createEl('pre', { cls: 'ash-unified' });
			for (const part of diffLines(textOf(left, this.file), textOf(right, this.file))) {
				if (part.added || part.removed) {
					pre.createSpan({ cls: part.added ? 'ash-add' : 'ash-del', text: part.value });
				} else {
					this.renderUnchanged(pre, part.value);
				}
			}
		}

		// 2. The full versions side by side, collapsed: opened only when needed.
		const details = el.createEl('details', { cls: 'ash-full-versions' });
		details.createEl('summary', { text: 'Show full versions side by side' });
		const panes = details.createDiv({ cls: 'ash-panes' });
		const columns: Array<[string, SkillCopy | undefined]> = [
			[c.ours ? 'Vault' : 'Version 2', left], ['Base', c.base], [c.ours ? 'Agent' : 'Version 1', right],
		];
		for (const [title, v] of columns) {
			if (!v) continue;
			const pane = panes.createDiv({ cls: 'ash-pane' });
			pane.createEl('h4', { text: `${title} · ${this.file}` });
			pane.createEl('pre', { text: textOf(v, this.file) });
		}
	}

	/** Unchanged text in the diff: long runs are folded to a few lines of context, expandable on click. */
	private renderUnchanged(pre: HTMLElement, value: string): void {
		const lines = value.split('\n');
		const trailing = value.endsWith('\n') ? lines.pop() : undefined;
		const context = 3;
		// Fold only when it hides a real block (at least 6 lines).
		if (lines.length < context * 2 + 6) {
			pre.createSpan({ cls: 'ash-same', text: value });
			return;
		}
		const head = lines.slice(0, context).join('\n') + '\n';
		const middle = lines.slice(context, lines.length - context).join('\n') + '\n';
		const tail = lines.slice(lines.length - context).join('\n') + (trailing !== undefined ? '\n' : '');
		pre.createSpan({ cls: 'ash-same', text: head });
		const fold = pre.createSpan({ cls: 'ash-fold', text: `⋯ ${lines.length - context * 2} unchanged lines (click to show)\n` });
		fold.addEventListener('click', () => {
			fold.replaceWith(createSpan({ cls: 'ash-same', text: middle }));
		});
		pre.createSpan({ cls: 'ash-same', text: tail });
	}

	private renderActions(): void {
		const c = this.req.conflict;
		// Kept visible at the bottom of the dialog, however long the diff is (see styles.css).
		const row = new Setting(this.contentEl).setClass('ash-conflict-actions');
		const add = (text: string, fn: () => void | Promise<void>, cta = false): void => {
			row.addButton((b) => {
				b.setButtonText(text).onClick(() => void fn());
				if (cta) b.setCta();
			});
		};
		switch (c.kind) {
			case 'import':
				for (const t of c.theirs) add(`Use ${this.holders(t)}`, () => this.finish({ kind: 'apply', files: t.files }));
				add('Import as separate skills', () => this.finish({ kind: 'split' }));
				break;
			case 'delete': {
				const ours = c.ours;
				const t = c.theirs[0];
				if (ours) add(`Remove from ${this.label(c.agent ?? '')}`, () => this.finish({ kind: 'apply', files: ours.files }), true);
				if (t) add('Keep its version in the vault, then remove', () => this.finish({ kind: 'apply', files: t.files }));
				break;
			}
			case 'path': {
				const t = c.theirs[0];
				add(`Use new location "${t?.relPath || '(root)'}"`, () => this.finish({ kind: 'adoptPath' }), true);
				add(`Move back to "${this.req.group.vault?.meta.path || '(root)'}"`, () => this.finish({ kind: 'keepPath' }));
				break;
			}
			default: {
				const ours = c.ours;
				const theirs = c.theirs[0];
				if (ours) add('Keep vault version', () => this.finish({ kind: 'apply', files: ours.files }));
				for (const t of c.theirs) add(`Keep ${this.holders(t)}`, () => this.finish({ kind: 'apply', files: t.files }));
				if (ours && theirs) {
					const m = mergeSkill(ours, c.base, theirs, conflictLabels(c, this.req.labels));
					if (m.clean) add('Apply clean merge', () => this.finish({ kind: 'apply', files: m.files }), true);
					add('Edit in Obsidian', async () => {
						const paths = await writeConflictFiles(this.deps.getConfig(), this.req);
						if (paths.length === 0) return void new Notice('Only binary files conflict; pick a version instead.');
						this.finish({ kind: 'pending' });
						const first = paths[0];
						if (first) await this.deps.openPath(first);
					});
					const command = this.deps.mergeCommand().trim();
					// Only offered when a merge tool is configured; a failure leaves the dialog open with its other options.
					if (command) {
						add('Open merge tool', async () => {
							try {
								const r = await resolveWithExternalTool(this.req, command);
								if (r) this.finish(r);
								else new Notice('The merge tool left conflict markers, so nothing was applied.');
							} catch (e) {
								new Notice(describeMergeError(e, command), 10000);
							}
						});
					}
				}
				// Same name, but maybe a different skill: keep both.
				if (c.kind === 'diverged' || c.kind === 'external') add('Keep as separate skills', () => this.finish({ kind: 'split' }));
			}
		}
		add('Skip', () => this.finish({ kind: 'skip' }));
	}
}
