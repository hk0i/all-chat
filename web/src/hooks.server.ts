import type { Handle } from '@sveltejs/kit';

/**
 * Single request choke point. v1: pass-through. v2 auth (EDD §6.1) lands
 * here — session cookies, bearer tokens, and read-only URL tokens are all
 * checked in this one place.
 */
export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
