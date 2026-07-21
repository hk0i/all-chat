/**
 * Facebook's OAuth shape doesn't fit the generic `oauth.ts` helper — it's a
 * three-hop exchange, not a single code-for-token call (EDD-V2 §4):
 *
 * 1. Authorization-code redirect (same as Twitch/YouTube) yields a
 *    short-lived user access token (~1-2 hours).
 * 2. That gets exchanged for a long-lived user token (~60 days).
 * 3. `/me/accounts` on the long-lived user token lists every Page the user
 *    manages, each with its own Page access token — Page tokens derived
 *    this way don't expire on their own schedule the way user tokens do,
 *    which is why step 2 matters: skip it and the Page token inherits the
 *    short-lived user token's ~2-hour lifetime instead.
 *
 * Reading a Page's Live Video comments needs the Page token from step 3,
 * not the user token from steps 1-2 — those only exist to get there.
 */

/** Meta deprecates Graph API versions on a ~2-year cycle; override without a code change if this drifts, same pattern as Kick's Pusher key (EDD §3.2). */
const GRAPH_API_VERSION = process.env.FACEBOOK_GRAPH_API_VERSION ?? 'v21.0';

export interface FacebookAppConfig {
	appId: string;
	appSecret: string;
	redirectUri: string;
}

/** `undefined` when `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` aren't set — same "absent until configured" shape as Twitch/YouTube (providers.ts). */
export function facebookAppConfig(origin: string): FacebookAppConfig | undefined {
	const appId = process.env.FACEBOOK_APP_ID;
	const appSecret = process.env.FACEBOOK_APP_SECRET;
	if (!appId || !appSecret) return undefined;
	return { appId, appSecret, redirectUri: `${origin}/api/auth/oauth/facebook/callback` };
}

export function isFacebookConfigured(): boolean {
	return !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
}

export interface FacebookPage {
	id: string;
	name: string;
	accessToken: string;
}

/** `pages_show_list` to enumerate managed Pages, `pages_read_engagement` to read their Live Video comments. */
const SCOPE = 'pages_show_list,pages_read_engagement';

export function buildFacebookAuthorizationUrl(config: FacebookAppConfig, state: string): string {
	const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
	url.searchParams.set('client_id', config.appId);
	url.searchParams.set('redirect_uri', config.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', SCOPE);
	url.searchParams.set('state', state);
	return url.toString();
}

interface FacebookTokenResponse {
	access_token: string;
	expires_in?: number;
}

async function getGraphJson<T>(url: URL, fetchImpl: typeof fetch): Promise<T> {
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(`Facebook Graph API request failed: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as T;
}

/** Step 1→2: authorization code → short-lived user access token. */
export async function exchangeCodeForUserToken(
	config: FacebookAppConfig,
	code: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; expiresAt?: number }> {
	const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
	url.searchParams.set('client_id', config.appId);
	url.searchParams.set('client_secret', config.appSecret);
	url.searchParams.set('redirect_uri', config.redirectUri);
	url.searchParams.set('code', code);

	const body = await getGraphJson<FacebookTokenResponse>(url, fetchImpl);
	return {
		accessToken: body.access_token,
		expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined
	};
}

/** Step 2: short-lived user token → long-lived (~60 day) user token. */
export async function exchangeForLongLivedUserToken(
	config: FacebookAppConfig,
	shortLivedToken: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; expiresAt?: number }> {
	const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
	url.searchParams.set('grant_type', 'fb_exchange_token');
	url.searchParams.set('client_id', config.appId);
	url.searchParams.set('client_secret', config.appSecret);
	url.searchParams.set('fb_exchange_token', shortLivedToken);

	const body = await getGraphJson<FacebookTokenResponse>(url, fetchImpl);
	return {
		accessToken: body.access_token,
		expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined
	};
}

interface AccountsResponse {
	data: { id: string; name: string; access_token: string }[];
}

/** Step 3: every Page the user manages, each with its own (effectively long-lived) Page access token. */
export async function listManagedPages(
	longLivedUserToken: string,
	fetchImpl: typeof fetch = fetch
): Promise<FacebookPage[]> {
	const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts`);
	url.searchParams.set('access_token', longLivedUserToken);

	const body = await getGraphJson<AccountsResponse>(url, fetchImpl);
	return body.data.map((page) => ({ id: page.id, name: page.name, accessToken: page.access_token }));
}
