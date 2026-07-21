import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/auth/status');
	const { enabled } = (await response.json()) as { enabled: boolean };
	return { enabled };
};
