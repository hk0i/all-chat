import { error, json } from '@sveltejs/kit';
import { YouTubeResolveError, resolveInput } from '$lib/server/sources/youtube/resolve';
import type { RequestHandler } from './$types';

/**
 * Resolve a YouTube video URL / video id / @handle to a live video id
 * (EDD §3.4 helpers). 409 = channel exists but is not live.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const videoId = await resolveInput(decodeURIComponent(params.input));
		return json({ videoId });
	} catch (cause) {
		if (cause instanceof YouTubeResolveError) {
			throw error(cause.notLive ? 409 : 400, cause.message);
		}
		throw cause;
	}
};
