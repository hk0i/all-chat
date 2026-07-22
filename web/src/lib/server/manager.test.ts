import { describe, expect, it, vi } from 'vitest';
import type { SourceConfig } from '@all-chat/contract';
import { SourceManager, type Subscriber } from './manager';
import { FakeSource } from './sources/fake';

/** Tests always use FakeSource — no real platform connections. */
const newManager = () => new SourceManager((_platform, sourceId, channel) => new FakeSource(sourceId, channel));

const source = (id: string, channel: string, platform: SourceConfig['platform'] = 'twitch'): SourceConfig => ({
	id,
	platform,
	channel
});

const subscriber = (): Subscriber => ({ onMessage: vi.fn(), onStatus: vi.fn() });

describe('SourceManager', () => {
	it('opens one upstream connection per platform+channel', () => {
		const manager = newManager();
		const unsubscribe = manager.subscribe(subscriber(), [
			source('a', 'gmpekk'),
			source('b', 'gmpekk', 'kick'),
			source('c', 'other')
		]);
		expect(manager.liveConnectionCount).toBe(3);
		unsubscribe();
	});

	it('keys facebook sources by connectionId, not channel (no anonymous read to key on)', () => {
		const manager = newManager();
		const unsubscribe = manager.subscribe(subscriber(), [
			{ id: 'a', platform: 'facebook', channel: 'My Page', connectionId: 'conn-1' },
			{ id: 'b', platform: 'facebook', channel: 'My Page', connectionId: 'conn-2' }
		]);
		expect(manager.liveConnectionCount).toBe(2);
		unsubscribe();
	});

	it('deduplicates exact duplicates within one subscription', () => {
		const manager = newManager();
		const unsubscribe = manager.subscribe(subscriber(), [
			source('a', 'gmpekk'),
			source('b', 'gmpekk'),
			source('c', 'GMPEKK')
		]);
		expect(manager.liveConnectionCount).toBe(1);
		unsubscribe();
	});

	it('shares upstream connections across subscribers and closes on last detach', () => {
		const manager = newManager();
		const first = manager.subscribe(subscriber(), [source('a', 'gmpekk')]);
		const second = manager.subscribe(subscriber(), [source('x', 'gmpekk')]);
		expect(manager.liveConnectionCount).toBe(1);

		first();
		expect(manager.liveConnectionCount).toBe(1);
		second();
		expect(manager.liveConnectionCount).toBe(0);
	});

	it('tells late joiners the current source state immediately', () => {
		const manager = newManager();
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
		const manager = newManager();
		const sub = subscriber();
		const unsubscribe = manager.subscribe(sub, [source('mine', 'gmpekk')]);

		await vi.advanceTimersByTimeAsync(2100);
		expect(sub.onMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'mine' }));

		unsubscribe();
		vi.useRealTimers();
	});
});
