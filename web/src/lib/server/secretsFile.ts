import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Optional, more-secure alternative to plain env vars for secrets
 * (docs/EDD-V2.md §6) — a single dotenv-format file, either bind-mounted
 * as a Docker secret (never shows up in `docker inspect`, unlike
 * `environment:` values) or just a chmod-600 file for bare `npm run dev`,
 * same convention as `~/.ssh/`. `.env` keeps working standalone — real env
 * vars always win, so this only fills in what isn't already set.
 */
const DEFAULT_PATH = join(homedir(), '.allchat', 'secrets');

/** Minimal dotenv parsing: `KEY=VALUE` lines, `#` comments, blank lines skipped, optional matching quotes stripped. */
function parseDotenv(contents: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of contents.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) result[key] = value;
	}
	return result;
}

/**
 * Loads the secrets file into `process.env`, if present — a missing file
 * is a silent no-op (this is opt-in, not a requirement). Warns (doesn't
 * block startup) when the file's permissions are looser than owner-only,
 * the same posture `ssh` takes toward overly-open private keys.
 */
export function loadSecretsFile(path: string = process.env.ALLCHAT_SECRETS_FILE ?? DEFAULT_PATH): void {
	let contents: string;
	let mode: number;
	try {
		mode = statSync(path).mode;
		contents = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}

	if (mode & 0o077) {
		console.warn(`[secrets] ${path} is readable by more than its owner — recommend \`chmod 600 ${path}\``);
	}

	for (const [key, value] of Object.entries(parseDotenv(contents))) {
		if (process.env[key] === undefined) process.env[key] = value;
	}
}
