import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnectionRecord } from './config';

const { updatePlatformConnectionTokens } = vi.hoisted(() => ({ updatePlatformConnectionTokens: vi.fn() }));
vi.mock('./config', () => ({ updatePlatformConnectionTokens }));

const { refreshAccessToken } = vi.hoisted(() => ({ refreshAccessToken: vi.fn() }));
vi.mock('./oauth', () => ({ refreshAccessToken }));

const { ensureFreshToken } = await import('./tokenRefresh');

const BASE: PlatformConnectionRecord = {
	id: 'conn-1',
	platform: 'twitch',
	accountLabel: 'gmpekk',
	connectedAt: 1784000000000,
	accessToken: 'old-token',
	refreshToken: 'refresh-1',
	platformUserId: '999'
};

describe('ensureFreshToken', () => {
	beforeEach(() => {
		refreshAccessToken.mockReset();
		updatePlatformConnectionTokens.mockReset();
		vi.stubEnv('TWITCH_CLIENT_ID', 'client-1');
		vi.stubEnv('TWITCH_CLIENT_SECRET', 'secret-1');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('leaves a non-OAuth platform (facebook) untouched', async () => {
		const connection = { ...BASE, platform: 'facebook' as const, expiresAt: Date.now() - 1000 };
		const result = await ensureFreshToken(connection);
		expect(result).toBe(connection);
		expect(refreshAccessToken).not.toHaveBeenCalled();
	});

	it('leaves a connection with no expiresAt untouched (nothing to know is expiring)', async () => {
		const connection = { ...BASE };
		const result = await ensureFreshToken(connection);
		expect(result).toBe(connection);
		expect(refreshAccessToken).not.toHaveBeenCalled();
	});

	it('leaves a connection with plenty of time left untouched', async () => {
		const connection = { ...BASE, expiresAt: Date.now() + 10 * 60_000 };
		const result = await ensureFreshToken(connection);
		expect(result).toBe(connection);
		expect(refreshAccessToken).not.toHaveBeenCalled();
	});

	it('refreshes and persists when expired, using the new token', async () => {
		const connection = { ...BASE, expiresAt: Date.now() - 1000 };
		refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', refreshToken: 'refresh-2', expiresAt: Date.now() + 3600_000 });

		const result = await ensureFreshToken(connection);

		expect(result.accessToken).toBe('new-token');
		expect(result.refreshToken).toBe('refresh-2');
		expect(updatePlatformConnectionTokens).toHaveBeenCalledWith('conn-1', {
			accessToken: 'new-token',
			refreshToken: 'refresh-2',
			expiresAt: expect.any(Number)
		});
	});

	it('preserves the existing refresh token when the provider does not resend one (Google behavior)', async () => {
		const connection = { ...BASE, expiresAt: Date.now() - 1000 };
		refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresAt: Date.now() + 3600_000 });

		const result = await ensureFreshToken(connection);

		expect(result.refreshToken).toBe('refresh-1');
		expect(updatePlatformConnectionTokens).toHaveBeenCalledWith(
			'conn-1',
			expect.objectContaining({ refreshToken: 'refresh-1' })
		);
	});

	it('throws without attempting a refresh when expired and no refresh token is stored', async () => {
		const connection = { ...BASE, expiresAt: Date.now() - 1000, refreshToken: undefined };
		await expect(ensureFreshToken(connection)).rejects.toThrow('no refresh token is stored');
		expect(refreshAccessToken).not.toHaveBeenCalled();
	});

	it('throws when the refresh request itself fails, without persisting anything', async () => {
		const connection = { ...BASE, expiresAt: Date.now() - 1000 };
		refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

		await expect(ensureFreshToken(connection)).rejects.toThrow('invalid_grant');
		expect(updatePlatformConnectionTokens).not.toHaveBeenCalled();
	});
});
