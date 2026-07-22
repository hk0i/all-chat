import { error } from '@sveltejs/kit';
import type { SourceConfig } from '@all-chat/contract';
import { newSourceId } from './profiles';

/** Validate a request body's sources array; assigns ids to new sources. */
export function normalizeSources(raw: unknown): SourceConfig[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw error(400, 'sources must be an array');
	return raw.map((entry) => {
		const source = entry as Partial<SourceConfig>;
		if (
			!source ||
			(source.platform !== 'twitch' &&
				source.platform !== 'kick' &&
				source.platform !== 'youtube' &&
				source.platform !== 'facebook')
		) {
			throw error(400, 'each source needs platform twitch|kick|youtube|facebook');
		}
		if (typeof source.channel !== 'string' || !source.channel.trim()) {
			throw error(400, 'each source needs a channel');
		}
		const connectionId =
			typeof source.connectionId === 'string' && source.connectionId.trim() ? source.connectionId.trim() : undefined;

		// Facebook has no anonymous read path (EDD-V2 §4) — channel is just the
		// Page's display name, so connectionId is what actually resolves to a
		// Page access token at ingestion time. Other platforms treat it as
		// optional — which connected account (if any) a source sends through
		// (EDD-V2 §5); absent means read-only, same as v1 behavior.
		if (source.platform === 'facebook' && !connectionId) {
			throw error(400, 'facebook sources need a connectionId (pick a connected Page)');
		}
		return {
			id: typeof source.id === 'string' && source.id ? source.id : newSourceId(),
			platform: source.platform,
			channel: source.channel.trim(),
			...(connectionId ? { connectionId } : {}),
			...(typeof source.label === 'string' && source.label ? { label: source.label } : {})
		};
	});
}
