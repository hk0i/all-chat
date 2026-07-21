import { error, redirect } from '@sveltejs/kit';
import { buildAuthorizationUrl } from '$lib/server/auth/oauth';
import { isOAuthPlatform, oauthConfigFor, OAUTH_STATE_COOKIE } from '$lib/server/auth/providers';
import { generateToken } from '$lib/server/auth/tokens';
import type { RequestHandler } from './$types';

/**
 * Kicks off the OAuth2 authorization-code flow for a platform (EDD-V2 §3).
 * Not a public path — reaching this at all already requires the admin
 * session (or auth being off entirely), same as the rest of the control
 * panel that hosts the "connect" buttons.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	if (!isOAuthPlatform(params.platform)) throw error(404, `unknown OAuth platform "${params.platform}"`);

	const config = oauthConfigFor(params.platform, url.origin);
	if (!config) throw error(400, `${params.platform} OAuth is not configured on this deployment`);

	const state = generateToken();
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: '/api/auth/oauth',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 600
	});

	redirect(302, buildAuthorizationUrl(config, state));
};
