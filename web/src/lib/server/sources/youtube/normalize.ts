import type { Badge, ChatMessage, Fragment } from '@all-chat/contract';
import { hashColor } from '../color';

/**
 * liveChatTextMessageRenderer → contract ChatMessage.
 *
 * In:  { id: 'Cj0...', timestampUsec: '1784000000000000',
 *        authorName: { simpleText: 'Viewer' },
 *        authorPhoto: { thumbnails: [{ url: 'https://yt4.ggpht.com/...=s32...' }, { url: '...=s64...' }] },
 *        authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' } } }],
 *        message: { runs: [{ text: 'hi ' }, { emoji: { image: { thumbnails: [...] }, shortcuts: [':wave:'] } }] } }
 * Out: ChatMessage with avatarUrl (largest thumbnail), hash-derived color
 *      (YouTube has no user name colors — EDD §4.1), badges, and ordered
 *      text/emote fragments.
 *
 * Returns undefined when required fields are missing (shape drift guard).
 */

interface Thumbnail {
	url?: string;
	width?: number;
}

interface YtRun {
	text?: string;
	emoji?: {
		emojiId?: string;
		shortcuts?: string[];
		searchTerms?: string[];
		image?: { thumbnails?: Thumbnail[] };
		isCustomEmoji?: boolean;
	};
}

interface YtTextMessageRenderer {
	id?: string;
	timestampUsec?: string;
	authorName?: { simpleText?: string };
	authorPhoto?: { thumbnails?: Thumbnail[] };
	authorBadges?: {
		liveChatAuthorBadgeRenderer?: {
			icon?: { iconType?: string };
			customThumbnail?: { thumbnails?: Thumbnail[] };
			tooltip?: string;
		};
	}[];
	message?: { runs?: YtRun[] };
}

/** Largest thumbnail URL, or undefined. */
function pickThumbnail(thumbnails: Thumbnail[] | undefined): string | undefined {
	if (!thumbnails?.length) return undefined;
	return [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
}

/**
 * YouTube badge icons → contract badges. OWNER = the channel itself;
 * custom thumbnails without an iconType are channel-member badges.
 */
function parseBadges(renderer: YtTextMessageRenderer): Badge[] {
	const badges: Badge[] = [];
	for (const entry of renderer.authorBadges ?? []) {
		const badge = entry?.liveChatAuthorBadgeRenderer;
		if (!badge) continue;
		const icon = badge.icon?.iconType;
		if (icon === 'OWNER') badges.push({ kind: 'broadcaster' });
		else if (icon === 'MODERATOR') badges.push({ kind: 'moderator' });
		else if (icon === 'VERIFIED') badges.push({ kind: 'verified' });
		else if (badge.customThumbnail) badges.push({ kind: 'member', title: badge.tooltip });
		else badges.push({ kind: 'unknown', title: badge.tooltip ?? icon });
	}
	return badges;
}

/** message.runs → ordered text/emote fragments. Standard unicode emoji stay text. */
function parseFragments(runs: YtRun[] | undefined): Fragment[] {
	const fragments: Fragment[] = [];
	for (const run of runs ?? []) {
		if (typeof run.text === 'string') {
			fragments.push({ kind: 'text', text: run.text });
			continue;
		}
		const emoji = run.emoji;
		if (!emoji) continue;
		const url = pickThumbnail(emoji.image?.thumbnails);
		const name = emoji.shortcuts?.[0] ?? emoji.searchTerms?.[0] ?? emoji.emojiId ?? 'emoji';
		if (emoji.isCustomEmoji && url) {
			fragments.push({ kind: 'emote', name, url });
		} else {
			// Plain unicode emoji — emojiId is the character itself.
			fragments.push({ kind: 'text', text: emoji.emojiId ?? name });
		}
	}
	return fragments;
}

export function rendererToChatMessage(
	payload: unknown,
	sourceId: string,
	channel: string
): ChatMessage | undefined {
	const renderer = payload as YtTextMessageRenderer | null;
	const name = renderer?.authorName?.simpleText;
	if (!renderer || !name) return undefined;

	const timestamp = renderer.timestampUsec
		? Math.floor(Number(renderer.timestampUsec) / 1000) || Date.now()
		: Date.now();

	return {
		id: renderer.id || `youtube-${channel}-${timestamp}-${name}`,
		sourceId,
		platform: 'youtube',
		channel,
		timestamp,
		author: {
			name,
			color: hashColor(name),
			...(pickThumbnail(renderer.authorPhoto?.thumbnails)
				? { avatarUrl: pickThumbnail(renderer.authorPhoto?.thumbnails) }
				: {}),
			badges: parseBadges(renderer)
		},
		fragments: parseFragments(renderer.message?.runs)
	};
}
