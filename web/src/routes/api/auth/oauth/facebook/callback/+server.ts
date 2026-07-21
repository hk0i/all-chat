import { error, redirect } from '@sveltejs/kit';
import { createPlatformConnection } from '$lib/server/auth/config';
import {
	exchangeCodeForUserToken,
	exchangeForLongLivedUserToken,
	facebookAppConfig,
	listManagedPages
} from '$lib/server/auth/facebookOAuth';
import { OAUTH_STATE_COOKIE } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

/**
 * Receives Facebook's redirect back, then runs the rest of the three-hop
 * exchange (facebookOAuth.ts) and connects *every* Page the user manages —
 * no page-picker step. Each Page becomes its own connection (same
 * many-per-platform model as Twitch/YouTube, EDD-V2 §3); the admin can
 * individually disconnect ones they don't want from the control panel.
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const expectedState = cookies.get(OAUTH_STATE_COOKIE);
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/api/auth/oauth' });

	const providerError = url.searchParams.get('error');
	if (providerError) throw error(400, `Facebook declined the connection: ${providerError}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state || !expectedState || state !== expectedState) {
		throw error(400, 'invalid or expired OAuth state — try connecting again');
	}

	const config = facebookAppConfig(url.origin);
	if (!config) throw error(400, 'Facebook OAuth is not configured on this deployment');

	let pages;
	try {
		const shortLived = await exchangeCodeForUserToken(config, code);
		const longLived = await exchangeForLongLivedUserToken(config, shortLived.accessToken);
		pages = await listManagedPages(longLived.accessToken);
	} catch (cause) {
		throw error(502, `Facebook rejected the connection: ${(cause as Error).message}`);
	}

	if (pages.length === 0) {
		throw error(400, "Facebook returned no Pages you manage — connect an account that's an admin of at least one Page");
	}

	await Promise.all(
		pages.map((page) =>
			createPlatformConnection({
				platform: 'facebook',
				accountLabel: page.name,
				accessToken: page.accessToken,
				facebookPageId: page.id
			})
		)
	);

	redirect(302, '/admin');
};
