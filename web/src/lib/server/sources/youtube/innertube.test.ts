import { describe, expect, it } from 'vitest';
import { buildPollBody, extractChatSession, parsePollResponse } from './innertube';
import { rendererToChatMessage } from './normalize';
import { hashColor } from '../color';

const PAGE_HTML = [
	'<html><script>',
	'ytcfg.set({"INNERTUBE_API_KEY":"AIzaTestKey123","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260719.01.00"});',
	'</script><script>',
	'window["ytInitialData"] = {"contents":{"liveChatRenderer":{"continuations":[{"timedContinuationData":{"continuation":"0ofMyANFirstToken"}}]}}};',
	'</script></html>'
].join('');

/** Recorded-shape renderer (fields trimmed to the ones we consume). */
const TEXT_RENDERER = {
	id: 'yt-msg-1',
	timestampUsec: '1784000000000000',
	authorName: { simpleText: 'YtViewer' },
	authorPhoto: {
		thumbnails: [
			{ url: 'https://yt4.ggpht.com/photo=s32', width: 32 },
			{ url: 'https://yt4.ggpht.com/photo=s64', width: 64 }
		]
	},
	authorBadges: [
		{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' }, tooltip: 'Moderator' } },
		{
			liveChatAuthorBadgeRenderer: {
				customThumbnail: { thumbnails: [{ url: 'https://badge' }] },
				tooltip: 'Member (6 months)'
			}
		}
	],
	message: {
		runs: [
			{ text: 'nice ' },
			{
				emoji: {
					emojiId: 'UC/custom123',
					shortcuts: [':catjam:'],
					isCustomEmoji: true,
					image: { thumbnails: [{ url: 'https://yt3.ggpht.com/catjam=s48', width: 48 }] }
				}
			},
			{ emoji: { emojiId: '🎉' } }
		]
	}
};

const POLL_RESPONSE = {
	continuationContents: {
		liveChatContinuation: {
			continuations: [
				{ invalidationContinuationData: { continuation: 'nextToken456', timeoutMs: 4200 } }
			],
			actions: [
				{ addChatItemAction: { item: { liveChatTextMessageRenderer: TEXT_RENDERER } } },
				{ addChatItemAction: { item: { liveChatTickerSentinel: {} } } },
				{ markChatItemAsDeletedAction: {} }
			]
		}
	}
};

describe('extractChatSession', () => {
	it('pulls api key, client version, and first continuation from page HTML', () => {
		expect(extractChatSession(PAGE_HTML)).toEqual({
			apiKey: 'AIzaTestKey123',
			clientVersion: '2.20260719.01.00',
			continuation: '0ofMyANFirstToken'
		});
	});

	it('returns undefined when pieces are missing (not live / drift)', () => {
		expect(extractChatSession('<html>consent wall</html>')).toBeUndefined();
	});
});

describe('buildPollBody', () => {
	it('shapes the WEB client context and continuation', () => {
		expect(buildPollBody({ apiKey: 'k', clientVersion: 'v1', continuation: 'tok' })).toEqual({
			context: { client: { clientName: 'WEB', clientVersion: 'v1' } },
			continuation: 'tok'
		});
	});
});

describe('parsePollResponse', () => {
	it('extracts text renderers, next continuation, and timeout', () => {
		const result = parsePollResponse(POLL_RESPONSE);
		expect(result.messageRenderers).toEqual([TEXT_RENDERER]);
		expect(result.continuation).toBe('nextToken456');
		expect(result.timeoutMs).toBe(4200);
	});

	it('handles ended chats (no continuation) and junk', () => {
		expect(parsePollResponse({}).continuation).toBeUndefined();
		expect(parsePollResponse(null).messageRenderers).toEqual([]);
	});
});

describe('rendererToChatMessage', () => {
	it('normalizes with avatar, badges, and mixed fragments', () => {
		const message = rendererToChatMessage(TEXT_RENDERER, 'src-y', 'VAlMDl00mYY');
		expect(message).toMatchObject({
			id: 'yt-msg-1',
			platform: 'youtube',
			channel: 'VAlMDl00mYY',
			timestamp: 1784000000000,
			author: {
				name: 'YtViewer',
				color: hashColor('YtViewer'),
				avatarUrl: 'https://yt4.ggpht.com/photo=s64'
			}
		});
		expect(message?.author.badges).toEqual([
			{ kind: 'moderator' },
			{ kind: 'member', title: 'Member (6 months)' }
		]);
		expect(message?.fragments).toEqual([
			{ kind: 'text', text: 'nice ' },
			{ kind: 'emote', name: ':catjam:', url: 'https://yt3.ggpht.com/catjam=s48' },
			{ kind: 'text', text: '🎉' }
		]);
	});

	it('rejects renderers without an author', () => {
		expect(rendererToChatMessage({ id: 'x' }, 's', 'c')).toBeUndefined();
	});
});
