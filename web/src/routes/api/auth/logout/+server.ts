import { SESSION_COOKIE } from '$lib/server/auth/tokens';
import type { RequestHandler } from './$types';

/**
 * Always clears the cookie regardless of current session validity — an
 * expired/invalid session cookie is harmless but a "log out" button that
 * 401s on a stale cookie would be broken UX, so this stays in
 * hooks.server.ts's public-path allowlist alongside login.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return new Response(null, { status: 204 });
};
