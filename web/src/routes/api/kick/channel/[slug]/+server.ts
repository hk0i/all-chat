import { error, json } from '@sveltejs/kit';
import { KickLookupError, lookupChatroomId } from '$lib/server/sources/kick/lookup';
import type { RequestHandler } from './$types';

/**
 * Resolve a Kick channel slug to its chatroom id (EDD §3.4 helpers).
 * 502 + blocked:true signals the UI to offer manual chatroom-id entry.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const chatroomId = await lookupChatroomId(params.slug);
		return json({ slug: params.slug.toLowerCase(), chatroomId });
	} catch (cause) {
		if (cause instanceof KickLookupError) {
			if (cause.status === 404) throw error(404, cause.message);
			return json({ error: cause.message, blocked: cause.blocked }, { status: 502 });
		}
		throw cause;
	}
};
