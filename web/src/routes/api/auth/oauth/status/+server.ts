import { json } from '@sveltejs/kit';
import type { PlatformProviderStatus } from '@all-chat/contract';
import { listPlatformConnections } from '$lib/server/auth/config';
import { isProviderConfigured, type OAuthPlatform } from '$lib/server/auth/providers';
import type { RequestHandler } from './$types';

const OAUTH_PLATFORMS: OAuthPlatform[] = ['twitch', 'youtube'];

export const GET: RequestHandler = async () => {
	const statuses: PlatformProviderStatus[] = await Promise.all(
		OAUTH_PLATFORMS.map(async (platform) => ({
			platform,
			configured: isProviderConfigured(platform),
			connections: await listPlatformConnections(platform)
		}))
	);
	return json(statuses);
};
