import type { BearerTokenInfo, Profile, UrlTokenInfo } from '@all-chat/contract';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [bearerResponse, urlResponse, profilesResponse] = await Promise.all([
		fetch('/api/auth/tokens/bearer'),
		fetch('/api/auth/tokens/url'),
		fetch('/api/profiles')
	]);
	return {
		bearerTokens: (await bearerResponse.json()) as BearerTokenInfo[],
		urlTokens: (await urlResponse.json()) as UrlTokenInfo[],
		profiles: (await profilesResponse.json()) as Profile[]
	};
};
