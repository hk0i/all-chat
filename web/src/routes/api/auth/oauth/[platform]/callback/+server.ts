import { error, redirect } from '@sveltejs/kit';
import { savePlatformTokens } from '$lib/server/auth/config';
import { exchangeCodeForTokens } from '$lib/server/auth/oauth';
import { isOAuthPlatform, oauthConfigFor, OAUTH_STATE_COOKIE } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

/**
 * Receives the provider's redirect back after the streamer approves (or
 * declines) the connection. The state cookie set in `start` is the CSRF
 * check — without it matching, a stray/replayed callback can't complete.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	if (!isOAuthPlatform(params.platform)) throw error(404, `unknown OAuth platform "${params.platform}"`);

	const expectedState = cookies.get(OAUTH_STATE_COOKIE);
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/api/auth/oauth' });

	const providerError = url.searchParams.get('error');
	if (providerError) throw error(400, `${params.platform} declined the connection: ${providerError}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state || !expectedState || state !== expectedState) {
		throw error(400, 'invalid or expired OAuth state — try connecting again');
	}

	const config = oauthConfigFor(params.platform, url.origin);
	if (!config) throw error(400, `${params.platform} OAuth is not configured on this deployment`);

	let tokens;
	try {
		tokens = await exchangeCodeForTokens(config, code);
	} catch (cause) {
		// A bad client secret, an already-used/expired code, or the provider being
		// down all land here — a real, expected failure mode for an admin
		// mis-typing credentials, not an unexpected server error.
		throw error(502, `${params.platform} rejected the token exchange: ${(cause as Error).message}`);
	}
	await savePlatformTokens(params.platform, tokens);

	redirect(302, '/admin');
};
