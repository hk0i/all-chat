import type { ChatSendResult, SourceConfig } from '@all-chat/contract';
import { getPlatformConnection } from './auth/config';
import { ensureFreshToken } from './auth/tokenRefresh';
import { sendFacebookMessage } from './sources/facebook/send';
import { sendTwitchMessage } from './sources/twitch/send';
import { sendYouTubeMessage } from './sources/youtube/send';

async function sendToSource(source: SourceConfig & { connectionId: string }, text: string): Promise<ChatSendResult> {
	const fail = (message: string): ChatSendResult => ({ sourceId: source.id, platform: source.platform, ok: false, error: message });

	const connection = await getPlatformConnection(source.connectionId);
	if (!connection) return fail('connection not found — reconnect this account in admin');

	try {
		// Refreshes the access token first if it's expired/expiring — a failed
		// refresh (dead refresh token) surfaces as a normal per-target error
		// below, same as any other send failure.
		const active = await ensureFreshToken(connection);
		switch (source.platform) {
			case 'twitch': {
				if (!active.platformUserId) throw new Error('missing platform user id — reconnect this account');
				await sendTwitchMessage(
					{
						channel: source.channel,
						accessToken: active.accessToken,
						senderId: active.platformUserId,
						clientId: process.env.TWITCH_CLIENT_ID ?? ''
					},
					text
				);
				break;
			}
			case 'youtube':
				await sendYouTubeMessage({ channel: source.channel, accessToken: active.accessToken }, text);
				break;
			case 'kick':
				throw new Error('Kick has no OAuth/send support yet (EDD-V2 §3, §8)');
			case 'facebook': {
				if (!active.facebookPageId) throw new Error('missing Facebook Page id — reconnect this account');
				await sendFacebookMessage({ facebookPageId: active.facebookPageId, accessToken: active.accessToken }, text);
				break;
			}
		}
		return { sourceId: source.id, platform: source.platform, ok: true };
	} catch (cause) {
		return fail((cause as Error).message);
	}
}

/**
 * Fan-out is per-target and independent (EDD-V2 §5) — one send can
 * partially succeed (e.g. Twitch goes through, YouTube isn't implemented
 * yet). Sources with no connected account aren't send targets at all —
 * silently skipped, not reported as failures, since "connecting unlocks
 * sending, reading works anonymously either way" means an unconnected
 * source was never a candidate to begin with.
 */
export async function sendChatMessage(sources: SourceConfig[], text: string): Promise<ChatSendResult[]> {
	const targets = sources.filter((s): s is SourceConfig & { connectionId: string } => !!s.connectionId);
	return Promise.all(targets.map((source) => sendToSource(source, text)));
}
