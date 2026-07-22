/**
 * Twitch send (EDD-V2 §5) via Helix's Send Chat Message endpoint — a
 * stateless POST, not a second authenticated IRC connection. TwitchSource's
 * IRC socket stays anonymous/read-only and shared across subscribers
 * (EDD §3.1); sending doesn't need a persistent connection at all, so
 * there's no reason to give it one.
 * https://dev.twitch.tv/docs/api/reference/#send-chat-message
 */

export interface TwitchSendTarget {
	/** Channel login to send into — resolved to a numeric broadcaster id via the Users API. */
	channel: string;
	/** The connected account's own access token — also whose identity the message is sent as. */
	accessToken: string;
	/** The connected account's own numeric user id (Helix's `sender_id`). */
	senderId: string;
	clientId: string;
}

interface SendChatMessageResult {
	message_id: string;
	is_sent: boolean;
	drop_reason?: { code: string; message: string };
}

async function resolveBroadcasterId(
	channel: string,
	accessToken: string,
	clientId: string,
	fetchImpl: typeof fetch
): Promise<string> {
	const url = new URL('https://api.twitch.tv/helix/users');
	url.searchParams.set('login', channel.toLowerCase());
	const response = await fetchImpl(url, {
		headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId }
	});
	if (!response.ok) throw new Error(`Twitch user lookup failed: ${response.status} ${await response.text()}`);
	const body = (await response.json()) as { data: { id: string }[] };
	const id = body.data[0]?.id;
	if (!id) throw new Error(`no Twitch channel found for "${channel}"`);
	return id;
}

export async function sendTwitchMessage(
	target: TwitchSendTarget,
	text: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const broadcasterId = await resolveBroadcasterId(target.channel, target.accessToken, target.clientId, fetchImpl);

	const response = await fetchImpl('https://api.twitch.tv/helix/chat/messages', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${target.accessToken}`,
			'Client-Id': target.clientId,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: target.senderId, message: text })
	});
	if (!response.ok) throw new Error(`Twitch send failed: ${response.status} ${await response.text()}`);

	const body = (await response.json()) as { data: SendChatMessageResult[] };
	const result = body.data[0];
	if (result && !result.is_sent) {
		throw new Error(`Twitch dropped the message: ${result.drop_reason?.message ?? 'unknown reason'}`);
	}
}
