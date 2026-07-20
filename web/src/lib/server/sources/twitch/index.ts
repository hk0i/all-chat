import type { ChatMessage, SourceState } from '@all-chat/contract';
import type { ChatSource } from '../types';
import { parseIrcLine } from './irc';
import { privmsgToChatMessage } from './normalize';

/**
 * Anonymous read-only Twitch chat connection (EDD §3.1).
 *
 * Login flow: connect → CAP REQ (tags) → NICK justinfan<digits> (Twitch's
 * anonymous-user convention, no auth) → wait for 001 welcome → JOIN. Live
 * once the server confirms the join (own JOIN echo or 366 names-end).
 * https://dev.twitch.tv/docs/chat/irc/#connecting-to-the-twitch-irc-server
 */

export const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

/** Minimal WebSocket surface used — satisfied by Node's global WebSocket. */
export interface SocketLike {
	addEventListener(type: 'open' | 'message' | 'close', listener: (event: { data?: unknown }) => void): void;
	send(data: string): void;
	close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

/* IRC numeric replies (RFC 1459 names). */
/**  registration accepted — safe to JOIN */
const RPL_WELCOME = '001';
/** end of NAMES list — join confirmed */
const RPL_ENDOFNAMES = '366';

export class TwitchSource implements ChatSource {
	private socket: SocketLike | undefined;
	private messageCb: ((message: ChatMessage) => void) | undefined;
	private statusCb: ((state: SourceState, detail?: string) => void) | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private attempts = 0;
	private joined = false;
	private closed = false;
	private readonly nick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`;

	constructor(
		private readonly sourceId: string,
		private readonly channel: string,
		private readonly createSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike
	) {}

	connect(): void {
		this.closed = false;
		this.open();
	}

	disconnect(): void {
		this.closed = true;
		if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
		this.socket?.close();
		this.socket = undefined;
	}

	onMessage(cb: (message: ChatMessage) => void): void {
		this.messageCb = cb;
	}

	onStatus(cb: (state: SourceState, detail?: string) => void): void {
		this.statusCb = cb;
	}

	private open(): void {
		this.joined = false;
		this.statusCb?.(this.attempts === 0 ? 'connecting' : 'reconnecting');
		const socket = this.createSocket(TWITCH_IRC_URL);
		this.socket = socket;

		socket.addEventListener('open', () => {
			socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
			socket.send(`NICK ${this.nick}`);
		});

		socket.addEventListener('message', (event) => {
			if (typeof event.data !== 'string') return;
			for (const raw of event.data.split('\r\n')) {
				if (raw) this.handleLine(raw);
			}
		});

		socket.addEventListener('close', () => {
			if (this.socket !== socket) return; // superseded by a newer socket
			this.socket = undefined;
			if (!this.closed) this.scheduleReconnect('connection closed');
		});
	}

	private handleLine(raw: string): void {
		const line = parseIrcLine(raw);
		if (!line) return;

		switch (line.command) {
			case 'PING':
				this.socket?.send(`PONG :${line.params[0] ?? 'tmi.twitch.tv'}`);
				return;
			case RPL_WELCOME:
				this.socket?.send(`JOIN #${this.channel.toLowerCase()}`);
				return;
			case 'JOIN':
			case RPL_ENDOFNAMES: // either can confirm the join; emit live once
				if (!this.joined) {
					this.joined = true;
					this.attempts = 0;
					this.statusCb?.('live');
				}
				return;
			case 'RECONNECT': // Twitch is about to drop us; reconnect proactively
				this.socket?.close();
				return;
			case 'PRIVMSG': {
				const message = privmsgToChatMessage(line, this.sourceId);
				if (message) this.messageCb?.(message);
				return;
			}
		}
	}

	private scheduleReconnect(detail: string): void {
		this.attempts += 1;
		const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempts - 1));
		const jittered = delay / 2 + Math.random() * (delay / 2);
		this.statusCb?.('reconnecting', `${detail}; retry in ${Math.round(jittered / 1000)}s`);
		this.reconnectTimer = setTimeout(() => this.open(), jittered);
	}
}
