import { error } from '@sveltejs/kit';
import { API_VERSION, type ChatMessage, type Platform, type SourceConfig, type StatusEvent } from '@all-chat/contract';
import { sourceManager } from '$lib/server/manager';
import { findProfile } from '$lib/server/profiles';
import type { RequestHandler } from './$types';

const PLATFORMS: Platform[] = ['twitch', 'kick', 'youtube'];

const encoder = new TextEncoder();

const sseEvent = (event: string, data: unknown) =>
	encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** Parse repeated ad-hoc `source=platform:channel` params (EDD §3.4). */
function parseAdHocSources(params: URLSearchParams): SourceConfig[] {
	return params.getAll('source').map((raw, index) => {
		const colon = raw.indexOf(':');
		if (colon === -1) throw error(400, `source must be platform:channel, got "${raw}"`);
		const platform = raw.slice(0, colon) as Platform;
		const channel = raw.slice(colon + 1);
		if (!PLATFORMS.includes(platform)) throw error(400, `unknown platform "${platform}"`);
		if (!channel) throw error(400, `missing channel in "${raw}"`);
		return { id: `adhoc-${index}`, platform, channel };
	});
}

export const GET: RequestHandler = async ({ url, request }) => {
	let sources: SourceConfig[];

	const profileParam = url.searchParams.get('profile');
	if (profileParam) {
		const profile = await findProfile(profileParam);
		if (!profile) throw error(404, `profile "${profileParam}" not found`);
		sources = profile.sources;
	} else {
		sources = parseAdHocSources(url.searchParams);
	}
	if (sources.length === 0) throw error(400, 'no sources: pass ?profile= or one or more ?source=platform:channel');

	// v2 auth will validate ?token= here; accepted-and-ignored in v1 (EDD §6.1).

	let cleanup: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const push = (event: string, data: unknown) => {
				try {
					controller.enqueue(sseEvent(event, data));
				} catch {
					// Controller already closed; unsubscribe handles the rest.
				}
			};

			push('hello', { apiVersion: API_VERSION });

			const unsubscribe = sourceManager.subscribe(
				{
					onMessage: (message: ChatMessage) => push('message', message),
					onStatus: (status: StatusEvent) => push('status', status)
				},
				sources
			);

			// SSE comment as keep-alive so proxies don't idle the connection out.
			heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
				} catch {
					/* closed */
				}
			}, 25000);

			cleanup = () => {
				unsubscribe();
				if (heartbeat !== undefined) clearInterval(heartbeat);
			};

			request.signal.addEventListener('abort', () => {
				cleanup?.();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			cleanup?.();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-AllChat-API': String(API_VERSION)
		}
	});
};
