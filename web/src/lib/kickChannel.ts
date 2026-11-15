/** Channel metadata lookup — returns `chatroom.id` among other fields. Behind Cloudflare. */
export const KICK_CHANNEL_API = (slug: string) =>
	`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;

/** Bare slug, or a kick.com channel URL; captures the slug. */
const KICK_SLUG = /^(?:https?:\/\/)?(?:www\.)?(?:kick\.com\/)?([a-z0-9_-]{1,25})\/?$/i;

const CHATROOM_ID = /^\d+$/;

export type KickChannelInput =
	| { kind: 'empty' }
	| { kind: 'chatroomId' }
	| { kind: 'slug'; slug: string }
	| { kind: 'invalid' };

/** Classifies what the user typed in a Kick channel field. All-digit text is always a chatroom id. */
export function parseKickChannel(input: string): KickChannelInput {
	const text = input.trim();
	if (!text) {
		return { kind: 'empty' };
	}
	if (CHATROOM_ID.test(text)) {
		return { kind: 'chatroomId' };
	}
	const slug = KICK_SLUG.exec(text)?.[1];
	return slug ? { kind: 'slug', slug: slug.toLowerCase() } : { kind: 'invalid' };
}

export class KickChannelError extends Error {}

/**
 * Browser-only: kick.com's Cloudflare refuses Node's fetch by fingerprint
 * but accepts browsers, and echoes our origin in CORS headers.
 */
export async function resolveKickChatroom(slug: string, fetchFn: typeof fetch = fetch): Promise<number> {
	let response: Response;
	try {
		response = await fetchFn(KICK_CHANNEL_API(slug), { headers: { accept: 'application/json' } });
	} catch {
		throw new KickChannelError(`Couldn't reach kick.com. Enter the chatroom id instead.`);
	}
	if (response.status === 404) {
		throw new KickChannelError(`No Kick channel named "${slug}". Check the spelling or enter the chatroom id.`);
	}
	const body = response.ok ? await response.json().catch(() => null) : null;
	const id = body?.chatroom?.id;
	if (typeof id !== 'number') {
		throw new KickChannelError(`Kick didn't return a chatroom id for "${slug}". Enter it by hand.`);
	}
	return id;
}
