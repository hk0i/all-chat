import type { ChatMessage, Platform, SourceConfig, SourceState, StatusEvent } from '@all-chat/contract';
import type { ChatSource } from './sources/types';
import { FakeSource } from './sources/fake';

export interface Subscriber {
	onMessage(message: ChatMessage): void;
	onStatus(status: StatusEvent): void;
}

interface LiveSource {
	source: ChatSource;
	refCount: number;
	subscribers: Set<Subscriber>;
	lastState: SourceState;
	/** SourceConfig ids that map onto this upstream connection. */
	sourceIds: Map<Subscriber, string>;
	platform: Platform;
	channel: string;
}

/** Upstream connections are shared per platform+channel (EDD §3.4). */
const connectionKey = (platform: Platform, channel: string) => `${platform}:${channel.toLowerCase()}`;

const createSource = (platform: Platform, sourceId: string, channel: string): ChatSource => {
	// Real platform sources land per-platform; the scaffold wires everything
	// to FakeSource so the pipeline is exercisable end to end.
	void platform;
	return new FakeSource(sourceId, channel);
};

/**
 * Refcounted registry of live upstream connections with fan-out to SSE
 * subscribers. First subscriber to a platform+channel opens the connection;
 * the last one leaving closes it.
 */
export class SourceManager {
	private live = new Map<string, LiveSource>();

	subscribe(subscriber: Subscriber, sources: SourceConfig[]): () => void {
		// Exact duplicates within one subscription are delivered once (EDD §3.4).
		const seen = new Set<string>();
		const joined: string[] = [];

		for (const config of sources) {
			const key = connectionKey(config.platform, config.channel);
			if (seen.has(key)) continue;
			seen.add(key);
			joined.push(key);

			let entry = this.live.get(key);
			if (!entry) {
				const source = createSource(config.platform, config.id, config.channel);
				entry = {
					source,
					refCount: 0,
					subscribers: new Set(),
					lastState: 'connecting',
					sourceIds: new Map(),
					platform: config.platform,
					channel: config.channel
				};
				const stable = entry;
				source.onMessage((message) => {
					for (const sub of stable.subscribers) {
						sub.onMessage({ ...message, sourceId: stable.sourceIds.get(sub) ?? message.sourceId });
					}
				});
				source.onStatus((state, detail) => {
					stable.lastState = state;
					for (const sub of stable.subscribers) {
						sub.onStatus({
							sourceId: stable.sourceIds.get(sub) ?? '',
							platform: stable.platform,
							channel: stable.channel,
							state,
							detail
						});
					}
				});
				this.live.set(key, entry);
				entry.refCount += 1;
				entry.subscribers.add(subscriber);
				entry.sourceIds.set(subscriber, config.id);
				source.connect();
			} else {
				entry.refCount += 1;
				entry.subscribers.add(subscriber);
				entry.sourceIds.set(subscriber, config.id);
				// Late joiners immediately learn the current state.
				subscriber.onStatus({
					sourceId: config.id,
					platform: entry.platform,
					channel: entry.channel,
					state: entry.lastState
				});
			}
		}

		return () => {
			for (const key of joined) {
				const entry = this.live.get(key);
				if (!entry) continue;
				if (entry.subscribers.delete(subscriber)) {
					entry.sourceIds.delete(subscriber);
					entry.refCount -= 1;
				}
				if (entry.refCount <= 0) {
					entry.source.disconnect();
					this.live.delete(key);
				}
			}
		};
	}

	/** Number of live upstream connections (test/observability hook). */
	get liveConnectionCount(): number {
		return this.live.size;
	}
}

/** Process-wide singleton — one set of upstream connections per deployment. */
export const sourceManager = new SourceManager();
