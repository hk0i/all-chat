import type { ChatMessage, HelloEvent, StatusEvent } from '@all-chat/contract';

export interface StreamHandlers {
	onHello?(hello: HelloEvent): void;
	onMessage(message: ChatMessage): void;
	onStatus?(status: StatusEvent): void;
	onError?(): void;
}

/**
 * Thin EventSource wrapper around GET /api/chat/stream.
 * `query` is the raw search string (e.g. "profile=gaming" or repeated
 * "source=twitch:foo" params). Returns a disposer.
 */
export function openChatStream(query: string, handlers: StreamHandlers): () => void {
	const source = new EventSource(`/api/chat/stream?${query}`);

	source.addEventListener('hello', (event) => {
		handlers.onHello?.(JSON.parse((event as MessageEvent).data) as HelloEvent);
	});
	source.addEventListener('message', (event) => {
		handlers.onMessage(JSON.parse((event as MessageEvent).data) as ChatMessage);
	});
	source.addEventListener('status', (event) => {
		handlers.onStatus?.(JSON.parse((event as MessageEvent).data) as StatusEvent);
	});
	source.onerror = () => handlers.onError?.();

	return () => source.close();
}
