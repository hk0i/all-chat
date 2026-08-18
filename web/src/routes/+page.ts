import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Overlay moved to its own route (EDD §9); this keeps existing OBS
 * browser-source URLs (`/?overlay=1&...`) working by redirecting to
 * `/overlay` with the rest of the query string preserved.
 */
export const load: PageLoad = ({ url }) => {
	if (url.searchParams.get('overlay') !== '1') return;

	const target = new URLSearchParams(url.searchParams);
	target.delete('overlay');
	const query = target.toString();
	redirect(302, `/overlay${query ? `?${query}` : ''}`);
};
