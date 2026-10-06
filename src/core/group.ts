import type { SkillCopy, SkillGroup, VaultSkill } from './model';

export function uniqueName(base: string, taken: Set<string>): string {
	let name = base;
	let i = 2;
	while (taken.has(name)) name = `${base}-${i++}`;
	return name;
}

/**
 * Identity = agent-side leaf folder name. Different agents with the same folder name are the
 * same skill (content differences become conflicts). The same agent holding the same folder name
 * at several paths: identical copies are dropped, different ones become separate skills.
 */
export function groupSkills(vault: VaultSkill[], copies: SkillCopy[]): SkillGroup[] {
	const groups: SkillGroup[] = vault.map((v) => ({ name: v.name, vault: v, copies: [] }));
	const taken = new Set(groups.map((g) => g.name));
	const pending = new Map<string, SkillGroup>();

	for (const c of copies) {
		const cands = groups.filter((g) => g.vault && (g.vault.meta.folder || g.name) === c.folder);
		const target = cands.find((g) => g.vault?.meta.path === c.relPath) ?? cands[0];
		if (target) {
			target.copies.push(c);
			continue;
		}
		let g = pending.get(c.folder);
		if (!g) {
			const name = uniqueName(c.folder, taken);
			taken.add(name);
			g = { name, copies: [] };
			if (name !== c.folder) g.newFolder = c.folder;
			pending.set(c.folder, g);
			groups.push(g);
		}
		g.copies.push(c);
	}

	for (const g of [...groups]) {
		const byOwner = new Map<string, SkillCopy[]>();
		for (const c of g.copies) {
			const k = `${c.owner}\u0000${String(c.archived)}`;
			byOwner.set(k, [...(byOwner.get(k) ?? []), c]);
		}
		for (const list of byOwner.values()) {
			if (list.length < 2) continue;
			const preferred = g.vault?.meta.path;
			list.sort(
				(a, b) => Number(b.relPath === preferred) - Number(a.relPath === preferred) || a.relPath.localeCompare(b.relPath),
			);
			const [keep, ...extra] = list;
			for (const c of extra) {
				g.copies = g.copies.filter((x) => x !== c);
				if (keep && c.key === keep.key) continue;
				const base = c.relPath ? `${c.relPath.split('/').join('-')}-${c.folder}` : `${c.owner}-${c.folder}`;
				const name = uniqueName(base, taken);
				taken.add(name);
				groups.push({ name, copies: [c], newFolder: c.folder, newPath: c.relPath });
			}
		}
	}
	return groups;
}
