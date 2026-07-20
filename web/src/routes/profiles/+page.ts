import type { Profile } from '@all-chat/contract';
import type { PageLoad } from './$types';

/**
 * Loads profiles through the public REST API (not a direct store import) so
 * this page exercises the exact surface native clients use (EDD §3.2).
 */
export const load: PageLoad = async ({ fetch }) => {
	const [profilesResponse, overlayResponse] = await Promise.all([
		fetch('/api/profiles'),
		fetch('/api/overlay-profile')
	]);
	const { profileId } = (await overlayResponse.json()) as { profileId: string | null };
	return {
		profiles: (await profilesResponse.json()) as Profile[],
		overlayProfileId: profileId
	};
};
