import type { ChatMessage, SourceState } from '@all-chat/contract';

/**
 * A live connection to one platform channel. Implementations are
 * server-internal; only normalized ChatMessages cross the API boundary.
 */
export interface ChatSource {
	connect(): void;
	disconnect(): void;
	onMessage(cb: (message: ChatMessage) => void): void;
	onStatus(cb: (state: SourceState, detail?: string) => void): void;
}

export type SourceFactory = (sourceId: string, channel: string) => ChatSource;
