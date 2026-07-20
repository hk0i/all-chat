import { error, json } from '@sveltejs/kit';
import { createProfile, listProfiles } from '$lib/server/profiles';
import { normalizeSources } from '$lib/server/validate';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listProfiles());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		sources?: unknown;
	} | null;
	if (!body || typeof body.name !== 'string' || !body.name.trim()) {
		throw error(400, 'name is required');
	}
	const profile = await createProfile(body.name.trim(), normalizeSources(body.sources));
	return json(profile, { status: 201 });
};
