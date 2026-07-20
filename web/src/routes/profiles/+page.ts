import type { Profile } from '@all-chat/contract';
import type { PageLoad } from './$types';

/**
 * Loads profiles through the public REST API (not a direct store import) so
 * this page exercises the exact surface native clients use (EDD §3.2).
 */
export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/profiles');
	return { profiles: (await response.json()) as Profile[] };
};
