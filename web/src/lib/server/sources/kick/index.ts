import type { ChatMessage, SourceState } from '@all-chat/contract';
import type { ChatSource } from '../types';
import { realSocketFactory, type SocketFactory, type SocketLike } from '../socket';
import { KICK_CHATROOM_CHANNEL, KICK_CHAT_MESSAGE_EVENT, KICK_PUSHER_SOCKET_URL } from './constants';
import { kickCredentials, type CredentialSource, type PusherCredentials } from './credentials';
import { KickLookupError, lookupChatroomId } from './lookup';
import { kickEventToChatMessage } from './normalize';

/**
 * Kick chat connection over Pusher (EDD §3.2).
 *
 * Flow: resolve channel → chatroom id (skipped when the channel field is
 * already numeric) → resolve Pusher credentials (`credentials.ts`) → open
 * Pusher WebSocket → server sends
 * `pusher:connection_established` → we send `pusher:subscribe` for
 * `chatrooms.<id>.v2` → `pusher_internal:subscription_succeeded` → live.
 * Chat arrives as `App\Events\ChatMessageEvent` with a **double-encoded**
 * `data` field (JSON string inside the JSON envelope).
 */

/** Pusher envelope: `data` is a JSON *string*, except on `pusher:error` where it is an object. */
interface PusherEnvelope {
	event?: string;
	data?: string | { code?: number; message?: string };
	channel?: string;
}

/** Pusher error code for an app key the cluster does not know. */
const PUSHER_APP_KEY_REFUSED = 4001;

const KEY_ORIGIN_LABEL: Record<PusherCredentials['origin'], string> = {
	env: 'from KICK_PUSHER_KEY',
	kick: 'from Kick',
	fallback: 'built-in fallback'
};

/** Reads the error code from either the object form or a JSON-string form of `data`. */
function pusherErrorCode(data: PusherEnvelope['data']): number | undefined {
	if (typeof data === 'string') {
		try {
			return pusherErrorCode(JSON.parse(data) as PusherEnvelope['data']);
		} catch {
			return undefined;
		}
	}
	return typeof data?.code === 'number' ? data.code : undefined;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

export type LookupFn = (slug: string) => Promise<number>;

export class KickSource implements ChatSource {
	private socket: SocketLike | undefined;
	private messageCb: ((message: ChatMessage) => void) | undefined;
	private statusCb: ((state: SourceState, detail?: string) => void) | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private attempts = 0;
	private subscribed = false;
	private closed = false;
	private chatroomId: number | undefined;
	private credentialsInUse: PusherCredentials | undefined;
	private keyRefusedDetail: string | undefined;

	constructor(
		private readonly sourceId: string,
		private readonly channel: string,
		private readonly createSocket: SocketFactory = realSocketFactory,
		private readonly lookup: LookupFn = lookupChatroomId,
		private readonly credentials: CredentialSource = kickCredentials
	) {}

	connect(): void {
		this.closed = false;
		this.statusCb?.('connecting');
		void this.resolveAndOpen();
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

	private async resolveAndOpen(): Promise<void> {
		if (this.chatroomId === undefined) {
			// Numeric channel = chatroom id given directly, no lookup needed —
			// the practical path when Cloudflare blocks server-side lookups.
			if (/^\d+$/.test(this.channel)) {
				this.chatroomId = Number(this.channel);
			} else {
				try {
					this.chatroomId = await this.lookup(this.channel);
				} catch (error) {
					if (this.closed) return;
					const blocked = error instanceof KickLookupError && error.blocked;
					this.statusCb?.(
						'failed',
						blocked
							? `kick lookup blocked (Cloudflare) — use the numeric chatroom id as the channel instead of "${this.channel}"`
							: (error as Error).message
					);
					return;
				}
			}
		}
		if (!this.closed) await this.open();
	}

	private async open(): Promise<void> {
		if (this.attempts > 0) this.statusCb?.('reconnecting');
		const credentials = await this.credentials.current();
		if (this.closed) return;
		this.credentialsInUse = credentials;
		const socket = this.createSocket(KICK_PUSHER_SOCKET_URL(credentials.host, credentials.appKey));
		this.socket = socket;
		this.subscribed = false;

		socket.addEventListener('message', (event) => {
			if (typeof event.data !== 'string') return;
			this.handleEnvelope(event.data);
		});

		socket.addEventListener('close', () => {
			if (this.socket !== socket) return; // superseded by a newer socket
			this.socket = undefined;
			if (!this.closed) this.scheduleReconnect();
		});
	}

	private handleEnvelope(raw: string): void {
		let envelope: PusherEnvelope;
		try {
			envelope = JSON.parse(raw) as PusherEnvelope;
		} catch {
			return;
		}

		switch (envelope.event) {
			case 'pusher:connection_established':
				this.socket?.send(
					JSON.stringify({
						event: 'pusher:subscribe',
						data: { auth: '', channel: KICK_CHATROOM_CHANNEL(this.chatroomId!) }
					})
				);
				return;
			case 'pusher_internal:subscription_succeeded':
				if (!this.subscribed) {
					this.subscribed = true;
					this.attempts = 0;
					this.statusCb?.('live');
				}
				return;
			case 'pusher:ping':
				this.socket?.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
				return;
			case 'pusher:error': {
				if (pusherErrorCode(envelope.data) !== PUSHER_APP_KEY_REFUSED || !this.credentialsInUse) return;
				this.credentials.reject(this.credentialsInUse.appKey);
				this.keyRefusedDetail = `kick refused the chat key (${KEY_ORIGIN_LABEL[this.credentialsInUse.origin]}); trying another`;
				// Pusher does not always close after 4001; closing drives the normal reconnect path.
				this.socket?.close();
				return;
			}
			case KICK_CHAT_MESSAGE_EVENT: {
				if (typeof envelope.data !== 'string') return;
				let payload: unknown;
				try {
					payload = JSON.parse(envelope.data);
				} catch {
					return;
				}
				const message = kickEventToChatMessage(payload, this.sourceId, this.channel);
				if (message) this.messageCb?.(message);
				return;
			}
		}
	}

	private scheduleReconnect(): void {
		this.attempts += 1;
		const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempts - 1));
		const jittered = delay / 2 + Math.random() * (delay / 2);
		const reason = this.keyRefusedDetail ?? 'connection closed';
		this.keyRefusedDetail = undefined;
		this.statusCb?.('reconnecting', `${reason}; retry in ${Math.round(jittered / 1000)}s`);
		this.reconnectTimer = setTimeout(() => void this.open(), jittered);
	}
}
