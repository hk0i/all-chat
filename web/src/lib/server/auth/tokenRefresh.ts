import type { PlatformConnectionRecord } from './config';
import { updatePlatformConnectionTokens } from './config';
import { refreshAccessToken } from './oauth';
import { isOAuthPlatform, oauthConfigFor } from './providers';

/** Refresh a little ahead of the real expiry to absorb request latency/clock skew. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Refreshes a connection's access token if it's expired or expiring soon
 * (EDD-V2 §3). Checked right before a send attempt uses the token, not on a
 * background timer — token freshness only ever matters at the moment of
 * use, and the read paths for Twitch/YouTube are anonymous, unaffected by
 * this entirely. Facebook Page tokens aren't handled here — they're derived
 * from a long-lived user token, not the short Twitch/Google access-token
 * cadence this refresh logic targets (EDD-V2 §4).
 */
export async function ensureFreshToken(connection: PlatformConnectionRecord): Promise<PlatformConnectionRecord> {
	if (!isOAuthPlatform(connection.platform)) return connection;
	if (!connection.expiresAt || connection.expiresAt - Date.now() > EXPIRY_SAFETY_MARGIN_MS) return connection;
	if (!connection.refreshToken) {
		throw new Error('access token expired and no refresh token is stored — reconnect this account');
	}

	// The origin only feeds oauthConfigFor's redirectUri field, which the
	// refresh_token grant below never sends (unlike authorization_code, which
	// needs it to prove the callback matches) — this placeholder never
	// leaves the process, so it's fine on any deployment host.
	const config = oauthConfigFor(connection.platform, 'http://localhost');
	if (!config) throw new Error(`${connection.platform} OAuth is not configured on this deployment`);

	let refreshed;
	try {
		refreshed = await refreshAccessToken(config, connection.refreshToken);
	} catch (cause) {
		throw new Error(`token refresh failed — reconnect this account: ${(cause as Error).message}`);
	}

	// Google doesn't resend a refresh_token on refresh (only on first consent)
	// — falling back to the existing one avoids silently wiping it via the
	// Object.assign in updatePlatformConnectionTokens, which would otherwise
	// permanently break every refresh after this one.
	const tokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? connection.refreshToken };
	await updatePlatformConnectionTokens(connection.id, tokens);
	return { ...connection, ...tokens };
}
