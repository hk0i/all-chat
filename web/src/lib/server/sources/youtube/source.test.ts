import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YouTubeSource } from './index';

const VIDEO_ID = 'dQw4w9WgXcQ';

const PAGE_HTML =
	'"INNERTUBE_API_KEY":"key1" "INNERTUBE_CONTEXT_CLIENT_VERSION":"2.0" "continuation":"tok1"';

const renderer = (id: string, text: string) => ({
	id,
	timestampUsec: '1784000000000000',
	authorName: { simpleText: 'YtViewer' },
	message: { runs: [{ text }] }
});

const pollResponse = (messages: { id: string; text: string }[], continuation?: string, timeoutMs = 2000) => ({
	continuationContents: {
		liveChatContinuation: {
			...(continuation
				? { continuations: [{ timedContinuationData: { continuation, timeoutMs } }] }
				: {}),
			actions: messages.map((m) => ({
				addChatItemAction: { item: { liveChatTextMessageRenderer: renderer(m.id, m.text) } }
			}))
		}
	}
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const html = (body: string) => new Response(body, { status: 200 });

describe('YouTubeSource', () => {
	let statuses: { state: string; detail?: string }[];
	let messages: string[];

	const newSource = (channel: string, fetchFn: typeof fetch) => {
		const source = new YouTubeSource('src-y', channel, fetchFn);
		source.onStatus((state, detail) => statuses.push({ state, detail }));
		source.onMessage((message) => messages.push(message.id));
		return source;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		statuses = [];
		messages = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('resolves, opens a session, goes live, and emits polled messages', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(html(PAGE_HTML)) // live_chat page (video id input skips resolve fetch)
			.mockResolvedValueOnce(json(pollResponse([{ id: 'm1', text: 'hi' }], 'tok2')))
			.mockResolvedValueOnce(json(pollResponse([{ id: 'm2', text: 'yo' }], 'tok3')));

		const source = newSource(VIDEO_ID, fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.map((s) => s.state)).toEqual(['connecting', 'live']);
		expect(messages).toEqual(['m1']);

		await vi.advanceTimersByTimeAsync(2000);
		expect(messages).toEqual(['m1', 'm2']);
		source.disconnect();
	});

	it('sends a browser user-agent on the page fetch', async () => {
		const fetchFn = vi.fn().mockResolvedValue(html(PAGE_HTML));
		const source = newSource(VIDEO_ID, fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers['user-agent']).toContain('Mozilla');
		source.disconnect();
	});

	it('retries with backoff when the page has no chat session', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(html('<html>offline shell</html>'))
			.mockResolvedValueOnce(html(PAGE_HTML))
			.mockResolvedValueOnce(json(pollResponse([], 'tokN')));

		const source = newSource(VIDEO_ID, fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)?.state).toBe('reconnecting');

		await vi.advanceTimersByTimeAsync(2000);
		expect(statuses.at(-1)?.state).toBe('live');
		source.disconnect();
	});

	it('re-resolves from scratch when the chat ends (no continuation)', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(html(PAGE_HTML))
			.mockResolvedValueOnce(json(pollResponse([{ id: 'last', text: 'gg' }]))) // no continuation
			.mockResolvedValue(html(PAGE_HTML));

		const source = newSource(VIDEO_ID, fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(messages).toEqual(['last']);
		expect(statuses.at(-1)?.state).toBe('reconnecting');
		expect(statuses.at(-1)?.detail).toContain('ended');
		source.disconnect();
	});

	it('fails permanently on unresolvable input', async () => {
		const source = newSource('%%%junk%%%', vi.fn() as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)?.state).toBe('failed');
	});

	it('stops polling after disconnect()', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(html(PAGE_HTML))
			.mockResolvedValue(json(pollResponse([], 'tokN')));

		const source = newSource(VIDEO_ID, fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		const callsBefore = fetchFn.mock.calls.length;
		source.disconnect();
		await vi.advanceTimersByTimeAsync(30000);
		expect(fetchFn.mock.calls.length).toBe(callsBefore);
	});
});
