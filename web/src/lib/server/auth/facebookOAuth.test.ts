import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildFacebookAuthorizationUrl,
	exchangeCodeForUserToken,
	exchangeForLongLivedUserToken,
	facebookAppConfig,
	isFacebookConfigured,
	listManagedPages,
	type FacebookAppConfig
} from './facebookOAuth';

const config: FacebookAppConfig = {
	appId: 'app-123',
	appSecret: 'shh',
	redirectUri: 'http://localhost:3000/api/auth/oauth/facebook/callback'
};

describe('buildFacebookAuthorizationUrl', () => {
	it('includes client id, redirect uri, page scopes, and the CSRF state', () => {
		const url = new URL(buildFacebookAuthorizationUrl(config, 'nonce-abc'));
		expect(url.hostname).toBe('www.facebook.com');
		expect(url.pathname).toMatch(/\/dialog\/oauth$/);
		expect(url.searchParams.get('client_id')).toBe('app-123');
		expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
		expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement');
		expect(url.searchParams.get('state')).toBe('nonce-abc');
	});
});

describe('exchangeCodeForUserToken', () => {
	it('requests a short-lived user token with the code', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ access_token: 'short-1', expires_in: 5400 }), { status: 200 }));

		const before = Date.now();
		const tokens = await exchangeCodeForUserToken(config, 'auth-code', fetchImpl as unknown as typeof fetch);

		expect(tokens.accessToken).toBe('short-1');
		expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 5400 * 1000);

		const requestUrl = new URL((fetchImpl.mock.calls[0] as [URL])[0]);
		expect(requestUrl.searchParams.get('code')).toBe('auth-code');
		expect(requestUrl.searchParams.get('client_secret')).toBe('shh');
	});

	it('throws with the response body on a non-ok response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid_code', { status: 400 }));
		await expect(exchangeCodeForUserToken(config, 'bad-code', fetchImpl as unknown as typeof fetch)).rejects.toThrow(
			/400/
		);
	});
});

describe('exchangeForLongLivedUserToken', () => {
	it('requests the fb_exchange_token grant', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ access_token: 'long-1', expires_in: 5184000 }), { status: 200 }));

		const tokens = await exchangeForLongLivedUserToken(config, 'short-1', fetchImpl as unknown as typeof fetch);
		expect(tokens.accessToken).toBe('long-1');

		const requestUrl = new URL((fetchImpl.mock.calls[0] as [URL])[0]);
		expect(requestUrl.searchParams.get('grant_type')).toBe('fb_exchange_token');
		expect(requestUrl.searchParams.get('fb_exchange_token')).toBe('short-1');
	});
});

describe('listManagedPages', () => {
	it('maps the accounts response to FacebookPage records', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{ id: '111', name: 'My Streaming Page', access_token: 'page-token-1' },
						{ id: '222', name: 'Side Project Page', access_token: 'page-token-2' }
					]
				}),
				{ status: 200 }
			)
		);

		const pages = await listManagedPages('long-1', fetchImpl as unknown as typeof fetch);
		expect(pages).toEqual([
			{ id: '111', name: 'My Streaming Page', accessToken: 'page-token-1' },
			{ id: '222', name: 'Side Project Page', accessToken: 'page-token-2' }
		]);

		const requestUrl = new URL((fetchImpl.mock.calls[0] as [URL])[0]);
		expect(requestUrl.searchParams.get('access_token')).toBe('long-1');
	});
});

describe('facebookAppConfig / isFacebookConfigured', () => {
	const OLD_ENV = process.env;

	afterEach(() => {
		process.env = OLD_ENV;
	});

	it('is undefined/false when env vars are unset', () => {
		process.env = { ...OLD_ENV, FACEBOOK_APP_ID: undefined, FACEBOOK_APP_SECRET: undefined };
		expect(facebookAppConfig('http://localhost:3000')).toBeUndefined();
		expect(isFacebookConfigured()).toBe(false);
	});

	it('builds a config with the callback redirect URI when env vars are set', () => {
		process.env = { ...OLD_ENV, FACEBOOK_APP_ID: 'app-123', FACEBOOK_APP_SECRET: 'shh' };
		expect(isFacebookConfigured()).toBe(true);
		expect(facebookAppConfig('http://localhost:3000')).toEqual({
			appId: 'app-123',
			appSecret: 'shh',
			redirectUri: 'http://localhost:3000/api/auth/oauth/facebook/callback'
		});
	});
});
