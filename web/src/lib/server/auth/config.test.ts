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

describe('platform OAuth tokens', () => {
	it('round-trips save/get/clear and preserves connectedAt across refreshes', async () => {
		await config.savePlatformTokens('twitch', { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 123 });
		const first = await config.getPlatformTokens('twitch');
		expect(first?.accessToken).toBe('at-1');
		const connectedAt = first?.connectedAt;

		// Simulate a token refresh: same platform, new access token.
		await config.savePlatformTokens('twitch', { accessToken: 'at-2', expiresAt: 456 });
		const refreshed = await config.getPlatformTokens('twitch');
		expect(refreshed?.accessToken).toBe('at-2');
		expect(refreshed?.connectedAt).toBe(connectedAt);

		expect(await config.clearPlatformTokens('twitch')).toBe(true);
		expect(await config.getPlatformTokens('twitch')).toBeUndefined();
		expect(await config.clearPlatformTokens('twitch')).toBe(false);
	});

	it('reports connection status without exposing tokens', async () => {
		await config.savePlatformTokens('youtube', { accessToken: 'at-1' });
		const statuses = await config.listPlatformConnections(['twitch', 'youtube']);

		expect(statuses).toEqual([
			{ platform: 'twitch', connected: false, connectedAt: null },
			{ platform: 'youtube', connected: true, connectedAt: expect.any(Number) }
		]);
	});

	it('loads a pre-existing config.json that predates platformTokens', async () => {
		writeFileSync(
			join(dir, 'config.json'),
			JSON.stringify({ passwordHash: null, sessionSecret: 'abc', bearerTokens: [], urlTokens: [] })
		);
		vi.resetModules();
		config = await import('./config');

		expect(await config.listPlatformConnections(['twitch'])).toEqual([
			{ platform: 'twitch', connected: false, connectedAt: null }
		]);
		// The pre-existing sessionSecret survives the migration, not silently replaced.
		expect(await config.getSessionSecret()).toBe('abc');
	});
});
