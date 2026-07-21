import { clearAdminPassword } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

/**
 * Disables app auth entirely (EDD §6.1's "off until configured" state,
 * re-entered on purpose). Not a public path — reaching this at all already
 * requires a valid session, i.e. you have to be logged in to turn your own
 * auth off. "Change password" is just this followed by `/login`'s first-run
 * setup form again; no separate change-password flow needed.
 */
export const DELETE: RequestHandler = async () => {
	await clearAdminPassword();
	return new Response(null, { status: 204 });
};
