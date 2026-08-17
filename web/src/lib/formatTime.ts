/**
 * Absolute, locale-formatted time for a `ChatMessage.timestamp` (epoch ms).
 * No relative ("2m ago") mode — that needs a ticking interval, not worth it
 * against a feed documented at 10k+ msg/min (docs/EDD.md §7).
 */
export function formatTimestamp(ms: number): string {
	return new Date(ms).toLocaleTimeString();
}
