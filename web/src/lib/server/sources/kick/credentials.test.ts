import { describe, expect, it, vi } from 'vitest';
import { KICK_PUSHER_FALLBACK_HOST, KICK_REALTIME_CONNECTION_API } from './constants';
import { KickCredentialStore, fetchPusherCredentials, type PusherCredentials } from './credentials';

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const pusherAnswer = (credentials: Record<string, unknown> = { app_key: 'testkey1', cluster: 'us2' }) => ({
	data: { connections: [{ provider: 'pusher', credentials }], mode: 'websocket' },
	message: 'success'
});

describe('fetchPusherCredentials', () => {
	it('returns the key and cluster host for a valid answer', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, pusherAnswer()));
		expect(await fetchPusherCredentials(fetchFn)).toEqual({
			appKey: 'testkey1',
			host: 'ws-us2.pusher.com',
			origin: 'kick'
		});
	});

	it('posts a Pusher-only offer from a web client', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, pusherAnswer()));
		await fetchPusherCredentials(fetchFn);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe(KICK_REALTIME_CONNECTION_API);
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body);
		expect(body.capabilities.accepted_providers).toEqual([{ provider: 'pusher' }]);
		expect(body.client.type).toBe('web');
	});

	it('throws on a non-200 status', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
		await expect(fetchPusherCredentials(fetchFn)).rejects.toThrow('status 503');
	});

	it('throws when the answer holds only a centrifugo connection', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse(200, { data: { connections: [{ provider: 'centrifugo', credentials: {} }] } })
		);
		await expect(fetchPusherCredentials(fetchFn)).rejects.toThrow('no usable pusher credentials');
	});

	it('throws when the cluster is not a bare label', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(jsonResponse(200, pusherAnswer({ app_key: 'testkey1', cluster: 'us2.evil.example/x' })));
		await expect(fetchPusherCredentials(fetchFn)).rejects.toThrow('no usable pusher credentials');
	});

	it('throws when data is missing', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { message: 'success' }));
		await expect(fetchPusherCredentials(fetchFn)).rejects.toThrow('no usable pusher credentials');
	});
});

const HOUR_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const FRESH_MS = 60 * 1000;

const kickAnswer = (appKey: string): PusherCredentials => ({
	appKey,
	host: 'ws-test.pusher.com',
	origin: 'kick'
});

function newStore(env: Record<string, string | undefined> = {}) {
	let clock = 1_000_000;
	const fetchCredentials = vi.fn<() => Promise<PusherCredentials>>().mockResolvedValue(kickAnswer('kick-key'));
	const report = vi.fn();
	const store = new KickCredentialStore({ fetchCredentials, env, now: () => clock, report });
	return {
		store,
		fetchCredentials,
		report,
		advance: (ms: number) => {
			clock += ms;
		}
	};
}

describe('KickCredentialStore', () => {
	it('returns the env key without fetching', async () => {
		const { store, fetchCredentials } = newStore({ KICK_PUSHER_KEY: 'env-key', KICK_PUSHER_HOST: 'ws-env.pusher.com' });
		expect(await store.current()).toEqual({ appKey: 'env-key', host: 'ws-env.pusher.com', origin: 'env' });
		expect(fetchCredentials).not.toHaveBeenCalled();
	});

	it('uses the fallback host when only the env key is set', async () => {
		const { store } = newStore({ KICK_PUSHER_KEY: 'env-key' });
		expect((await store.current()).host).toBe(KICK_PUSHER_FALLBACK_HOST);
	});

	it('ignores an env host without an env key', async () => {
		const { store, fetchCredentials } = newStore({ KICK_PUSHER_HOST: 'ws-env.pusher.com' });
		expect((await store.current()).origin).toBe('kick');
		expect(fetchCredentials).toHaveBeenCalledTimes(1);
	});

	it('fetches once and reuses the answer within an hour', async () => {
		const { store, fetchCredentials, advance } = newStore();
		await store.current();
		advance(HOUR_MS - 1);
		expect((await store.current()).appKey).toBe('kick-key');
		expect(fetchCredentials).toHaveBeenCalledTimes(1);
	});

	it('fetches again after an hour', async () => {
		const { store, fetchCredentials, advance } = newStore();
		await store.current();
		advance(HOUR_MS);
		await store.current();
		expect(fetchCredentials).toHaveBeenCalledTimes(2);
	});

	it('shares one fetch between concurrent callers', async () => {
		const { store, fetchCredentials } = newStore();
		await Promise.all([store.current(), store.current()]);
		expect(fetchCredentials).toHaveBeenCalledTimes(1);
	});

	it('falls back, reports once, and waits 5 minutes after a failed fetch', async () => {
		const { store, fetchCredentials, report, advance } = newStore();
		fetchCredentials.mockRejectedValue(new Error('boom'));
		expect((await store.current()).origin).toBe('fallback');
		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0]).toBe('kick-key-fetch-failed');

		advance(RETRY_MS - 1);
		await store.current();
		expect(fetchCredentials).toHaveBeenCalledTimes(1);

		advance(1);
		await store.current();
		expect(fetchCredentials).toHaveBeenCalledTimes(2);
	});

	it('returns the last known answer when a refetch fails', async () => {
		const { store, fetchCredentials, advance } = newStore();
		await store.current();
		advance(HOUR_MS);
		fetchCredentials.mockRejectedValue(new Error('boom'));
		expect((await store.current()).appKey).toBe('kick-key');
	});

	it('reports a refused env key once and then asks Kick', async () => {
		const { store, fetchCredentials, report } = newStore({ KICK_PUSHER_KEY: 'env-key' });
		store.reject('env-key');
		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0]).toBe('kick-env-key-refused');
		expect((await store.current()).origin).toBe('kick');
		expect(fetchCredentials).toHaveBeenCalledTimes(1);

		store.reject('env-key');
		expect(report).toHaveBeenCalledTimes(1);
	});

	it('does not report a kept answer refused after 60 seconds', async () => {
		const { store, fetchCredentials, report, advance } = newStore();
		await store.current();
		advance(FRESH_MS);
		store.reject('kick-key');
		expect(report).not.toHaveBeenCalled();
		await store.current();
		expect(fetchCredentials).toHaveBeenCalledTimes(2);
	});

	it('reports a kept answer refused within 60 seconds', async () => {
		const { store, report, advance } = newStore();
		await store.current();
		advance(FRESH_MS - 1);
		store.reject('kick-key');
		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0]).toBe('kick-fetched-key-refused');
	});

	it('ignores a refusal of an unknown key', async () => {
		const { store, fetchCredentials, report } = newStore();
		await store.current();
		store.reject('unknown-key');
		expect(report).not.toHaveBeenCalled();
		expect((await store.current()).appKey).toBe('kick-key');
		expect(fetchCredentials).toHaveBeenCalledTimes(1);
	});
});
