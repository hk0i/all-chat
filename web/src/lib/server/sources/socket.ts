/** Minimal WebSocket surface our sources use — satisfied by Node's global WebSocket. */
export interface SocketLike {
	addEventListener(
		type: 'open' | 'message' | 'close',
		listener: (event: { data?: unknown }) => void
	): void;
	send(data: string): void;
	close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Default factory: real WebSocket (Node 22 global). */
export const realSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;
