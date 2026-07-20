/**
 * Resolve user input — a video URL, a bare video ID, or a channel
 * handle — to the video ID of the channel's current livestream (EDD §3.3).
 *
 * In:  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" → "dQw4w9WgXcQ"
 * In:  "dQw4w9WgXcQ"                                 → "dQw4w9WgXcQ"
 * In:  "@somechannel" (currently live)               → live video id, via
 *      the youtube.com/@handle/live redirect
 *
 * Video IDs are 11 chars of [A-Za-z0-9_-]. Handle resolution requires a
 * network fetch; URL/ID forms are parsed locally.
 */

/** 11-character YouTube video id. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export class YouTubeResolveError extends Error {
	constructor(
		message: string,
		/** True when the channel exists but is not currently live. */
		readonly notLive = false
	) {
		super(message);
	}
}

/** Extract a video id from URL or bare-id input without any network I/O. Returns undefined for handles. */
export function parseVideoIdInput(input: string): string | undefined {
	const trimmed = input.trim();
	if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

	let url: URL;
	try {
		url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
	} catch {
		return undefined;
	}
	if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)) return undefined;

	// youtu.be/<id>, youtube.com/watch?v=<id>, /live/<id>, /shorts/<id>
	if (url.hostname.endsWith('youtu.be')) {
		const id = url.pathname.slice(1);
		return VIDEO_ID_PATTERN.test(id) ? id : undefined;
	}
	const v = url.searchParams.get('v');
	if (v && VIDEO_ID_PATTERN.test(v)) return v;
	const pathMatch = /^\/(?:live|shorts)\/([A-Za-z0-9_-]{11})(?:\/|$)/.exec(url.pathname);
	if (pathMatch) return pathMatch[1];
	return undefined;
}

/** Extract a channel handle ("@name") from input, if that's what it is. */
export function parseHandleInput(input: string): string | undefined {
	const trimmed = input.trim();
	if (/^@[\w.-]{3,}$/.test(trimmed)) return trimmed;
	// Also accept youtube.com/@handle URLs.
	try {
		const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
		if (!/(^|\.)youtube\.com$/.test(url.hostname)) return undefined;
		const match = /^\/(@[\w.-]{3,})(?:\/|$)/.exec(url.pathname);
		return match?.[1];
	} catch {
		return undefined;
	}
}

/**
 * Resolve a handle to the current live video id by fetching
 * youtube.com/@handle/live and reading the canonical watch URL out of the
 * response HTML. Not live → YouTubeResolveError with notLive: true.
 */
export async function resolveHandleToLiveVideoId(
	handle: string,
	fetchFn: typeof fetch = fetch
): Promise<string> {
	const response = await fetchFn(`https://www.youtube.com/${handle}/live`, {
		headers: { 'accept-language': 'en' },
		redirect: 'follow'
	});
	if (response.status === 404) throw new YouTubeResolveError(`channel ${handle} not found`);
	if (!response.ok) throw new YouTubeResolveError(`youtube returned ${response.status} for ${handle}`);

	const html = await response.text();
	// The live page embeds its own watch URL as canonical.
	const canonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/.exec(html);
	if (canonical) return canonical[1];
	throw new YouTubeResolveError(`${handle} is not live right now`, true);
}

/** Full resolution: URL/ID handled locally, handles via network. */
export async function resolveInput(input: string, fetchFn: typeof fetch = fetch): Promise<string> {
	const videoId = parseVideoIdInput(input);
	if (videoId) return videoId;
	const handle = parseHandleInput(input);
	if (handle) return resolveHandleToLiveVideoId(handle, fetchFn);
	throw new YouTubeResolveError(`cannot interpret "${input}" as a video URL, video id, or @handle`);
}
