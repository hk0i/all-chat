import { describe, expect, it, vi } from 'vitest';
import { sendYouTubeMessage } from './send';

const VIDEO_ID = 'dQw4w9WgXcQ';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('sendYouTubeMessage', () => {
	it('resolves the video, finds the active live chat, and posts the message', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] }))
			.mockResolvedValueOnce(json({ id: 'm1' }));

		await sendYouTubeMessage({ channel: VIDEO_ID, accessToken: 'user-token' }, 'hello chat', fetchFn as typeof fetch);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		const [videosUrl] = fetchFn.mock.calls[0] as [URL, RequestInit];
		expect(videosUrl.toString()).toContain(`id=${VIDEO_ID}`);

		const [insertUrl, insertInit] = fetchFn.mock.calls[1] as [string, RequestInit];
		expect(insertUrl).toBe('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet');
		expect(JSON.parse(insertInit.body as string)).toEqual({
			snippet: {
				liveChatId: 'chat-1',
				type: 'textMessageEvent',
				textMessageDetails: { messageText: 'hello chat' }
			}
		});
	});

	it('resolves an @handle input through the same InnerTube resolver the read path uses', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					`<link rel="canonical" href="https://www.youtube.com/watch?v=${VIDEO_ID}">`,
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] }))
			.mockResolvedValueOnce(json({ id: 'm1' }));

		await sendYouTubeMessage({ channel: '@somechannel', accessToken: 'user-token' }, 'hi', fetchFn as typeof fetch);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('throws when the video has no active live chat', async () => {
		const fetchFn = vi.fn().mockResolvedValueOnce(json({ items: [{}] }));
		await expect(
			sendYouTubeMessage({ channel: VIDEO_ID, accessToken: 'user-token' }, 'hi', fetchFn as typeof fetch)
		).rejects.toThrow('no active live chat');
	});

	it('throws on a non-ok insert response', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] }))
			.mockResolvedValueOnce(json({ error: { message: 'quota exceeded' } }, 403));

		await expect(
			sendYouTubeMessage({ channel: VIDEO_ID, accessToken: 'user-token' }, 'hi', fetchFn as typeof fetch)
		).rejects.toThrow('YouTube send failed: 403');
	});
});
