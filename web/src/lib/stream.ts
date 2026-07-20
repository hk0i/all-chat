import type { ChatMessage, HelloEvent, StatusEvent } from '@all-chat/contract';

export interface StreamHandlers {
	onHello?(hello: HelloEvent): void;
	onMessage(message: ChatMessage): void;
	onStatus?(status: StatusEvent): void;
	/**
	 * Fires once when the connection fails permanently — bad query params,
	 * an unknown profile, etc. (server-side validation happens before the
	 * SSE stream opens, so EventSource sees it as a non-retryable HTTP
	 * error and stops on its own; `readyState` is already CLOSED by the
	 * time this handler is invoked). `message` is the server's own
	 * validation text when available.
	 */
	onError?(message: string): void;
}

/**
 * Thin EventSource wrapper around GET /api/chat/stream.
 * `query` is the raw search string (e.g. "profile=gaming" or repeated
 * "source=twitch:foo" params). Returns a disposer.
 */
export function openChatStream(query: string, handlers: StreamHandlers): () => void {
	const url = `/api/chat/stream?${query}`;
	const source = new EventSource(url);
	let reported = false;

	source.addEventListener('hello', (event) => {
		handlers.onHello?.(JSON.parse((event as MessageEvent).data) as HelloEvent);
	});
	source.addEventListener('message', (event) => {
		handlers.onMessage(JSON.parse((event as MessageEvent).data) as ChatMessage);
	});
	source.addEventListener('status', (event) => {
		handlers.onStatus?.(JSON.parse((event as MessageEvent).data) as StatusEvent);
	});

	source.onerror = () => {
		// A transient drop leaves EventSource retrying (readyState CONNECTING) —
		// only a permanent close is worth surfacing, and only once.
		if (reported || source.readyState !== EventSource.CLOSED) return;
		reported = true;

		// EventSource never exposes the failed response's status or body, so
		// re-fetch the same URL once, purely to read the validation message
		// the server already sent as a normal HTTP error (SvelteKit's
		// `error(status, message)` — {message} JSON body, same shape the
		// profile editor already parses).
		fetch(url)
			.then(async (response) => {
				if (response.ok) {
					// Whatever failed before has since started working (e.g. the
					// profile was created after the first, failed load) — this
					// probe just opened a real upstream connection, so don't
					// leave it dangling; the user can reload to reconnect properly.
					response.body?.cancel();
					handlers.onError?.('stream closed unexpectedly — reload to retry');
					return;
				}
				let message = response.statusText || `request failed (${response.status})`;
				try {
					const body = (await response.json()) as { message?: string };
					if (body.message) message = body.message;
				} catch {
					/* body wasn't JSON */
				}
				handlers.onError?.(message);
			})
			.catch((cause) => handlers.onError?.((cause as Error).message));
	};

	return () => source.close();
}
