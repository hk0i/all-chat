import { json } from '@sveltejs/kit';
import { isAuthEnabled } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

/** Public — the login page needs this before the visitor has any credential to present. */
export const GET: RequestHandler = async () => json({ enabled: await isAuthEnabled() });
