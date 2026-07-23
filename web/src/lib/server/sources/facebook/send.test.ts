import { describe, expect, it, vi } from 'vitest';
import { sendFacebookMessage } from './send';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const TARGET = { facebookPageId: '111', accessToken: 'page-token' };

describe('sendFacebookMessage', () => {
	it('finds the live video and posts the comment', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ data: [{ id: 'v1', status: 'LIVE' }] }))
			.mockResolvedValueOnce(json({ id: 'comment-1' }));

		await sendFacebookMessage(TARGET, 'hello chat', fetchFn as typeof fetch);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		const [liveVideosUrl] = fetchFn.mock.calls[0] as [URL, RequestInit];
		expect(liveVideosUrl.toString()).toContain('/111/live_videos');

		const [commentsUrl, commentsInit] = fetchFn.mock.calls[1] as [URL, RequestInit];
		expect(commentsUrl.toString()).toContain('/v1/comments');
		expect(commentsUrl.searchParams.get('message')).toBe('hello chat');
		expect(commentsInit.method).toBe('POST');
	});

	it('throws when the Page has no live video', async () => {
		const fetchFn = vi.fn().mockResolvedValueOnce(json({ data: [] }));
		await expect(sendFacebookMessage(TARGET, 'hi', fetchFn as typeof fetch)).rejects.toThrow('no live video');
	});

	it('throws on a non-ok comment-post response', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json({ data: [{ id: 'v1', status: 'LIVE' }] }))
			.mockResolvedValueOnce(json({ error: { message: 'missing pages_manage_engagement permission' } }, 403));

		await expect(sendFacebookMessage(TARGET, 'hi', fetchFn as typeof fetch)).rejects.toThrow('Facebook send failed: 403');
	});
});
