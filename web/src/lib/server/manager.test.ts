import { describe, expect, it, vi } from 'vitest';
import type { SourceConfig } from '@all-chat/contract';
import { SourceManager, type Subscriber } from './manager';

const source = (id: string, channel: string, platform: SourceConfig['platform'] = 'twitch'): SourceConfig => ({
	id,
	platform,
	channel
});

const subscriber = (): Subscriber => ({ onMessage: vi.fn(), onStatus: vi.fn() });

describe('SourceManager', () => {
	it('opens one upstream connection per platform+channel', () => {
		const manager = new SourceManager();
		const unsubscribe = manager.subscribe(subscriber(), [
			source('a', 'gmpekk'),
			source('b', 'gmpekk', 'kick'),
			source('c', 'other')
		]);
		expect(manager.liveConnectionCount).toBe(3);
		unsubscribe();
	});

	it('deduplicates exact duplicates within one subscription', () => {
		const manager = new SourceManager();
		const unsubscribe = manager.subscribe(subscriber(), [
			source('a', 'gmpekk'),
			source('b', 'gmpekk'),
			source('c', 'GMPEKK')
		]);
		expect(manager.liveConnectionCount).toBe(1);
		unsubscribe();
	});

	it('shares upstream connections across subscribers and closes on last detach', () => {
		const manager = new SourceManager();
		const first = manager.subscribe(subscriber(), [source('a', 'gmpekk')]);
		const second = manager.subscribe(subscriber(), [source('x', 'gmpekk')]);
		expect(manager.liveConnectionCount).toBe(1);

		first();
		expect(manager.liveConnectionCount).toBe(1);
		second();
		expect(manager.liveConnectionCount).toBe(0);
	});

	it('tells late joiners the current source state immediately', () => {
		const manager = new SourceManager();
		const first = manager.subscribe(subscriber(), [source('a', 'gmpekk')]);

		const late = subscriber();
		const second = manager.subscribe(late, [source('x', 'gmpekk')]);
		expect(late.onStatus).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: 'x', state: 'live' })
		);

		first();
		second();
	});

	it('rewrites sourceId per subscriber on fan-out', async () => {
		vi.useFakeTimers();
		const manager = new SourceManager();
		const sub = subscriber();
		const unsubscribe = manager.subscribe(sub, [source('mine', 'gmpekk')]);

		await vi.advanceTimersByTimeAsync(2100);
		expect(sub.onMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'mine' }));

		unsubscribe();
		vi.useRealTimers();
	});
});
