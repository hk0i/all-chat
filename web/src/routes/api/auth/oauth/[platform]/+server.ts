import { error } from '@sveltejs/kit';
import { clearPlatformTokens } from '$lib/server/auth/config';
import { isOAuthPlatform } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

/** Disconnects a platform — clears its stored tokens. Reconnecting means going through `start` again. */
export const DELETE: RequestHandler = async ({ params }) => {
	if (!isOAuthPlatform(params.platform)) throw error(404, `unknown OAuth platform "${params.platform}"`);
	if (!(await clearPlatformTokens(params.platform))) {
		throw error(404, `${params.platform} is not connected`);
	}
	return new Response(null, { status: 204 });
};
