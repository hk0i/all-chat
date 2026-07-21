import { error, json } from '@sveltejs/kit';
import { getSessionSecret, isAuthEnabled, verifyAdminPassword } from '$lib/server/auth/config';
import { SESSION_COOKIE, createSessionToken } from '$lib/server/auth/tokens';
import type { RequestHandler } from './$types';

/** Long-lived, refresh-on-use (EDD §6.1) — the streamer logs into the dock once, not every stream. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	if (!(await isAuthEnabled())) throw error(400, 'auth is not enabled for this deployment');

	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	if (!body || typeof body.password !== 'string' || !body.password) {
		throw error(400, 'password is required');
	}
	if (!(await verifyAdminPassword(body.password))) throw error(401, 'incorrect password');

	const token = createSessionToken(await getSessionSecret(), Date.now() + SESSION_TTL_MS);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// The app never terminates TLS itself (EDD §6.1) — Secure would silently break plain-HTTP LAN logins.
		secure: url.protocol === 'https:',
		maxAge: SESSION_TTL_MS / 1000
	});
	return json({ ok: true });
};
