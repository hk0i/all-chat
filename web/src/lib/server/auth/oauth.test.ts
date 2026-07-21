import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, type OAuthProviderConfig } from './oauth';

const config: OAuthProviderConfig = {
	authorizeUrl: 'https://example.com/oauth2/authorize',
	tokenUrl: 'https://example.com/oauth2/token',
	clientId: 'client-123',
	clientSecret: 'shh',
	redirectUri: 'http://localhost:3000/api/auth/oauth/example/callback',
	scope: 'chat:edit'
};

describe('buildAuthorizationUrl', () => {
	it('includes the required OAuth2 params plus the CSRF state', () => {
		const url = new URL(buildAuthorizationUrl(config, 'nonce-abc'));
		expect(url.origin + url.pathname).toBe('https://example.com/oauth2/authorize');
		expect(url.searchParams.get('client_id')).toBe('client-123');
		expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toBe('chat:edit');
		expect(url.searchParams.get('state')).toBe('nonce-abc');
	});

	it('includes provider-specific extra params (e.g. Google refresh-token forcing)', () => {
		const url = new URL(
			buildAuthorizationUrl(
				{ ...config, extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' } },
				'nonce'
			)
		);
		expect(url.searchParams.get('access_type')).toBe('offline');
		expect(url.searchParams.get('prompt')).toBe('consent');
	});
});

describe('exchangeCodeForTokens', () => {
	it('posts an authorization_code grant and parses the response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }), {
				status: 200
			})
		);

		const before = Date.now();
		const tokens = await exchangeCodeForTokens(config, 'auth-code', fetchImpl as unknown as typeof fetch);

		expect(tokens.accessToken).toBe('at-1');
		expect(tokens.refreshToken).toBe('rt-1');
		expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(config.tokenUrl);
		const body = new URLSearchParams(init.body as string);
		expect(body.get('grant_type')).toBe('authorization_code');
		expect(body.get('code')).toBe('auth-code');
		expect(body.get('client_id')).toBe('client-123');
		expect(body.get('client_secret')).toBe('shh');
	});

	it('throws with the response body on a non-ok response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid_grant', { status: 400 }));
		await expect(exchangeCodeForTokens(config, 'bad-code', fetchImpl as unknown as typeof fetch)).rejects.toThrow(
			/400/
		);
	});

	it('omits expiresAt when the provider omits expires_in', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 }));
		const tokens = await exchangeCodeForTokens(config, 'code', fetchImpl as unknown as typeof fetch);
		expect(tokens.expiresAt).toBeUndefined();
	});
});

describe('refreshAccessToken', () => {
	it('posts a refresh_token grant', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ access_token: 'at-2', expires_in: 60 }), { status: 200 }));

		const tokens = await refreshAccessToken(config, 'rt-1', fetchImpl as unknown as typeof fetch);
		expect(tokens.accessToken).toBe('at-2');

		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		const body = new URLSearchParams(init.body as string);
		expect(body.get('grant_type')).toBe('refresh_token');
		expect(body.get('refresh_token')).toBe('rt-1');
	});
});
