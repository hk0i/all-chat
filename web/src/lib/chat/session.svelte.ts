import type { ChatMessage, ChatSendResult, StatusEvent } from '@all-chat/contract';
import { openChatStream } from '$lib/stream';

const MAX_MESSAGES = 1000;

/** How close to the bottom (px) still counts as "at the bottom". */
const STICK_THRESHOLD_PX = 40;

/**
 * One chat session: SSE connection, message buffering/eviction, scroll
 * pinning, and message sending. A factory rather than a singleton — dock
 * and overlay routes each get their own independent session even when
 * pointed at the same profile.
 */
export function createChatSession() {
	let messages = $state<ChatMessage[]>([]);
	let statuses = $state<Record<string, StatusEvent>>({});
	let connected = $state(false);
	/** Set when the stream connection fails permanently (see stream.ts onError). */
	let streamError = $state<string | undefined>();

	let feedElement = $state<HTMLUListElement | undefined>();
	/** False once the user scrolls up; new messages then pause instead of yanking the view. */
	let stickToBottom = $state(true);
	let missedCount = $state(0);

	/**
	 * Seconds a message stays before it's evicted from the feed, set via
	 * `startFadeSweep`. `undefined` disables eviction.
	 */
	let fadeSeconds = $state<number | undefined>();
	/** message id → receipt time (ms); drives the fade-eviction sweep. */
	const receivedAt = new Map<string, number>();
	let fadeSweepHandle: ReturnType<typeof setInterval> | undefined;

	let sending = $state(false);
	let sendResults = $state<ChatSendResult[] | undefined>();
	let sendError = $state<string | undefined>();

	/**
	 * Incoming SSE messages land here first, not directly in `messages` —
	 * a busy channel (10k+ msg/min, EDD §7) firing one Svelte state update
	 * per message would re-render the list that often. Buffered and flushed
	 * once per animation frame instead, so render rate tracks the display's
	 * refresh rate, not the chat's.
	 */
	let messageBuffer: ChatMessage[] = [];
	let flushHandle: number | undefined;
	let closeStreamHandle: (() => void) | undefined;

	function scheduleFlush() {
		if (flushHandle !== undefined) return;
		flushHandle = requestAnimationFrame(flushMessages);
	}

	function flushMessages() {
		flushHandle = undefined;
		if (messageBuffer.length === 0) return;
		const incoming = messageBuffer;
		messageBuffer = [];
		const now = Date.now();
		for (const message of incoming) receivedAt.set(message.id, now);
		messages = [...messages, ...incoming].slice(-MAX_MESSAGES);
		if (!stickToBottom) missedCount += incoming.length;
	}

	/** Evicts messages older than `fadeSeconds`; the `out:fade` transition animates their removal. */
	function sweepExpired() {
		if (fadeSeconds === undefined) return;
		const cutoff = Date.now() - fadeSeconds * 1000;
		const next = messages.filter((message) => (receivedAt.get(message.id) ?? 0) > cutoff);
		if (next.length === messages.length) return;
		messages = next;
		const keep = new Set(next.map((message) => message.id));
		for (const id of receivedAt.keys()) if (!keep.has(id)) receivedAt.delete(id);
	}

	/** (Re)configures fade eviction — `undefined` disables it. */
	function startFadeSweep(seconds: number | undefined) {
		fadeSeconds = seconds;
		if (fadeSweepHandle !== undefined) {
			clearInterval(fadeSweepHandle);
			fadeSweepHandle = undefined;
		}
		if (fadeSeconds !== undefined) fadeSweepHandle = setInterval(sweepExpired, 1000);
	}

	function onFeedScroll() {
		if (!feedElement) return;
		const distanceFromBottom =
			feedElement.scrollHeight - feedElement.scrollTop - feedElement.clientHeight;
		const atBottom = distanceFromBottom <= STICK_THRESHOLD_PX;
		if (atBottom && !stickToBottom) missedCount = 0;
		stickToBottom = atBottom;
	}

	function resumeScroll() {
		stickToBottom = true;
		missedCount = 0;
		scrollToBottom();
	}

	function scrollToBottom() {
		if (feedElement) feedElement.scrollTop = feedElement.scrollHeight;
	}

	// Keep pinned to the newest message unless the user scrolled up.
	$effect(() => {
		void messages.length;
		if (stickToBottom) scrollToBottom();
	});

	/** Clears message/status state without touching the stream connection. */
	function resetMessages() {
		messages = [];
		statuses = {};
		connected = false;
		streamError = undefined;
		messageBuffer = [];
		receivedAt.clear();
	}

	function closeStream() {
		closeStreamHandle?.();
		closeStreamHandle = undefined;
	}

	function connectStream(streamParams: URLSearchParams) {
		closeStreamHandle?.();
		closeStreamHandle = openChatStream(streamParams.toString(), {
			onHello: () => (connected = true),
			onMessage: (message) => {
				messageBuffer.push(message);
				scheduleFlush();
			},
			onStatus: (status) => {
				statuses = { ...statuses, [status.sourceId]: status };
			},
			onError: (message) => {
				connected = false;
				streamError = message;
			}
		});
	}

	async function sendMessage(text: string, profileId: string) {
		if (!text || sending) return;
		sending = true;
		sendResults = undefined;
		sendError = undefined;
		try {
			const response = await fetch('/api/chat/send', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ profileId, text })
			});
			if (!response.ok) {
				sendError = ((await response.json()) as { message?: string }).message ?? response.statusText;
				return;
			}
			const body = (await response.json()) as { results: ChatSendResult[] };
			sendResults = body.results;
		} catch (cause) {
			sendError = (cause as Error).message;
		} finally {
			sending = false;
		}
	}

	function dispose() {
		closeStreamHandle?.();
		if (flushHandle !== undefined) cancelAnimationFrame(flushHandle);
		if (fadeSweepHandle !== undefined) clearInterval(fadeSweepHandle);
	}

	return {
		get messages() {
			return messages;
		},
		get statuses() {
			return statuses;
		},
		get connected() {
			return connected;
		},
		get streamError() {
			return streamError;
		},
		get feedElement() {
			return feedElement;
		},
		set feedElement(value: HTMLUListElement | undefined) {
			feedElement = value;
		},
		get stickToBottom() {
			return stickToBottom;
		},
		get missedCount() {
			return missedCount;
		},
		get fadeSeconds() {
			return fadeSeconds;
		},
		get sending() {
			return sending;
		},
		get sendResults() {
			return sendResults;
		},
		get sendError() {
			return sendError;
		},
		startFadeSweep,
		onFeedScroll,
		resumeScroll,
		scrollToBottom,
		connectStream,
		closeStream,
		resetMessages,
		sendMessage,
		dispose
	};
}

export type ChatSession = ReturnType<typeof createChatSession>;
