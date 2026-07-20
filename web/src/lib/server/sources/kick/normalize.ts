import type { Badge, BadgeKind, ChatMessage, Fragment } from '@all-chat/contract';
import { hashColor } from '../color';
import { KICK_EMOTE_URL } from './constants';

/**
 * Normalize a Kick Pusher `ChatMessageEvent` payload into the wire contract.
 *
 * Payload shape (unofficial API — validated defensively):
 *
 *   {
 *     "id": "uuid",
 *     "content": "hello [emote:37225:EZ] world",
 *     "type": "message",            // or "reply"
 *     "created_at": "2026-07-19T12:34:56+00:00",
 *     "sender": {
 *       "username": "SomeUser",
 *       "identity": {
 *         "color": "#FF0000",
 *         "badges": [{ "type": "moderator", "text": "Moderator" },
 *                    { "type": "subscriber", "text": "Subscriber", "count": 6 }]
 *       }
 *     }
 *   }
 *
 * Emotes are inline placeholders in `content`: `[emote:<id>:<name>]`.
 * Reference: community docs/wrappers (e.g. github.com/Bukk94/KickLib) — no
 * official schema exists (EDD §3.2).
 */

/** Kick badge `type` values → contract badge kinds. */
const BADGE_KINDS: Record<string, BadgeKind> = {
	broadcaster: 'broadcaster',
	moderator: 'moderator',
	subscriber: 'subscriber',
	founder: 'subscriber',
	og: 'og',
	vip: 'vip',
	verified: 'verified'
};

interface KickBadge {
	type?: string;
	text?: string;
	count?: number;
}

interface KickChatEvent {
	id?: string;
	content?: string;
	type?: string;
	created_at?: string;
	sender?: {
		username?: string;
		identity?: {
			color?: string;
			badges?: KickBadge[];
		};
	};
}

/**
 * Kick badges → contract badges.
 *
 * In:  `[{ type: 'moderator', text: 'Moderator' }, { type: 'subscriber', text: 'Subscriber', count: 6 }]`
 * Out: `[{ kind: 'moderator', title: 'Moderator' }, { kind: 'subscriber', title: '6-month subscriber' }]`
 *
 * Unrecognized types become `kind: 'unknown'` with Kick's own text as title.
 */
function parseBadges(raw: KickBadge[] | undefined): Badge[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((badge) => typeof badge?.type === 'string')
		.map((badge) => {
			const kind = BADGE_KINDS[badge.type!] ?? 'unknown';
			const result: Badge = { kind };
			if (kind === 'subscriber' && typeof badge.count === 'number') {
				result.title = `${badge.count}-month subscriber`;
			} else if (badge.text) {
				result.title = badge.text;
			}
			return result;
		});
}

/**
 * Message text → ordered text/emote fragments.
 *
 * In:  `"gg [emote:37225:EZ] wp"`
 * Out: `[{ kind: 'text', text: 'gg ' },
 *        { kind: 'emote', name: 'EZ', url: 'https://files.kick.com/emotes/37225/fullsize' },
 *        { kind: 'text', text: ' wp' }]`
 */
function parseFragments(content: string): Fragment[] {
	const fragments: Fragment[] = [];
	const pattern = /\[emote:(\d+):([^\]]*)\]/g;
	let cursor = 0;
	for (const match of content.matchAll(pattern)) {
		if (match.index > cursor) {
			fragments.push({ kind: 'text', text: content.slice(cursor, match.index) });
		}
		fragments.push({ kind: 'emote', name: match[2] || match[1], url: KICK_EMOTE_URL(match[1]) });
		cursor = match.index + match[0].length;
	}
	if (cursor < content.length) {
		fragments.push({ kind: 'text', text: content.slice(cursor) });
	}
	return fragments;
}

/** Accepted `type` values — anything else (system events, gifts) is skipped for now. */
const MESSAGE_TYPES = new Set(['message', 'reply']);

/**
 * Whole Pusher event payload (shape above) → one contract `ChatMessage`,
 * or `undefined` when the payload is malformed or a non-chat event type.
 * Missing id/timestamp/color are synthesized (stable id, arrival time,
 * hashed hue).
 */
export function kickEventToChatMessage(
	payload: unknown,
	sourceId: string,
	channel: string
): ChatMessage | undefined {
	const event = payload as KickChatEvent | null;
	if (!event || typeof event.content !== 'string') return undefined;
	if (typeof event.type === 'string' && !MESSAGE_TYPES.has(event.type)) return undefined;

	const username = event.sender?.username;
	if (typeof username !== 'string' || !username) return undefined;

	const timestamp = event.created_at ? Date.parse(event.created_at) || Date.now() : Date.now();

	return {
		id: event.id || `kick-${channel}-${timestamp}-${username}`,
		sourceId,
		platform: 'kick',
		channel,
		timestamp,
		author: {
			name: username,
			color: event.sender?.identity?.color || hashColor(username),
			badges: parseBadges(event.sender?.identity?.badges)
		},
		fragments: parseFragments(event.content)
	};
}
