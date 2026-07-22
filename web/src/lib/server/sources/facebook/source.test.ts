import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformConnectionRecord } from '../../auth/config';

const { getPlatformConnection } = vi.hoisted(() => ({ getPlatformConnection: vi.fn() }));
vi.mock('../../auth/config', () => ({ getPlatformConnection }));

const { FacebookSource } = await import('./index');

const CONNECTION: PlatformConnectionRecord = {
	id: 'conn-1',
	platform: 'facebook',
	accountLabel: 'My Streaming Page',
	connectedAt: 1784000000000,
	accessToken: 'page-token',
	facebookPageId: '111'
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const liveVideos = (entries: { id: string; status: string }[]) => json({ data: entries });
const comments = (entries: { id: string; from?: { id: string; name: string }; message: string; created_time: string }[]) =>
	json({ data: entries });

describe('FacebookSource', () => {
	let statuses: { state: string; detail?: string }[];
	let messages: string[];

	const newSource = (fetchFn: typeof fetch) => {
		const source = new FacebookSource('src-f', 'conn-1', fetchFn);
		source.onStatus((state, detail) => statuses.push({ state, detail }));
		source.onMessage((message) => messages.push(message.id));
		return source;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		statuses = [];
		messages = [];
		getPlatformConnection.mockReset();
		getPlatformConnection.mockResolvedValue(CONNECTION);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('finds the live video, goes live, and emits polled comments', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(liveVideos([{ id: 'v1', status: 'LIVE' }]))
			.mockResolvedValueOnce(
				comments([{ id: 'c1', from: { id: 'u1', name: 'Fan' }, message: 'hi', created_time: '2026-07-21T10:00:00+0000' }])
			)
			.mockResolvedValueOnce(comments([]));

		const source = newSource(fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);

		expect(statuses.map((s) => s.state)).toEqual(['connecting', 'live']);
		expect(messages).toEqual(['c1']);
		source.disconnect();
	});

	it('retries with backoff when the page has no live video', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(liveVideos([]))
			.mockResolvedValueOnce(liveVideos([{ id: 'v1', status: 'LIVE' }]))
			.mockResolvedValueOnce(comments([]));

		const source = newSource(fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)?.state).toBe('reconnecting');
		expect(statuses.at(-1)?.detail).toContain('no live video');

		await vi.advanceTimersByTimeAsync(2000);
		expect(statuses.at(-1)?.state).toBe('live');
		source.disconnect();
	});

	it('fails permanently when the connection is missing (revoked)', async () => {
		getPlatformConnection.mockResolvedValue(undefined);
		const source = newSource(vi.fn() as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)?.state).toBe('failed');
	});

	it('deduplicates same-second comments across polls using since + seen ids', async () => {
		// Pins "now" (which primes lastCommentSec on go-live) to the same
		// second as the mocked comments below, so the since-boundary dedup
		// path is actually exercised instead of every comment looking newer
		// than the priming timestamp.
		vi.setSystemTime(new Date('2026-07-21T10:00:00.500Z'));
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(liveVideos([{ id: 'v1', status: 'LIVE' }]))
			.mockResolvedValueOnce(
				comments([{ id: 'c1', from: { id: 'u1', name: 'Fan' }, message: 'hi', created_time: '2026-07-21T10:00:00+0000' }])
			)
			// Same second re-offered (Graph API `since` is second-granularity) plus one genuinely new comment.
			.mockResolvedValueOnce(
				comments([
					{ id: 'c1', from: { id: 'u1', name: 'Fan' }, message: 'hi', created_time: '2026-07-21T10:00:00+0000' },
					{ id: 'c2', from: { id: 'u2', name: 'Other' }, message: 'yo', created_time: '2026-07-21T10:00:00+0000' }
				])
			)
			.mockResolvedValueOnce(comments([]));

		const source = newSource(fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		expect(messages).toEqual(['c1']);

		await vi.advanceTimersByTimeAsync(3000);
		expect(messages).toEqual(['c1', 'c2']);
		source.disconnect();
	});

	it('stops polling after disconnect()', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(liveVideos([{ id: 'v1', status: 'LIVE' }]))
			.mockResolvedValue(comments([]));

		const source = newSource(fetchFn as typeof fetch);
		source.connect();
		await vi.advanceTimersByTimeAsync(0);
		const callsBefore = fetchFn.mock.calls.length;
		source.disconnect();
		await vi.advanceTimersByTimeAsync(30000);
		expect(fetchFn.mock.calls.length).toBe(callsBefore);
	});
});
