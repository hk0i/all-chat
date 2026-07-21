import type { OAuthProviderConfig } from './oauth';

/**
 * Twitch and YouTube already have anonymous read (EDD §3) — connecting these
 * providers is only about unlocking *sending* messages (EDD-V2 §5), not
 * reading. Returns undefined when the operator hasn't configured the
 * provider's client id/secret (env vars), same "feature absent until
 * configured" shape as everything else in the auth system.
 *
 * Kick's official app-registration story is newer and less stable
 * (EDD-V2 §3, §8) — deliberately not wired here yet. Facebook gets its own
 * handling in the Facebook slice (EDD-V2 §4), not this generic OAuth2 path.
 */

export function twitchOAuthConfig(origin: string): OAuthProviderConfig | undefined {
	const clientId = process.env.TWITCH_CLIENT_ID;
	const clientSecret = process.env.TWITCH_CLIENT_SECRET;
	if (!clientId || !clientSecret) return undefined;
	return {
		authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
		tokenUrl: 'https://id.twitch.tv/oauth2/token',
		clientId,
		clientSecret,
		redirectUri: `${origin}/api/auth/oauth/twitch/callback`,
		scope: 'chat:edit'
	};
}

export function youtubeOAuthConfig(origin: string): OAuthProviderConfig | undefined {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) return undefined;
	return {
		authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		clientId,
		clientSecret,
		redirectUri: `${origin}/api/auth/oauth/youtube/callback`,
		scope: 'https://www.googleapis.com/auth/youtube',
		// Google only returns a refresh_token on the first-ever consent unless forced.
		extraAuthorizeParams: { access_type: 'offline', prompt: 'consent' }
	};
}

/** Shared between the start and callback routes — SvelteKit route modules may only export handlers, not arbitrary constants. */
export const OAUTH_STATE_COOKIE = 'allchat_oauth_state';

export type OAuthPlatform = 'twitch' | 'youtube';

export function isOAuthPlatform(value: string): value is OAuthPlatform {
	return value === 'twitch' || value === 'youtube';
}

export function oauthConfigFor(platform: OAuthPlatform, origin: string): OAuthProviderConfig | undefined {
	switch (platform) {
		case 'twitch':
			return twitchOAuthConfig(origin);
		case 'youtube':
			return youtubeOAuthConfig(origin);
	}
}

/** Whether the operator has set this provider's client id/secret env vars — checked without needing an origin/redirect URI. */
export function isProviderConfigured(platform: OAuthPlatform): boolean {
	switch (platform) {
		case 'twitch':
			return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
		case 'youtube':
			return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}
}
