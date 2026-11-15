/**
 * Every Kick-specific constant lives here, deliberately in one file: Kick's
 * API is unofficial and has churned before (Pusher key/cluster changes,
 * endpoint shape drift). When it breaks, this is the file to fix (EDD §3.2).
 * The Pusher app key is not hardcoded here: `credentials.ts` resolves it at
 * connect time and only falls back to the constants below.
 */

/** Defined in `kickChannel.ts` because the profiles page also calls it from the browser. */
export { KICK_CHANNEL_API } from '../../../kickChannel';

/** Asks Kick which realtime provider and credentials its web client should use. */
export const KICK_REALTIME_CONNECTION_API = 'https://web.kick.com/api/v1/realtime/connection';

export const KICK_PUSHER_CLUSTER_HOST = (cluster: string) => `ws-${cluster}.pusher.com`;

/** Used only when Kick cannot be asked and no earlier answer is kept. Current as of 2026-11. */
export const KICK_PUSHER_FALLBACK_KEY = '34bf7a0ff419a2a775b9';
export const KICK_PUSHER_FALLBACK_HOST = 'ws-us2.pusher.com';

/** Pusher WebSocket endpoint (protocol 7). */
export const KICK_PUSHER_SOCKET_URL = (host: string, appKey: string) =>
	`wss://${host}/app/${appKey}?protocol=7&client=js&version=8.4.0`;

/** Pusher channel name carrying chat messages for a chatroom. */
export const KICK_CHATROOM_CHANNEL = (chatroomId: number) => `chatrooms.${chatroomId}.v2`;

/** Pusher event name for chat messages (PHP class path, hence the backslashes). */
export const KICK_CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';

/** Emote image CDN. */
export const KICK_EMOTE_URL = (emoteId: string) => `https://files.kick.com/emotes/${emoteId}/fullsize`;
