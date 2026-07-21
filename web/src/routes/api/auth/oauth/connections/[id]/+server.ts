import { error } from '@sveltejs/kit';
import { revokePlatformConnection } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

/** Disconnects one connected account by its own id — not by platform, since several accounts can share a platform (EDD-V2 §3). Reconnecting means going through `start` again. */
export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await revokePlatformConnection(params.id))) throw error(404, `connection "${params.id}" not found`);
	return new Response(null, { status: 204 });
};
