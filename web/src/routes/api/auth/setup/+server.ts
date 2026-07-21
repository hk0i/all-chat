import { error, json } from '@sveltejs/kit';
import { getSessionSecret, isAuthEnabled, setAdminPassword } from '$lib/server/auth/config';
import { SESSION_COOKIE, createSessionToken } from '$lib/server/auth/tokens';
import type { RequestHandler } from './$types';

/** Matches the login route's session lifetime (EDD §6.1: long-lived, refresh-on-use). */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const MIN_PASSWORD_LENGTH = 8;

/**
 * First-run only: sets the admin password interactively instead of via
 * `ALLCHAT_PASSWORD`. Refuses once a password already exists — changing an
 * existing password is a control-panel action for a later slice, not this
 * one, and requires being logged in already rather than being another
 * public-by-necessity route like this one.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	if (await isAuthEnabled()) throw error(400, 'a password is already set for this deployment');

	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	if (!body || typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
		throw error(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
	}

	await setAdminPassword(body.password);

	const token = createSessionToken(await getSessionSecret(), Date.now() + SESSION_TTL_MS);
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: SESSION_TTL_MS / 1000
	});
	return json({ ok: true });
};
