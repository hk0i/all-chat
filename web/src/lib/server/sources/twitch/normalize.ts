import type { Badge, BadgeKind, ChatMessage, Fragment } from '@all-chat/contract';
import { loginFromPrefix, type IrcLine } from './irc';

/** Twitch emote CDN — public, no auth (EDD §4.1). */
const emoteUrl = (id: string) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

const BADGE_KINDS: Record<string, BadgeKind> = {
	broadcaster: 'broadcaster',
	moderator: 'moderator',
	subscriber: 'subscriber',
	founder: 'subscriber',
	vip: 'vip',
	partner: 'verified'
};

/** Stable fallback hue for users who never set a chat color (EDD §4.1). */
export function hashColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return `hsl(${((hash % 360) + 360) % 360}, 60%, 60%)`;
}

function parseBadges(badgesTag: string | undefined, badgeInfoTag: string | undefined): Badge[] {
	if (!badgesTag) return [];
	const subMonths = badgeInfoTag
		?.split(',')
		.find((entry) => entry.startsWith('subscriber/'))
		?.slice('subscriber/'.length);

	return badgesTag
		.split(',')
		.filter(Boolean)
		.map((entry) => {
			const [set] = entry.split('/');
			const kind = BADGE_KINDS[set] ?? 'unknown';
			const badge: Badge = { kind };
			if (kind === 'subscriber' && subMonths) badge.title = `${subMonths}-month subscriber`;
			else if (kind === 'unknown') badge.title = set;
			return badge;
		});
}

/**
 * Split message text into text/emote fragments using the `emotes` tag.
 *
 * Tag format: `id:start-end,start-end/id:start-end` — emote id, then the
 * character ranges where it appears in the text. Example: for the text
 * "Kappa hi Kappa", Twitch sends `emotes=25:0-4,9-13`, meaning emote 25
 * ("Kappa") occupies characters 0-4 and 9-13; character 5-8 (" hi ") stays
 * text. https://dev.twitch.tv/docs/chat/irc/#emotes-tag
 *
 * Twitch ranges index Unicode code points, not UTF-16 units — a single
 * emoji before an emote shifts JS string indices but not Twitch's — so we
 * split to code points first.
 */
function parseFragments(text: string, emotesTag: string | undefined): Fragment[] {
	if (!emotesTag) return text ? [{ kind: 'text', text }] : [];

	const chars = [...text];
	const ranges: { start: number; end: number; id: string }[] = [];
	for (const group of emotesTag.split('/')) {
		const colon = group.indexOf(':');
		if (colon === -1) continue;
		const id = group.slice(0, colon);
		for (const span of group.slice(colon + 1).split(',')) {
			const [start, end] = span.split('-').map(Number);
			if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end < chars.length) {
				ranges.push({ start, end, id });
			}
		}
	}
	if (ranges.length === 0) return text ? [{ kind: 'text', text }] : [];
	ranges.sort((a, b) => a.start - b.start);

	const fragments: Fragment[] = [];
	let cursor = 0;
	for (const range of ranges) {
		if (range.start < cursor) continue; // overlapping/malformed range
		if (range.start > cursor) {
			fragments.push({ kind: 'text', text: chars.slice(cursor, range.start).join('') });
		}
		fragments.push({
			kind: 'emote',
			name: chars.slice(range.start, range.end + 1).join(''),
			url: emoteUrl(range.id)
		});
		cursor = range.end + 1;
	}
	if (cursor < chars.length) {
		fragments.push({ kind: 'text', text: chars.slice(cursor).join('') });
	}
	return fragments;
}

/** Normalize a parsed PRIVMSG into the wire contract. Returns undefined for non-PRIVMSG lines. */
export function privmsgToChatMessage(line: IrcLine, sourceId: string): ChatMessage | undefined {
	if (line.command !== 'PRIVMSG' || line.params.length < 2) return undefined;

	const channel = line.params[0].replace(/^#/, '');
	let text = line.params[1];

	// "/me" actions arrive as \x01ACTION <text>\x01.
	const action = /^\x01ACTION (.*)\x01$/.exec(text);
	if (action) text = action[1];

	const login = loginFromPrefix(line.prefix) ?? 'unknown';
	const name = line.tags['display-name'] || login;
	const timestamp = Number(line.tags['tmi-sent-ts']) || Date.now();

	return {
		id: line.tags.id || `twitch-${channel}-${timestamp}-${login}`,
		sourceId,
		platform: 'twitch',
		channel,
		timestamp,
		author: {
			name,
			color: line.tags.color || hashColor(login),
			badges: parseBadges(line.tags.badges, line.tags['badge-info'])
		},
		fragments: parseFragments(text, line.tags.emotes)
	};
}
