import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { hashPassword, verifyPassword } from './passwordHash';
import { generateToken, hashToken, verifyTokenHash } from './tokens';

/**
 * App-level auth state (EDD §6.1): the admin password hash, the session
 * signing secret, and every issued bearer/URL token. Same storage shape as
 * `profiles.json` — one JSON file on the `/data` volume, atomic write.
 * Auth is off whenever `passwordHash` is null — that's the v1-compatible
 * default (no file yet, or password explicitly cleared).
 */

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const CONFIG_PATH = join(DATA_DIR, 'config.json');

export interface BearerTokenRecord {
	id: string;
	name: string;
	scope: 'read' | 'write';
	tokenHash: string;
	createdAt: number;
	lastUsedAt: number | null;
}

export interface UrlTokenRecord {
	id: string;
	/** Which profile this overlay link is scoped to; null = whatever the URL's own `?profile=` says. */
	profileId: string | null;
	tokenHash: string;
	createdAt: number;
	lastUsedAt: number | null;
}

interface AuthConfig {
	passwordHash: string | null;
	/** Signs session cookies (see tokens.ts). Rotating this invalidates every session at once. */
	sessionSecret: string;
	bearerTokens: BearerTokenRecord[];
	urlTokens: UrlTokenRecord[];
}

const emptyConfig = (): AuthConfig => ({
	passwordHash: null,
	sessionSecret: randomBytes(32).toString('hex'),
	bearerTokens: [],
	urlTokens: []
});

async function load(): Promise<AuthConfig> {
	try {
		return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as AuthConfig;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			const fresh = emptyConfig();
			await save(fresh);
			return fresh;
		}
		throw error;
	}
}

/** Atomic write: temp file then rename (same pattern as profiles.ts). */
async function save(config: AuthConfig): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
	const tmp = `${CONFIG_PATH}.tmp`;
	await writeFile(tmp, JSON.stringify(config, null, '\t'), 'utf8');
	await rename(tmp, CONFIG_PATH);
}

/** Whether app auth is currently enforced — false until an admin password is set. */
export async function isAuthEnabled(): Promise<boolean> {
	return (await load()).passwordHash !== null;
}

export async function setAdminPassword(password: string): Promise<void> {
	const config = await load();
	config.passwordHash = await hashPassword(password);
	// A password (re)set invalidates every existing session — force re-login.
	config.sessionSecret = randomBytes(32).toString('hex');
	await save(config);
}

/** Turns auth off entirely and invalidates all sessions. Bearer/URL tokens are left intact — they're revoked individually. */
export async function clearAdminPassword(): Promise<void> {
	const config = await load();
	config.passwordHash = null;
	config.sessionSecret = randomBytes(32).toString('hex');
	await save(config);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
	const { passwordHash } = await load();
	if (!passwordHash) return false;
	return verifyPassword(password, passwordHash);
}

export async function getSessionSecret(): Promise<string> {
	return (await load()).sessionSecret;
}

export async function createBearerToken(
	name: string,
	scope: 'read' | 'write'
): Promise<{ id: string; token: string }> {
	const config = await load();
	const id = randomBytes(8).toString('hex');
	const token = generateToken();
	config.bearerTokens.push({ id, name, scope, tokenHash: hashToken(token), createdAt: Date.now(), lastUsedAt: null });
	await save(config);
	return { id, token };
}

/** Metadata only — never the token itself, which only ever existed in plaintext at creation time. */
export async function listBearerTokens(): Promise<Omit<BearerTokenRecord, 'tokenHash'>[]> {
	const { bearerTokens } = await load();
	return bearerTokens.map(({ tokenHash: _tokenHash, ...rest }) => rest);
}

export async function revokeBearerToken(id: string): Promise<boolean> {
	const config = await load();
	const next = config.bearerTokens.filter((t) => t.id !== id);
	if (next.length === config.bearerTokens.length) return false;
	config.bearerTokens = next;
	await save(config);
	return true;
}

/** Verifies a bearer token and records its use; returns the matching record (sans hash) or undefined. */
export async function verifyBearerToken(
	token: string
): Promise<Omit<BearerTokenRecord, 'tokenHash'> | undefined> {
	const config = await load();
	const record = config.bearerTokens.find((t) => verifyTokenHash(token, t.tokenHash));
	if (!record) return undefined;
	record.lastUsedAt = Date.now();
	await save(config);
	const { tokenHash: _tokenHash, ...rest } = record;
	return rest;
}

export async function createUrlToken(profileId: string | null): Promise<{ id: string; token: string }> {
	const config = await load();
	const id = randomBytes(8).toString('hex');
	const token = generateToken();
	config.urlTokens.push({ id, profileId, tokenHash: hashToken(token), createdAt: Date.now(), lastUsedAt: null });
	await save(config);
	return { id, token };
}

export async function listUrlTokens(): Promise<Omit<UrlTokenRecord, 'tokenHash'>[]> {
	const { urlTokens } = await load();
	return urlTokens.map(({ tokenHash: _tokenHash, ...rest }) => rest);
}

export async function revokeUrlToken(id: string): Promise<boolean> {
	const config = await load();
	const next = config.urlTokens.filter((t) => t.id !== id);
	if (next.length === config.urlTokens.length) return false;
	config.urlTokens = next;
	await save(config);
	return true;
}

export async function verifyUrlToken(
	token: string
): Promise<Omit<UrlTokenRecord, 'tokenHash'> | undefined> {
	const config = await load();
	const record = config.urlTokens.find((t) => verifyTokenHash(token, t.tokenHash));
	if (!record) return undefined;
	record.lastUsedAt = Date.now();
	await save(config);
	const { tokenHash: _tokenHash, ...rest } = record;
	return rest;
}
