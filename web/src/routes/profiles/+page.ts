import type { PlatformProviderStatus, Profile } from '@all-chat/contract';
import type { PageLoad } from './$types';

/**
 * Loads profiles through the public REST API (not a direct store import) so
 * this page exercises the exact surface native clients use (EDD §3.2).
 * Also loads platform connections — facebook sources pick a connected Page
 * here rather than typing a channel (EDD-V2 §4: no anonymous read).
 */
export const load: PageLoad = async ({ fetch }) => {
	const [profilesResponse, overlayResponse, oauthResponse] = await Promise.all([
		fetch('/api/profiles'),
		fetch('/api/overlay-profile'),
		fetch('/api/auth/oauth/status')
	]);
	const { profileId } = (await overlayResponse.json()) as { profileId: string | null };
	return {
		profiles: (await profilesResponse.json()) as Profile[],
		overlayProfileId: profileId,
		platformProviders: (await oauthResponse.json()) as PlatformProviderStatus[]
	};
};
