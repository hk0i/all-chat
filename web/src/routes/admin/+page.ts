import type { BearerTokenInfo, Profile, UrlTokenInfo } from '@all-chat/contract';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [bearerResponse, urlResponse, profilesResponse, statusResponse] = await Promise.all([
		fetch('/api/auth/tokens/bearer'),
		fetch('/api/auth/tokens/url'),
		fetch('/api/profiles'),
		fetch('/api/auth/status')
	]);
	const { enabled } = (await statusResponse.json()) as { enabled: boolean };
	return {
		bearerTokens: (await bearerResponse.json()) as BearerTokenInfo[],
		urlTokens: (await urlResponse.json()) as UrlTokenInfo[],
		profiles: (await profilesResponse.json()) as Profile[],
		authEnabled: enabled
	};
};
