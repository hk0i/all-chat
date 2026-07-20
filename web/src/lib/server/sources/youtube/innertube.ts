/**
 * InnerTube live-chat protocol helpers (EDD §3.3) — the same private API
 * youtube.com's own chat frame uses. No API key quota; the "key" below is a
 * public value embedded in every YouTube page.
 *
 * Flow: fetch `youtube.com/live_chat?v=<videoId>` once → extract session
 * (api key, client version, first continuation token) → POST
 * `youtubei/v1/live_chat/get_live_chat` in a loop, each response carrying
 * the next continuation token, a suggested poll delay, and chat actions.
 *
 * References: no official docs — shape mirrors community implementations
 * (chat-downloader, YTLiveChat) and live captures. Fixture-tested; drift
 * shows up as parse failures surfaced via source status (EDD §7).
 */

/** One chat session's parameters, extracted from the live_chat page HTML. */
export interface ChatSession {
	apiKey: string;
	clientVersion: string;
	continuation: string;
}

/**
 * Live_chat page HTML → ChatSession.
 *
 * In:  full HTML containing `"INNERTUBE_API_KEY":"AIza..."`,
 *      `"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.2026..."`, and a
 *      `"continuation":"0ofMyAN..."` inside the liveChatRenderer.
 * Out: { apiKey, clientVersion, continuation } — or undefined when any
 *      piece is missing (video not live, consent wall, layout drift).
 */
export function extractChatSession(html: string): ChatSession | undefined {
	const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
	const clientVersion = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
	// First continuation token in the page — lives inside the
	// liveChatRenderer's continuations array.
	const continuation = /"continuation":"([^"]+)"/.exec(html)?.[1];
	if (!apiKey || !clientVersion || !continuation) return undefined;
	return { apiKey, clientVersion, continuation };
}

export const LIVE_CHAT_PAGE_URL = (videoId: string) =>
	`https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}`;

export const GET_LIVE_CHAT_URL = (apiKey: string) =>
	`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(apiKey)}&prettyPrint=false`;

/** Request body for one get_live_chat poll. */
export function buildPollBody(session: ChatSession): unknown {
	return {
		context: { client: { clientName: 'WEB', clientVersion: session.clientVersion } },
		continuation: session.continuation
	};
}

/** Parsed result of one poll: raw message renderers + how/when to poll next. */
export interface PollResult {
	/** Raw liveChatTextMessageRenderer objects, in order. */
	messageRenderers: unknown[];
	/** Continuation token for the next poll; undefined = chat ended. */
	continuation?: string;
	/** Server-suggested delay before the next poll (ms). */
	timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * get_live_chat response JSON → PollResult.
 *
 * In:  { continuationContents: { liveChatContinuation: {
 *          continuations: [{ timedContinuationData: { continuation, timeoutMs } }],
 *          actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {...} } } }] } } }
 * Out: { messageRenderers: [renderer], continuation, timeoutMs }
 *
 * Non-text actions (ticker updates, deletions, memberships) are skipped.
 */
export function parsePollResponse(body: unknown): PollResult {
	const root = body as {
		continuationContents?: {
			liveChatContinuation?: {
				continuations?: Record<string, { continuation?: string; timeoutMs?: number }>[];
				actions?: {
					addChatItemAction?: { item?: { liveChatTextMessageRenderer?: unknown } };
				}[];
			};
		};
	} | null;

	const chat = root?.continuationContents?.liveChatContinuation;
	const messageRenderers: unknown[] = [];
	for (const action of chat?.actions ?? []) {
		const renderer = action?.addChatItemAction?.item?.liveChatTextMessageRenderer;
		if (renderer) messageRenderers.push(renderer);
	}

	// The continuation arrives under one of several wrapper names
	// (timedContinuationData, invalidationContinuationData, ...); take the
	// first wrapper that carries a token.
	let continuation: string | undefined;
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	for (const entry of chat?.continuations ?? []) {
		for (const wrapper of Object.values(entry)) {
			if (wrapper?.continuation) {
				continuation = wrapper.continuation;
				if (typeof wrapper.timeoutMs === 'number') timeoutMs = wrapper.timeoutMs;
				break;
			}
		}
		if (continuation) break;
	}

	return { messageRenderers, continuation, timeoutMs };
}
