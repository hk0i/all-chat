import { describe, expect, it, vi } from 'vitest';
import { sendTwitchMessage } from './send';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const TARGET = { channel: 'somechannel', accessToken: 'user-token', senderId: '999', clientId: 'client-1' };

describe('sendTwitchMessage', () => {
	it('resolves the broadcaster id then posts the message', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ data: [{ id: '123' }] }))
			.mockResolvedValueOnce(json({ data: [{ message_id: 'm1', is_sent: true }] }));

		await sendTwitchMessage(TARGET, 'hello chat', fetchFn as typeof fetch);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		const [usersUrl] = fetchFn.mock.calls[0] as [URL, RequestInit];
		expect(usersUrl.toString()).toContain('login=somechannel');

		const [sendUrl, sendInit] = fetchFn.mock.calls[1] as [string, RequestInit];
		expect(sendUrl).toBe('https://api.twitch.tv/helix/chat/messages');
		expect(JSON.parse(sendInit.body as string)).toEqual({
			broadcaster_id: '123',
			sender_id: '999',
			message: 'hello chat'
		});
	});

	it('throws when the channel login does not resolve to a Twitch user', async () => {
		const fetchFn = vi.fn().mockResolvedValueOnce(json({ data: [] }));
		await expect(sendTwitchMessage(TARGET, 'hi', fetchFn as typeof fetch)).rejects.toThrow('no Twitch channel found');
	});

	it('throws with the drop reason when Twitch accepts the request but drops the message', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ data: [{ id: '123' }] }))
			.mockResolvedValueOnce(
				json({ data: [{ message_id: 'm1', is_sent: false, drop_reason: { code: 'msg_rejected', message: 'flagged as spam' } }] })
			);

		await expect(sendTwitchMessage(TARGET, 'hi', fetchFn as typeof fetch)).rejects.toThrow('flagged as spam');
	});

	it('throws on a non-ok send response', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ data: [{ id: '123' }] }))
			.mockResolvedValueOnce(json({ message: 'invalid oauth token' }, 401));

		await expect(sendTwitchMessage(TARGET, 'hi', fetchFn as typeof fetch)).rejects.toThrow('Twitch send failed: 401');
	});
});
