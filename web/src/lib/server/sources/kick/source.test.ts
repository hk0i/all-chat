import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '../socket';
import { KickSource } from './index';
import { KickLookupError } from './lookup';

class FakePusherSocket implements SocketLike {
	sent: string[] = [];
	closed = false;
	private listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
		this.emit('close', {});
	}

	emit(type: string, event: { data?: unknown }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	/** Server → client Pusher envelope; `data` is JSON-stringified per protocol. */
	receive(event: string, data: unknown): void {
		this.emit('message', {
			data: JSON.stringify({ event, data: typeof data === 'string' ? data : JSON.stringify(data) })
		});
	}
}

const CHAT_EVENT = 'App\\Events\\ChatMessageEvent';
const chatPayload = {
	id: 'k1',
	content: 'hello',
	type: 'message',
	created_at: '2026-07-19T12:00:00+00:00',
	sender: { username: 'someone', identity: { color: '#123456', badges: [] } }
};

/** Drains the async lookup step so the socket exists. */
const tick = () => vi.advanceTimersByTimeAsync(0);

describe('KickSource', () => {
	let sockets: FakePusherSocket[];
	let statuses: { state: string; detail?: string }[];
	let messages: string[];

	const newSource = (channel: string, lookup?: (slug: string) => Promise<number>) => {
		const source = new KickSource(
			'src-k',
			channel,
			() => {
				const socket = new FakePusherSocket();
				sockets.push(socket);
				return socket;
			},
			lookup ?? (() => Promise.reject(new Error('lookup should not be called')))
		);
		source.onStatus((state, detail) => statuses.push({ state, detail }));
		source.onMessage((message) => messages.push(message.id));
		return source;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		sockets = [];
		statuses = [];
		messages = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('uses a numeric channel as chatroom id directly (no lookup)', async () => {
		const source = newSource('12345');
		source.connect();
		await tick();
		expect(sockets).toHaveLength(1);

		sockets[0].receive('pusher:connection_established', { socket_id: '1.1' });
		expect(JSON.parse(sockets[0].sent[0])).toEqual({
			event: 'pusher:subscribe',
			data: { auth: '', channel: 'chatrooms.12345.v2' }
		});
		source.disconnect();
	});

	it('resolves slugs via lookup and goes live on subscription_succeeded', async () => {
		const source = newSource('gmpekk', () => Promise.resolve(777));
		source.connect();
		await tick();

		sockets[0].receive('pusher:connection_established', { socket_id: '1.1' });
		expect(sockets[0].sent[0]).toContain('chatrooms.777.v2');

		sockets[0].receive('pusher_internal:subscription_succeeded', {});
		expect(statuses.map((s) => s.state)).toEqual(['connecting', 'live']);
		source.disconnect();
	});

	it('fails with a manual-id hint when the lookup is Cloudflare-blocked', async () => {
		const source = newSource('gmpekk', () =>
			Promise.reject(new KickLookupError('blocked', true, 403))
		);
		source.connect();
		await tick();
		expect(sockets).toHaveLength(0);
		expect(statuses.at(-1)).toMatchObject({ state: 'failed' });
		expect(statuses.at(-1)?.detail).toContain('numeric chatroom id');
		source.disconnect();
	});

	it('emits normalized messages from double-encoded chat events', async () => {
		const source = newSource('12345');
		source.connect();
		await tick();
		sockets[0].receive(CHAT_EVENT, chatPayload);
		expect(messages).toEqual(['k1']);
		source.disconnect();
	});

	it('answers pusher:ping with pusher:pong', async () => {
		const source = newSource('12345');
		source.connect();
		await tick();
		sockets[0].receive('pusher:ping', {});
		expect(sockets[0].sent.some((frame) => frame.includes('pusher:pong'))).toBe(true);
		source.disconnect();
	});

	it('reconnects with backoff after a drop, reusing the resolved chatroom id', async () => {
		const source = newSource('12345');
		source.connect();
		await tick();
		sockets[0].emit('close', {});
		expect(statuses.at(-1)?.state).toBe('reconnecting');

		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
		source.disconnect();
	});
});
