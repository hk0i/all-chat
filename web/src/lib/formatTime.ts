/**
 * Absolute, locale-formatted time for a message's timestamp. Takes a `Date`
 * rather than epoch ms so callers that also need e.g. `toISOString()` (the
 * feed's `<time datetime>` attribute) can share one `Date` instead of
 * constructing it twice. No relative ("2m ago") mode — that needs a ticking
 * interval, not worth it against a feed documented at 10k+ msg/min
 * (docs/2026-07-19-all-chat.edd.md §7).
 */
export function formatTimestamp(date: Date): string {
	return date.toLocaleTimeString();
}
