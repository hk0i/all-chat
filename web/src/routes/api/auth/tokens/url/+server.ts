import { error, json } from '@sveltejs/kit';
import { createUrlToken, listUrlTokens } from '$lib/server/auth/config';
import { findProfile } from '$lib/server/profiles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listUrlTokens());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { profileId?: unknown } | null;
	const profileId = body?.profileId;
	if (profileId !== null && typeof profileId !== 'string') {
		throw error(400, 'profileId must be a string or null');
	}
	if (profileId !== null && !(await findProfile(profileId))) throw error(404, `profile "${profileId}" not found`);

	const { id, token } = await createUrlToken(profileId ?? null);
	return json({ id, token });
};
