import { error, redirect } from '@sveltejs/kit';
import { buildFacebookAuthorizationUrl, facebookAppConfig } from '$lib/server/auth/facebookOAuth';
import { OAUTH_STATE_COOKIE } from '$lib/server/auth/providers';
import { generateToken } from '$lib/server/auth/tokens';
import type { RequestHandler } from './$types';

/**
 * Kicks off Facebook's authorization-code redirect (EDD-V2 §4). Not a
 * public path — same session-gating as the rest of the control panel that
 * hosts the "connect" button.
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const config = facebookAppConfig(url.origin);
	if (!config) throw error(400, 'Facebook OAuth is not configured on this deployment');

	const state = generateToken();
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: '/api/auth/oauth',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 600
	});

	redirect(302, buildFacebookAuthorizationUrl(config, state));
};
