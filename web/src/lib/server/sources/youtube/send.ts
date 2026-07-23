import { resolveInput } from './resolve';

/**
 * YouTube send (EDD-V2 §5) via the official Data API v3
 * `liveChatMessages.insert` — a different API family entirely from the
 * unofficial InnerTube read path (innertube.ts). Read is free and needs no
 * auth; send is quota-metered (200 units/call) and needs the connected
 * account's OAuth token.
 * https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert
 */

export interface YouTubeSendTarget {
	/** Same value as SourceConfig.channel: a URL, bare video id, or @handle. */
	channel: string;
	accessToken: string;
}

interface VideosListResponse {
	items: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
}

async function resolveLiveChatId(videoId: string, accessToken: string, fetchImpl: typeof fetch): Promise<string> {
	const url = new URL('https://www.googleapis.com/youtube/v3/videos');
	url.searchParams.set('part', 'liveStreamingDetails');
	url.searchParams.set('id', videoId);

	const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
	if (!response.ok) throw new Error(`YouTube video lookup failed: ${response.status} ${await response.text()}`);
	const body = (await response.json()) as VideosListResponse;
	const liveChatId = body.items[0]?.liveStreamingDetails?.activeLiveChatId;
	if (!liveChatId) throw new Error(`no active live chat for video ${videoId} (stream may have ended)`);
	return liveChatId;
}

export async function sendYouTubeMessage(
	target: YouTubeSendTarget,
	text: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const videoId = await resolveInput(target.channel, fetchImpl);
	const liveChatId = await resolveLiveChatId(videoId, target.accessToken, fetchImpl);

	const response = await fetchImpl('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', {
		method: 'POST',
		headers: { Authorization: `Bearer ${target.accessToken}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			snippet: {
				liveChatId,
				type: 'textMessageEvent',
				textMessageDetails: { messageText: text }
			}
		})
	});
	if (!response.ok) throw new Error(`YouTube send failed: ${response.status} ${await response.text()}`);
}
