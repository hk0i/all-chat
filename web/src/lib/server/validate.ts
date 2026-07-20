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
			(source.platform !== 'twitch' && source.platform !== 'kick' && source.platform !== 'youtube')
		) {
			throw error(400, 'each source needs platform twitch|kick|youtube');
		}
		if (typeof source.channel !== 'string' || !source.channel.trim()) {
			throw error(400, 'each source needs a channel');
		}
		return {
			id: typeof source.id === 'string' && source.id ? source.id : newSourceId(),
			platform: source.platform,
			channel: source.channel.trim(),
			...(typeof source.label === 'string' && source.label ? { label: source.label } : {})
		};
	});
}
