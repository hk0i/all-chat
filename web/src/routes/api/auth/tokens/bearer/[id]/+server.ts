import { error } from '@sveltejs/kit';
import { revokeBearerToken } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await revokeBearerToken(params.id))) throw error(404, `bearer token "${params.id}" not found`);
	return new Response(null, { status: 204 });
};
