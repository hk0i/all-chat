import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceConfig } from '@all-chat/contract';
import type { PlatformConnectionRecord } from './auth/config';

const { getPlatformConnection } = vi.hoisted(() => ({ getPlatformConnection: vi.fn() }));
vi.mock('./auth/config', () => ({ getPlatformConnection }));

const { sendTwitchMessage } = vi.hoisted(() => ({ sendTwitchMessage: vi.fn() }));
vi.mock('./sources/twitch/send', () => ({ sendTwitchMessage }));

const { sendChatMessage } = await import('./send');

const TWITCH_CONNECTION: PlatformConnectionRecord = {
	id: 'conn-1',
	platform: 'twitch',
	accountLabel: 'gmpekk',
	connectedAt: 1784000000000,
	accessToken: 'user-token',
	platformUserId: '999'
};

const source = (overrides: Partial<SourceConfig> = {}): SourceConfig => ({
	id: 's1',
	platform: 'twitch',
	channel: 'somechannel',
	connectionId: 'conn-1',
	...overrides
});

describe('sendChatMessage', () => {
	beforeEach(() => {
		getPlatformConnection.mockReset();
		sendTwitchMessage.mockReset();
	});

	it('skips sources with no connected account entirely — not reported as a failure', async () => {
		const results = await sendChatMessage([source({ connectionId: undefined })], 'hi');
		expect(results).toEqual([]);
		expect(getPlatformConnection).not.toHaveBeenCalled();
	});

	it('sends through a connected Twitch source', async () => {
		getPlatformConnection.mockResolvedValue(TWITCH_CONNECTION);
		sendTwitchMessage.mockResolvedValue(undefined);

		const results = await sendChatMessage([source()], 'hello chat');

		expect(results).toEqual([{ sourceId: 's1', platform: 'twitch', ok: true }]);
		expect(sendTwitchMessage).toHaveBeenCalledWith(
			expect.objectContaining({ channel: 'somechannel', accessToken: 'user-token', senderId: '999' }),
			'hello chat'
		);
	});

	it('reports a per-target failure when the connection was revoked', async () => {
		getPlatformConnection.mockResolvedValue(undefined);
		const results = await sendChatMessage([source()], 'hi');
		expect(results).toEqual([
			{ sourceId: 's1', platform: 'twitch', ok: false, error: expect.stringContaining('reconnect') }
		]);
	});

	it('reports a per-target failure without touching other targets when one platform errors', async () => {
		getPlatformConnection.mockResolvedValue(TWITCH_CONNECTION);
		sendTwitchMessage.mockRejectedValue(new Error('Twitch send failed: 429 rate limited'));

		const results = await sendChatMessage(
			[source({ id: 'a' }), source({ id: 'b', platform: 'youtube', connectionId: 'conn-2' })],
			'hi'
		);

		expect(results).toEqual([
			{ sourceId: 'a', platform: 'twitch', ok: false, error: 'Twitch send failed: 429 rate limited' },
			{ sourceId: 'b', platform: 'youtube', ok: false, error: 'YouTube send is not implemented yet' }
		]);
	});
});
