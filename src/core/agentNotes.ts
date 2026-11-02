import { parse as parseYaml } from 'yaml';
import { RESERVED } from './frontmatter';
import type { AgentConfig, Layout } from './model';
import { expandHome, folderInstalled, presetsFor } from './agents';

/** Whether an agent config applies to the given device (true if shared/all or matches). */
export function isAgentForDevice(agent: AgentConfig, currentDevice?: string): boolean {
	if (!currentDevice) return true;
	if (!agent.devices || agent.devices.length === 0) return true;
	return agent.devices.includes(currentDevice);
}

/** Whether an agent is available on this computer (device matches AND folder/parent exists). */
export function isAgentAvailable(
	agent: AgentConfig,
	currentDevice: string | undefined,
	exists: (p: string) => boolean,
	home?: string,
): boolean {
	if (!isAgentForDevice(agent, currentDevice)) return false;
	return folderInstalled(expandHome(agent.path, home), exists, home);
}

/** Bare key used for stateKey (without propPrefix). */
export function stateKeyForAgent(id: string, devices?: string[]): string {
	if (devices && devices.length === 1 && devices[0]) {
		return `${id}-${devices[0]}`;
	}
	return id;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseAgentNote(content: string, filename: string): AgentConfig | null {
	const m = FRONTMATTER_RE.exec(content);
	if (!m) return null;
	const yamlText = m[1] ?? '';
	let data: unknown;
	try {
		data = parseYaml(yamlText);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object') return null;
	const r = data as Record<string, unknown>;

	const id = typeof r['agent-id'] === 'string' ? r['agent-id'].trim() : '';
	const path = typeof r['agent-path'] === 'string' ? r['agent-path'].trim() : '';
	if (!id || !path || RESERVED.includes(id)) return null;

	let devices: string[] | undefined;
	const devRaw = r['agent-device'];
	if (Array.isArray(devRaw)) {
		devices = devRaw.filter((d): d is string => typeof d === 'string' && Boolean(d.trim())).map((d) => d.trim());
	} else if (typeof devRaw === 'string' && devRaw.trim()) {
		devices = [devRaw.trim()];
	}

	const layout: Layout = r['agent-layout'] === 'nested' ? 'nested' : 'flat';
	const archiveDir = typeof r['agent-archive'] === 'string' ? r['agent-archive'].trim() : '';
	const explicitProjectDir = typeof r['agent-project-dir'] === 'string' ? r['agent-project-dir'].trim() : undefined;
	const presetProjectDir = presetsFor().find((p) => p.id === id)?.projectDir;
	const projectDir = explicitProjectDir || presetProjectDir;

	const label = filename.replace(/\.md$/i, '') || id;

	return {
		id,
		label,
		path,
		kind: 'agent',
		layout,
		archiveDir,
		devices: devices && devices.length > 0 ? devices : undefined,
		projectDir,
		stateKey: stateKeyForAgent(id, devices),
	};
}

export function formatAgentNote(config: AgentConfig, body: string = ''): string {
	const lines: string[] = ['---'];
	lines.push(`agent-id: ${config.id}`);
	if (config.devices && config.devices.length > 0) {
		if (config.devices.length === 1 && config.devices[0]) {
			lines.push(`agent-device: ${config.devices[0]}`);
		} else {
			lines.push('agent-device:');
			for (const d of config.devices) lines.push(`  - ${d}`);
		}
	}
	lines.push(`agent-path: ${config.path}`);
	if (config.layout && config.layout !== 'flat') {
		lines.push(`agent-layout: ${config.layout}`);
	}
	if (config.archiveDir) {
		lines.push(`agent-archive: ${config.archiveDir}`);
	}
	if (config.projectDir) {
		lines.push(`agent-project-dir: ${config.projectDir}`);
	}
	lines.push('---');
	if (body.trim()) {
		lines.push('', body.trim());
	}
	lines.push('');
	return lines.join('\n');
}
