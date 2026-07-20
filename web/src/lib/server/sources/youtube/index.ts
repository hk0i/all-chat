import type { ChatMessage, SourceState } from '@all-chat/contract';
import type { ChatSource } from '../types';
import {
	GET_LIVE_CHAT_URL,
	LIVE_CHAT_PAGE_URL,
	buildPollBody,
	extractChatSession,
	parsePollResponse,
	type ChatSession
} from './innertube';
import { rendererToChatMessage } from './normalize';
import { resolveInput, YouTubeResolveError } from './resolve';

/**
 * YouTube live chat source: resolve input → extract chat session from the
 * live_chat page → poll InnerTube's get_live_chat at the server-suggested
 * interval (EDD §3.3). One poller per video; the manager's refcounting
 * fans it out to every subscribed client.
 */

/**
 * YouTube serves a ytcfg-less shell to non-browser user agents (verified
 * live) — both the page fetch and the poll need a browser-ish UA.
 */
const BROWSER_HEADERS = {
	'accept-language': 'en',
	'user-agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
};

const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60000;
/** Clamp server-suggested poll delays to a sane range. */
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 10000;

export class YouTubeSource implements ChatSource {
	private messageCb: ((message: ChatMessage) => void) | undefined;
	private statusCb: ((state: SourceState, detail?: string) => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private attempts = 0;
	private closed = false;

	constructor(
		private readonly sourceId: string,
		private readonly channel: string,
		private readonly fetchFn: typeof fetch = fetch
	) {}

	connect(): void {
		this.closed = false;
		this.statusCb?.('connecting');
		void this.start();
	}

	disconnect(): void {
		this.closed = true;
		if (this.timer !== undefined) clearTimeout(this.timer);
	}

	onMessage(cb: (message: ChatMessage) => void): void {
		this.messageCb = cb;
	}

	onStatus(cb: (state: SourceState, detail?: string) => void): void {
		this.statusCb = cb;
	}

	/** Resolve → open session → hand off to the poll loop. */
	private async start(): Promise<void> {
		let session: ChatSession | undefined;
		let videoId: string;
		try {
			videoId = await resolveInput(this.channel, this.fetchFn);
			const page = await this.fetchFn(LIVE_CHAT_PAGE_URL(videoId), { headers: BROWSER_HEADERS });
			session = extractChatSession(await page.text());
		} catch (error) {
			if (this.closed) return;
			if (error instanceof YouTubeResolveError && !error.notLive) {
				// Bad input or missing channel — retrying won't help.
				this.statusCb?.('failed', error.message);
				return;
			}
			this.retry((error as Error).message);
			return;
		}
		if (this.closed) return;
		if (!session) {
			this.retry(`no live chat found for ${videoId} (stream offline or page shape drift)`);
			return;
		}

		this.attempts = 0;
		this.statusCb?.('live');
		void this.poll(session);
	}

	/** One poll step; schedules itself with the server-suggested delay. */
	private async poll(session: ChatSession): Promise<void> {
		if (this.closed) return;
		let result;
		try {
			const response = await this.fetchFn(GET_LIVE_CHAT_URL(session.apiKey), {
				method: 'POST',
				headers: { ...BROWSER_HEADERS, 'content-type': 'application/json' },
				body: JSON.stringify(buildPollBody(session))
			});
			if (!response.ok) throw new Error(`get_live_chat returned ${response.status}`);
			result = parsePollResponse(await response.json());
		} catch (error) {
			if (!this.closed) this.retry((error as Error).message);
			return;
		}
		if (this.closed) return;

		for (const renderer of result.messageRenderers) {
			const message = rendererToChatMessage(renderer, this.sourceId, this.channel);
			if (message) this.messageCb?.(message);
		}

		if (!result.continuation) {
			// Chat ended (stream over). Re-resolve from scratch — handles the
			// channel going live again with a new video id.
			this.retry('live chat ended');
			return;
		}

		const delay = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, result.timeoutMs));
		this.timer = setTimeout(() => void this.poll({ ...session, continuation: result.continuation! }), delay);
	}

	/** Backoff and restart the whole pipeline (resolve + session + poll). */
	private retry(detail: string): void {
		this.attempts += 1;
		const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempts - 1));
		const jittered = delay / 2 + Math.random() * (delay / 2);
		this.statusCb?.('reconnecting', `${detail}; retry in ${Math.round(jittered / 1000)}s`);
		this.timer = setTimeout(() => void this.start(), jittered);
	}
}
