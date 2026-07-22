import type { ChatMessage, SourceState } from '@all-chat/contract';
import type { ChatSource } from '../types';
import { getPlatformConnection } from '../../auth/config';
import { GRAPH_API_VERSION } from '../../auth/facebookOAuth';
import { commentToChatMessage, type FacebookComment } from './normalize';

const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60000;
const COMMENT_POLL_MS = 3000;

interface LiveVideosResponse {
	data: { id: string; status: string }[];
}

interface CommentsResponse {
	data: FacebookComment[];
}

/**
 * Facebook Page Live Video chat source (EDD-V2 §4). Unlike Twitch/Kick/
 * YouTube there's no anonymous read path — every poll goes through the
 * connected Page's own access token (`connectionId` → `PlatformConnectionRecord`,
 * EDD-V2 §3). Same overall shape as YouTubeSource: resolve (find the Page's
 * current live video) → poll, with exponential backoff restarting the whole
 * pipeline from resolve on any failure, since a poll error and "the stream
 * ended" look identical from here.
 */
export class FacebookSource implements ChatSource {
	private messageCb: ((message: ChatMessage) => void) | undefined;
	private statusCb: ((state: SourceState, detail?: string) => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private attempts = 0;
	private closed = false;
	/** Epoch seconds of the newest comment delivered so far; comments edge polling uses it as `since`. */
	private lastCommentSec: number | undefined;
	/** Comment ids already delivered at `lastCommentSec` — created_time is second-granularity, so `since` alone can re-offer same-second comments. */
	private seenAtLastSec = new Set<string>();

	constructor(
		private readonly sourceId: string,
		private readonly connectionId: string,
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

	/** Resolve the connection's Page token → find its current live video → hand off to the poll loop. */
	private async start(): Promise<void> {
		const connection = await getPlatformConnection(this.connectionId);
		if (!connection || !connection.facebookPageId) {
			// Revoked or predates the facebookPageId field — retrying won't help.
			this.statusCb?.('failed', 'Facebook connection not found — reconnect this Page in admin');
			return;
		}

		let videoId: string | undefined;
		try {
			videoId = await this.findLiveVideoId(connection.facebookPageId, connection.accessToken);
		} catch (error) {
			if (this.closed) return;
			this.retry((error as Error).message);
			return;
		}
		if (this.closed) return;

		if (!videoId) {
			this.retry(`no live video on "${connection.accountLabel}" right now`);
			return;
		}

		this.attempts = 0;
		this.lastCommentSec = Math.floor(Date.now() / 1000);
		this.seenAtLastSec = new Set();
		this.statusCb?.('live');
		void this.poll(videoId, connection.accessToken, connection.accountLabel);
	}

	private async findLiveVideoId(pageId: string, pageAccessToken: string): Promise<string | undefined> {
		const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/live_videos`);
		url.searchParams.set('fields', 'id,status');
		url.searchParams.set('access_token', pageAccessToken);

		const response = await this.fetchFn(url);
		if (!response.ok) throw new Error(`live_videos returned ${response.status}`);
		const body = (await response.json()) as LiveVideosResponse;
		return body.data.find((video) => video.status === 'LIVE')?.id;
	}

	/** One poll step; schedules itself at a fixed interval (Graph API has no server-suggested delay like YouTube's). */
	private async poll(videoId: string, pageAccessToken: string, channel: string): Promise<void> {
		if (this.closed) return;
		let comments: FacebookComment[];
		try {
			const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${videoId}/comments`);
			url.searchParams.set('fields', 'id,from,message,created_time');
			url.searchParams.set('order', 'chronological');
			url.searchParams.set('since', String(this.lastCommentSec));
			url.searchParams.set('access_token', pageAccessToken);

			const response = await this.fetchFn(url);
			if (!response.ok) throw new Error(`comments returned ${response.status}`);
			comments = ((await response.json()) as CommentsResponse).data;
		} catch (error) {
			// Could be the stream ending, the Page's token rotating, or a
			// transient error — all look alike here, so re-resolve from scratch.
			if (!this.closed) this.retry((error as Error).message);
			return;
		}
		if (this.closed) return;

		for (const comment of comments) {
			const createdSec = Math.floor(new Date(comment.created_time).getTime() / 1000) || this.lastCommentSec!;
			if (createdSec === this.lastCommentSec && this.seenAtLastSec.has(comment.id)) continue;

			this.messageCb?.(commentToChatMessage(comment, this.sourceId, channel));

			if (this.lastCommentSec === undefined || createdSec > this.lastCommentSec) {
				this.lastCommentSec = createdSec;
				this.seenAtLastSec = new Set();
			}
			this.seenAtLastSec.add(comment.id);
		}

		this.timer = setTimeout(() => void this.poll(videoId, pageAccessToken, channel), COMMENT_POLL_MS);
	}

	/** Backoff and restart the whole pipeline (resolve connection + find live video + poll). */
	private retry(detail: string): void {
		this.attempts += 1;
		const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempts - 1));
		const jittered = delay / 2 + Math.random() * (delay / 2);
		this.statusCb?.('reconnecting', `${detail}; retry in ${Math.round(jittered / 1000)}s`);
		this.timer = setTimeout(() => void this.start(), jittered);
	}
}
