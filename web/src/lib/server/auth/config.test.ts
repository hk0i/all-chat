import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `DATA_DIR` is read once at module import time (same pattern as
 * profiles.ts), so each test points it at a fresh temp dir and re-imports
 * the module fresh via `vi.resetModules()` rather than sharing state.
 */
let dir: string;
let config: typeof import('./config');

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'allchat-auth-'));
	process.env.DATA_DIR = dir;
	vi.resetModules();
	config = await import('./config');
});

afterEach(() => {
	delete process.env.DATA_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe('admin password', () => {
	it('is disabled until a password is set', async () => {
		expect(await config.isAuthEnabled()).toBe(false);
	});

	it('round-trips set/verify/clear', async () => {
		await config.setAdminPassword('hunter2');
		expect(await config.isAuthEnabled()).toBe(true);
		expect(await config.verifyAdminPassword('hunter2')).toBe(true);
		expect(await config.verifyAdminPassword('wrong')).toBe(false);

		await config.clearAdminPassword();
		expect(await config.isAuthEnabled()).toBe(false);
		expect(await config.verifyAdminPassword('hunter2')).toBe(false);
	});

	it('rotates the session secret on set and on clear', async () => {
		const initial = await config.getSessionSecret();
		await config.setAdminPassword('hunter2');
		const afterSet = await config.getSessionSecret();
		await config.clearAdminPassword();
		const afterClear = await config.getSessionSecret();

		expect(afterSet).not.toBe(initial);
		expect(afterClear).not.toBe(afterSet);
	});
});

describe('bearer tokens', () => {
	it('verifies a live token and rejects after revocation', async () => {
		const { id, token } = await config.createBearerToken('mobile app', 'read');
		const verified = await config.verifyBearerToken(token);
		expect(verified?.id).toBe(id);
		expect(verified?.scope).toBe('read');

		expect(await config.revokeBearerToken(id)).toBe(true);
		expect(await config.verifyBearerToken(token)).toBeUndefined();
	});

	it('lists tokens without exposing the hash', async () => {
		await config.createBearerToken('bot', 'write');
		const listed = await config.listBearerTokens();
		expect(listed).toHaveLength(1);
		expect(listed[0]).not.toHaveProperty('tokenHash');
	});
});

describe('URL tokens', () => {
	it('verifies a live token and rejects after revocation', async () => {
		const { id, token } = await config.createUrlToken('gaming');
		const verified = await config.verifyUrlToken(token);
		expect(verified?.id).toBe(id);
		expect(verified?.profileId).toBe('gaming');

		expect(await config.revokeUrlToken(id)).toBe(true);
		expect(await config.verifyUrlToken(token)).toBeUndefined();
	});
});

describe('platform connections', () => {
	it('creates, lists (sans tokens), and revokes a connection', async () => {
		const created = await config.createPlatformConnection({
			platform: 'twitch',
			accountLabel: 'gmpekk',
			accessToken: 'at-1',
			refreshToken: 'rt-1',
			expiresAt: 123
		});
		expect(created.accountLabel).toBe('gmpekk');
		expect(created).not.toHaveProperty('accessToken');

		const listed = await config.listPlatformConnections('twitch');
		expect(listed).toEqual([created]);

		const full = await config.getPlatformConnection(created.id);
		expect(full?.accessToken).toBe('at-1');

		expect(await config.revokePlatformConnection(created.id)).toBe(true);
		expect(await config.getPlatformConnection(created.id)).toBeUndefined();
		expect(await config.revokePlatformConnection(created.id)).toBe(false);
	});

	it('supports multiple independent connections on the same platform', async () => {
		const a = await config.createPlatformConnection({ platform: 'twitch', accountLabel: 'gmpekk', accessToken: 'at-a' });
		const b = await config.createPlatformConnection({
			platform: 'twitch',
			accountLabel: 'smallindie_alt',
			accessToken: 'at-b'
		});

		const listed = await config.listPlatformConnections('twitch');
		expect(listed.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());

		expect(await config.revokePlatformConnection(a.id)).toBe(true);
		expect((await config.listPlatformConnections('twitch')).map((c) => c.id)).toEqual([b.id]);
	});

	it('lists across all platforms when none is given, filters when one is', async () => {
		await config.createPlatformConnection({ platform: 'twitch', accountLabel: 'gmpekk', accessToken: 'at-1' });
		await config.createPlatformConnection({ platform: 'youtube', accountLabel: 'My Channel', accessToken: 'at-2' });

		expect(await config.listPlatformConnections()).toHaveLength(2);
		expect(await config.listPlatformConnections('youtube')).toHaveLength(1);
	});

	it('accepts facebook as a connectable platform, each Page its own connection', async () => {
		const a = await config.createPlatformConnection({
			platform: 'facebook',
			accountLabel: 'My Streaming Page',
			accessToken: 'page-token-1',
			facebookPageId: '111'
		});
		const b = await config.createPlatformConnection({
			platform: 'facebook',
			accountLabel: 'Side Project Page',
			accessToken: 'page-token-2',
			facebookPageId: '222'
		});

		const listed = await config.listPlatformConnections('facebook');
		expect(listed.map((c) => c.accountLabel).sort()).toEqual(['My Streaming Page', 'Side Project Page']);

		const full = await config.getPlatformConnection(a.id);
		expect(full?.facebookPageId).toBe('111');

		expect(await config.revokePlatformConnection(a.id)).toBe(true);
		expect((await config.listPlatformConnections('facebook')).map((c) => c.id)).toEqual([b.id]);
	});

	it('updates tokens in place on refresh, leaving label/id/connectedAt untouched', async () => {
		const created = await config.createPlatformConnection({
			platform: 'twitch',
			accountLabel: 'gmpekk',
			accessToken: 'at-1',
			expiresAt: 100
		});

		expect(await config.updatePlatformConnectionTokens(created.id, { accessToken: 'at-2', expiresAt: 200 })).toBe(true);
		const refreshed = await config.getPlatformConnection(created.id);
		expect(refreshed?.accessToken).toBe('at-2');
		expect(refreshed?.expiresAt).toBe(200);
		expect(refreshed?.accountLabel).toBe('gmpekk');
		expect(refreshed?.connectedAt).toBe(created.connectedAt);

		expect(await config.updatePlatformConnectionTokens('missing-id', { accessToken: 'x' })).toBe(false);
	});

	it('loads a pre-existing config.json that predates platformConnections', async () => {
		writeFileSync(
			join(dir, 'config.json'),
			JSON.stringify({ passwordHash: null, sessionSecret: 'abc', bearerTokens: [], urlTokens: [] })
		);
		vi.resetModules();
		config = await import('./config');

		expect(await config.listPlatformConnections()).toEqual([]);
		// The pre-existing sessionSecret survives the migration, not silently replaced.
		expect(await config.getSessionSecret()).toBe('abc');
	});
});
