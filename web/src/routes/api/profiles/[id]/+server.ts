import { error, json } from '@sveltejs/kit';
import { deleteProfile, updateProfile } from '$lib/server/profiles';
import { normalizeSources } from '$lib/server/validate';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		sources?: unknown;
	} | null;
	if (!body || typeof body.name !== 'string' || !body.name.trim()) {
		throw error(400, 'name is required');
	}
	const updated = await updateProfile(params.id, {
		name: body.name.trim(),
		sources: normalizeSources(body.sources)
	});
	if (!updated) throw error(404, `profile "${params.id}" not found`);
	return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await deleteProfile(params.id))) throw error(404, `profile "${params.id}" not found`);
	return new Response(null, { status: 204 });
};
