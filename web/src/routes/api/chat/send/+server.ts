import { error, json } from '@sveltejs/kit';
import { findProfile } from '$lib/server/profiles';
import { sendChatMessage } from '$lib/server/send';
import type { RequestHandler } from './$types';

/**
 * Chat send fan-out (EDD-V2 §5) — the "one box out" mirror of the one
 * unified feed in. Reachable by session cookie or a write-scoped bearer
 * token (hooks.server.ts's explicit allowlist for this one path).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { profileId?: unknown; text?: unknown };
	if (typeof body.profileId !== 'string' || !body.profileId) throw error(400, 'profileId is required');
	if (typeof body.text !== 'string' || !body.text.trim()) throw error(400, 'text is required');

	const profile = await findProfile(body.profileId);
	if (!profile) throw error(404, 'profile not found');

	const results = await sendChatMessage(profile.sources, body.text.trim());
	return json({ results });
};
