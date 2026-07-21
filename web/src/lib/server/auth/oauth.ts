/**
 * Generic OAuth 2.0 authorization-code flow — Twitch and Google (YouTube)
 * both speak plain OAuth2, so one hand-rolled helper covers both rather than
 * pulling in a client library (EDD §5.1's minimal-dependency stance already
 * applies this reasoning to the Twitch IRC / Kick Pusher / YouTube InnerTube
 * ingestion code). Facebook's Graph API token exchange has enough of its own
 * shape (page tokens, long-lived-token exchange) that it gets its own
 * handling in the Facebook slice (EDD-V2 §4) rather than being forced through
 * this helper.
 */

export interface OAuthProviderConfig {
	authorizeUrl: string;
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scope: string;
	/** e.g. Google's `access_type=offline&prompt=consent`, needed to get a refresh_token back. */
	extraAuthorizeParams?: Record<string, string>;
}

export interface OAuthTokens {
	accessToken: string;
	/** Not every provider/grant returns one (e.g. a refresh without rotation). */
	refreshToken?: string;
	/** Epoch ms; undefined if the provider didn't return an expiry. */
	expiresAt?: number;
}

/** `state` is the caller's CSRF nonce — round-tripped by the provider, verified by the callback route. */
export function buildAuthorizationUrl(config: OAuthProviderConfig, state: string): string {
	const url = new URL(config.authorizeUrl);
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', config.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', config.scope);
	url.searchParams.set('state', state);
	for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
}

async function requestTokens(
	tokenUrl: string,
	params: Record<string, string>,
	fetchImpl: typeof fetch
): Promise<OAuthTokens> {
	const response = await fetchImpl(tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body: new URLSearchParams(params)
	});
	if (!response.ok) {
		throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as TokenResponse;
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined
	};
}

export function exchangeCodeForTokens(
	config: OAuthProviderConfig,
	code: string,
	fetchImpl: typeof fetch = fetch
): Promise<OAuthTokens> {
	return requestTokens(
		config.tokenUrl,
		{
			grant_type: 'authorization_code',
			code,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			redirect_uri: config.redirectUri
		},
		fetchImpl
	);
}

export function refreshAccessToken(
	config: OAuthProviderConfig,
	refreshToken: string,
	fetchImpl: typeof fetch = fetch
): Promise<OAuthTokens> {
	return requestTokens(
		config.tokenUrl,
		{
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: config.clientId,
			client_secret: config.clientSecret
		},
		fetchImpl
	);
}
