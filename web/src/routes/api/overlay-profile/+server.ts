import { error, json } from '@sveltejs/kit';
import { getOverlayProfileId, setOverlayProfileId } from '$lib/server/overlayProfile';
import { findProfile } from '$lib/server/profiles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ profileId: await getOverlayProfileId() });

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { profileId?: unknown } | null;
	const profileId = body?.profileId;
	if (profileId !== null && typeof profileId !== 'string') {
		throw error(400, 'profileId must be a string or null');
	}
	if (profileId !== null && !(await findProfile(profileId))) {
		throw error(404, `profile "${profileId}" not found`);
	}
	await setOverlayProfileId(profileId);
	return json({ profileId });
};
