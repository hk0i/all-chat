import { KICK_CHANNEL_API } from './constants';

/**
 * Resolve a Kick channel slug to its chatroom id via the unofficial channel
 * API. Results are cached for the process lifetime — chatroom ids are
 * stable per channel.
 *
 * The endpoint sits behind Cloudflare and may reject non-browser clients
 * (especially from datacenter IPs); callers surface that as a prompt for
 * manual chatroom-id entry (EDD §3.2).
 */

const cache = new Map<string, number>();

export class KickLookupError extends Error {
	constructor(
		message: string,
		/** True when the failure smells like a Cloudflare block rather than a missing channel. */
		readonly blocked: boolean,
		readonly status?: number
	) {
		super(message);
	}
}

export async function lookupChatroomId(
	slug: string,
	fetchFn: typeof fetch = fetch
): Promise<number> {
	const key = slug.toLowerCase();
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	let response: Response;
	try {
		response = await fetchFn(KICK_CHANNEL_API(key), {
			headers: {
				accept: 'application/json',
				// A browser-ish UA measurably lowers Cloudflare challenge rates here.
				'user-agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
			}
		});
	} catch (error) {
		throw new KickLookupError(`kick.com unreachable: ${(error as Error).message}`, false);
	}

	if (response.status === 403 || response.status === 429 || response.status === 503) {
		throw new KickLookupError('kick.com refused the lookup (likely Cloudflare)', true, response.status);
	}
	if (response.status === 404) {
		throw new KickLookupError(`kick channel "${key}" not found`, false, 404);
	}
	if (!response.ok) {
		throw new KickLookupError(`kick lookup failed with status ${response.status}`, false, response.status);
	}

	const body = (await response.json().catch(() => null)) as { chatroom?: { id?: number } } | null;
	const id = body?.chatroom?.id;
	if (typeof id !== 'number') {
		throw new KickLookupError('kick lookup response missing chatroom.id (shape drift?)', false);
	}

	cache.set(key, id);
	return id;
}

/** Test/ops hook. */
export function clearLookupCache(): void {
	cache.clear();
}
