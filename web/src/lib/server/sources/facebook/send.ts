import { GRAPH_API_VERSION } from '../../auth/facebookOAuth';

/**
 * Facebook send (EDD-V2 §5) — posts a comment to the Page's currently live
 * video, using the same Page access token the read side already stores
 * (`pages_manage_engagement`, added alongside the read scopes). Independent
 * of FacebookSource (index.ts): finding the live video is cheap and
 * one-shot here, not worth sharing state with a long-lived polling class.
 */

export interface FacebookSendTarget {
	facebookPageId: string;
	accessToken: string;
}

interface LiveVideosResponse {
	data: { id: string; status: string }[];
}

async function findLiveVideoId(pageId: string, pageAccessToken: string, fetchImpl: typeof fetch): Promise<string | undefined> {
	const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/live_videos`);
	url.searchParams.set('fields', 'id,status');
	url.searchParams.set('access_token', pageAccessToken);

	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`live_videos lookup failed: ${response.status} ${await response.text()}`);
	const body = (await response.json()) as LiveVideosResponse;
	return body.data.find((video) => video.status === 'LIVE')?.id;
}

export async function sendFacebookMessage(
	target: FacebookSendTarget,
	text: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const videoId = await findLiveVideoId(target.facebookPageId, target.accessToken, fetchImpl);
	if (!videoId) throw new Error('no live video on this Page right now');

	const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${videoId}/comments`);
	url.searchParams.set('message', text);
	url.searchParams.set('access_token', target.accessToken);

	const response = await fetchImpl(url, { method: 'POST' });
	if (!response.ok) throw new Error(`Facebook send failed: ${response.status} ${await response.text()}`);
}
