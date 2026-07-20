/**
 * Every Kick-specific constant lives here, deliberately in one file: Kick's
 * API is unofficial and has churned before (Pusher key/cluster changes,
 * endpoint shape drift). When it breaks, this is the file to fix (EDD §3.2).
 */

/** Channel metadata lookup — returns `chatroom.id` among other fields. Behind Cloudflare. */
export const KICK_CHANNEL_API = (slug: string) =>
	`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;

/**
 * Kick's public Pusher application key — shipped to every browser on
 * kick.com, not a secret. Current as of 2026-07.
 *
 * If chat stops connecting, re-derive the current value: open kick.com in a
 * browser with DevTools → Network tab → filter "WS" → reload. The chat
 * WebSocket URL has the form `wss://ws-<cluster>.pusher.com/app/<KEY>?protocol=7`
 * — copy the `<KEY>` path segment (and update the cluster host if that
 * changed too). Community client libraries (e.g. KickLib, kick-chat-wrapper
 * on GitHub) usually track key rotations quickly and are a good cross-check.
 *
 * Overridable without a code change via environment variables (EDD §3.2):
 * `KICK_PUSHER_KEY` and `KICK_PUSHER_HOST` — set them in the container env
 * and restart. An admin-UI setting is planned once the v2 control panel
 * exists.
 */
export const KICK_PUSHER_KEY = process.env.KICK_PUSHER_KEY || '32cbd69e4b950bf97679';

/** Pusher cluster host — rotates rarely; overridable alongside the key. */
export const KICK_PUSHER_HOST = process.env.KICK_PUSHER_HOST || 'ws-us2.pusher.com';

/** Pusher WebSocket endpoint (protocol 7). */
export const KICK_PUSHER_URL = `wss://${KICK_PUSHER_HOST}/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=8.4.0`;

/** Pusher channel name carrying chat messages for a chatroom. */
export const KICK_CHATROOM_CHANNEL = (chatroomId: number) => `chatrooms.${chatroomId}.v2`;

/** Pusher event name for chat messages (PHP class path, hence the backslashes). */
export const KICK_CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';

/** Emote image CDN. */
export const KICK_EMOTE_URL = (emoteId: string) => `https://files.kick.com/emotes/${emoteId}/fullsize`;
