import type { ChatMessage, SourceState } from '@all-chat/contract';
import type { ChatSource } from './types';

/**
 * Scaffold-only source: goes live immediately and emits a message every
 * two seconds. Lets the SSE pipeline, manager refcounting, and feed UI be
 * built and tested before any real platform source exists.
 */
export class FakeSource implements ChatSource {
	private timer: ReturnType<typeof setInterval> | undefined;
	private messageCb: ((message: ChatMessage) => void) | undefined;
	private statusCb: ((state: SourceState, detail?: string) => void) | undefined;
	private counter = 0;

	constructor(
		private readonly sourceId: string,
		private readonly channel: string
	) {}

	connect(): void {
		this.statusCb?.('connecting');
		this.statusCb?.('live');
		this.timer = setInterval(() => {
			this.counter += 1;
			this.messageCb?.({
				id: `fake-${this.sourceId}-${this.counter}`,
				sourceId: this.sourceId,
				platform: 'twitch',
				channel: this.channel,
				timestamp: Date.now(),
				author: {
					name: `viewer${this.counter % 7}`,
					color: '#F57900',
					badges: []
				},
				fragments: [{ kind: 'text', text: `hello from ${this.channel} #${this.counter}` }]
			});
		}, 2000);
	}

	disconnect(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
	}

	onMessage(cb: (message: ChatMessage) => void): void {
		this.messageCb = cb;
	}

	onStatus(cb: (state: SourceState, detail?: string) => void): void {
		this.statusCb = cb;
	}
}
