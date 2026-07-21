import { error, type Handle } from '@sveltejs/kit';
import { getSessionSecret, isAuthEnabled, setAdminPassword, verifyBearerToken, verifyUrlToken } from '$lib/server/auth/config';
import { SESSION_COOKIE, verifySessionToken } from '$lib/server/auth/tokens';

/** Reachable with no credential at all, even once a password is set — logging in has to start somewhere. */
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

/** A URL token grants "page load + chat stream only" (EDD §6.1) — never CRUD, regardless of method. */
const URL_TOKEN_PATHS = new Set(['/', '/api/chat/stream', '/api/overlay-profile']);

const isMutating = (method: string) => method !== 'GET' && method !== 'HEAD';

let envPasswordChecked = false;

/** First-run convenience: `ALLCHAT_PASSWORD` sets the admin password once, only while none is configured yet (EDD §6.1). */
async function bootstrapPasswordFromEnv(): Promise<void> {
	if (envPasswordChecked) return;
	envPasswordChecked = true;
	const envPassword = process.env.ALLCHAT_PASSWORD;
	if (!envPassword || (await isAuthEnabled())) return;
	await setAdminPassword(envPassword);
}

async function authorize(event: Parameters<Handle>[0]['event']): Promise<boolean> {
	const sessionCookie = event.cookies.get(SESSION_COOKIE);
	if (sessionCookie && verifySessionToken(await getSessionSecret(), sessionCookie)) return true;

	const bearerMatch = event.request.headers.get('authorization')?.match(/^Bearer (.+)$/);
	if (bearerMatch) {
		const record = await verifyBearerToken(bearerMatch[1]);
		if (record && (!isMutating(event.request.method) || record.scope === 'write')) return true;
	}

	const urlToken = event.url.searchParams.get('token');
	if (urlToken && !isMutating(event.request.method) && URL_TOKEN_PATHS.has(event.url.pathname)) {
		if (await verifyUrlToken(urlToken)) return true;
	}

	return false;
}

/**
 * Single request choke point (EDD §6.1). Auth is off until an admin
 * password exists — v1-compatible pass-through by default. Once one is set,
 * every request needs a valid session cookie, bearer token, or (GET-only,
 * page/stream paths only) URL token.
 */
export const handle: Handle = async ({ event, resolve }) => {
	await bootstrapPasswordFromEnv();

	if (!(await isAuthEnabled())) return resolve(event);
	if (PUBLIC_PATHS.has(event.url.pathname)) return resolve(event);
	if (await authorize(event)) return resolve(event);

	throw error(401, 'authentication required');
};
