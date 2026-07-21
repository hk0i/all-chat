import { error } from '@sveltejs/kit';
import { revokeUrlToken } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await revokeUrlToken(params.id))) throw error(404, `URL token "${params.id}" not found`);
	return new Response(null, { status: 204 });
};
