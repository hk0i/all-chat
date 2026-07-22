import type { ChatMessage } from '@all-chat/contract';
import { hashColor } from '../color';

/** Shape of one entry from the `/{live-video-id}/comments` edge (fields=id,from,message,created_time). */
export interface FacebookComment {
	id: string;
	from?: { id: string; name: string };
	message: string;
	created_time: string;
}

/**
 * Normalize a Graph API comment into the wire contract. Facebook's Live
 * Video comments are plain text — no emote/badge data on this edge, unlike
 * Twitch/YouTube — so fragments is always a single text run.
 */
export function commentToChatMessage(comment: FacebookComment, sourceId: string, channel: string): ChatMessage {
	const name = comment.from?.name ?? 'unknown';
	return {
		id: comment.id,
		sourceId,
		platform: 'facebook',
		channel,
		timestamp: new Date(comment.created_time).getTime() || Date.now(),
		author: {
			name,
			color: hashColor(comment.from?.id ?? name),
			badges: []
		},
		fragments: comment.message ? [{ kind: 'text', text: comment.message }] : []
	};
}
