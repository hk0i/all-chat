import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitchSource, type SocketLike } from './index';

class FakeSocket implements SocketLike {
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

	/** Server → client IRC lines (joined the way Twitch batches them). */
	receive(...lines: string[]): void {
		this.emit('message', { data: lines.join('\r\n') + '\r\n' });
	}
}

const PRIVMSG =
	'@id=m1;display-name=Chatter;tmi-sent-ts=1784000000000 ' +
	':chatter!chatter@chatter.tmi.twitch.tv PRIVMSG #gmpekk :hi';

describe('TwitchSource', () => {
	let sockets: FakeSocket[];
	let source: TwitchSource;
	let statuses: string[];
	let messages: string[];

	beforeEach(() => {
		vi.useFakeTimers();
		sockets = [];
		statuses = [];
		messages = [];
		source = new TwitchSource('src-1', 'GMPekk', () => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		});
		source.onStatus((state) => statuses.push(state));
		source.onMessage((message) => messages.push(message.id));
	});

	afterEach(() => {
		source.disconnect();
		vi.useRealTimers();
	});

	it('performs the anonymous login handshake and joins lowercased channel', () => {
		source.connect();
		const socket = sockets[0];
		socket.emit('open', {});
		expect(socket.sent[0]).toBe('CAP REQ :twitch.tv/tags twitch.tv/commands');
		expect(socket.sent[1]).toMatch(/^NICK justinfan\d+$/);

		socket.receive(':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!');
		expect(socket.sent[2]).toBe('JOIN #gmpekk');

		socket.receive(':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #gmpekk');
		expect(statuses).toEqual(['connecting', 'live']);
	});

	it('answers PING with PONG', () => {
		source.connect();
		const socket = sockets[0];
		socket.emit('open', {});
		socket.receive('PING :tmi.twitch.tv');
		expect(socket.sent).toContain('PONG :tmi.twitch.tv');
	});

	it('emits normalized messages for PRIVMSG lines', () => {
		source.connect();
		const socket = sockets[0];
		socket.emit('open', {});
		socket.receive(PRIVMSG);
		expect(messages).toEqual(['m1']);
	});

	it('reconnects with backoff when the connection drops', async () => {
		source.connect();
		sockets[0].emit('open', {});
		sockets[0].emit('close', {});
		expect(statuses.at(-1)).toBe('reconnecting');

		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
	});

	it('honors the RECONNECT command from the server', async () => {
		source.connect();
		const socket = sockets[0];
		socket.emit('open', {});
		socket.receive('RECONNECT');
		expect(socket.closed).toBe(true);

		await vi.advanceTimersByTimeAsync(1000);
		expect(sockets).toHaveLength(2);
	});

	it('stays closed after disconnect()', async () => {
		source.connect();
		sockets[0].emit('open', {});
		source.disconnect();
		await vi.advanceTimersByTimeAsync(60000);
		expect(sockets).toHaveLength(1);
	});
});
