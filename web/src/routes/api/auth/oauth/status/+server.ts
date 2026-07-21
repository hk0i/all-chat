import { json } from '@sveltejs/kit';
import type { PlatformConnectionInfo } from '@all-chat/contract';
import { listPlatformConnections } from '$lib/server/auth/config';
import { isProviderConfigured, type OAuthPlatform } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

const OAUTH_PLATFORMS: OAuthPlatform[] = ['twitch', 'youtube'];

export const GET: RequestHandler = async () => {
	const connections = await listPlatformConnections(OAUTH_PLATFORMS);
	const withConfigured: PlatformConnectionInfo[] = connections.map((c) => ({
		...c,
		configured: isProviderConfigured(c.platform as OAuthPlatform)
	}));
	return json(withConfigured);
};
