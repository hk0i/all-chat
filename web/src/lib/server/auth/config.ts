import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BearerTokenInfo, Platform, PlatformConnectionInfo, UrlTokenInfo } from '@all-chat/contract';
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

export interface BearerTokenRecord extends BearerTokenInfo {
	tokenHash: string;
}

export interface UrlTokenRecord extends UrlTokenInfo {
	tokenHash: string;
}

/**
 * One connected platform account's live OAuth credentials (EDD-V2 §3) —
 * never leaves the server; only `PlatformConnectionInfo` (id/label, no
 * secrets) crosses the API. Many can exist per platform — see the doc
 * comment on the contract's `PlatformConnectionInfo` for why that's not a
 * singular slot.
 */
export interface PlatformConnectionRecord extends PlatformConnectionInfo {
	accessToken: string;
	refreshToken?: string;
	/** Epoch ms; undefined if the provider didn't return an expiry. */
	expiresAt?: number;
	/** Facebook only — a Page access token is scoped to one Page, needed to read/send on its Live Video comments (EDD-V2 §4). */
	facebookPageId?: string;
}

interface AuthConfig {
	passwordHash: string | null;
	/** Signs session cookies (see tokens.ts). Rotating this invalidates every session at once. */
	sessionSecret: string;
	bearerTokens: BearerTokenRecord[];
	urlTokens: UrlTokenRecord[];
	platformConnections: PlatformConnectionRecord[];
}

const emptyConfig = (): AuthConfig => ({
	passwordHash: null,
	sessionSecret: randomBytes(32).toString('hex'),
	bearerTokens: [],
	urlTokens: [],
	platformConnections: []
});

async function load(): Promise<AuthConfig> {
	try {
		const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<AuthConfig>;
		// Fields added after a config.json already existed on disk (e.g. platformTokens) need a default.
		return { ...emptyConfig(), ...parsed };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			const fresh = emptyConfig();
			await save(fresh);
			return fresh;
		}
		throw error;
	}
}

/**
 * Atomic write: temp file then rename (same pattern as profiles.ts) — but
 * `hooks.server.ts` calls `isAuthEnabled()` (and so `load()`/`save()`) on
 * every single request, unlike profiles.json which only loads once per page
 * load. That makes the temp filename a real collision point: two concurrent
 * requests hitting the ENOENT-create-default path at once would both write
 * `config.json.tmp` and race each other's rename. A per-call unique temp
 * name avoids the collision; the underlying "last save wins" race on
 * concurrent read-modify-write is still accepted at this project's scale
 * (EDD §3.4), same as profiles.ts.
 */
async function save(config: AuthConfig): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
	const tmp = `${CONFIG_PATH}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
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
export async function listBearerTokens(): Promise<BearerTokenInfo[]> {
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
export async function verifyBearerToken(token: string): Promise<BearerTokenInfo | undefined> {
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

export async function listUrlTokens(): Promise<UrlTokenInfo[]> {
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

export async function verifyUrlToken(token: string): Promise<UrlTokenInfo | undefined> {
	const config = await load();
	const record = config.urlTokens.find((t) => verifyTokenHash(token, t.tokenHash));
	if (!record) return undefined;
	record.lastUsedAt = Date.now();
	await save(config);
	const { tokenHash: _tokenHash, ...rest } = record;
	return rest;
}

/** Adds a newly-connected platform account. Always appends — reconnecting the same account is a distinct additional entry, not an overwrite (dedup is the admin's call via the connections list, not silently automatic). */
export async function createPlatformConnection(
	data: Omit<PlatformConnectionRecord, 'id' | 'connectedAt'>
): Promise<PlatformConnectionInfo> {
	const config = await load();
	const record: PlatformConnectionRecord = { ...data, id: randomBytes(8).toString('hex'), connectedAt: Date.now() };
	config.platformConnections.push(record);
	await save(config);
	return toConnectionInfo(record);
}

/** Metadata only — never the tokens, which stay server-side. */
export async function listPlatformConnections(platform?: Platform): Promise<PlatformConnectionInfo[]> {
	const { platformConnections } = await load();
	return platformConnections.filter((c) => !platform || c.platform === platform).map(toConnectionInfo);
}

/** The full record including live tokens — for internal use (sending messages, refreshing tokens), never returned from an API route. */
export async function getPlatformConnection(id: string): Promise<PlatformConnectionRecord | undefined> {
	return (await load()).platformConnections.find((c) => c.id === id);
}

export async function revokePlatformConnection(id: string): Promise<boolean> {
	const config = await load();
	const next = config.platformConnections.filter((c) => c.id !== id);
	if (next.length === config.platformConnections.length) return false;
	config.platformConnections = next;
	await save(config);
	return true;
}

/** Updates a connection's tokens in place after a refresh — label/id/connectedAt stay put. */
export async function updatePlatformConnectionTokens(
	id: string,
	tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }
): Promise<boolean> {
	const config = await load();
	const record = config.platformConnections.find((c) => c.id === id);
	if (!record) return false;
	Object.assign(record, tokens);
	await save(config);
	return true;
}

function toConnectionInfo(record: PlatformConnectionRecord): PlatformConnectionInfo {
	return { id: record.id, platform: record.platform, accountLabel: record.accountLabel, connectedAt: record.connectedAt };
}
