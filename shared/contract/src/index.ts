/**
 * @all-chat/contract — the wire-format contract between the All Chat gateway
 * and every client (web UI, OBS views, native mobile apps, bots).
 *
 * Licensed MIT (see LICENSE in this directory) so generated client types can
 * be embedded in any codebase. See docs/EDD.md §4.1 and §9.4.
 */

/** Bumped on any breaking change to the shapes below. Sent in the `hello` event. */
export const API_VERSION = 1;

export type Platform = 'twitch' | 'kick' | 'youtube';

export interface Profile {
	/** Stable slug, generated from name. */
	id: string;
	/** Display name, e.g. "Gaming", "Game Dev". */
	name: string;
	/** Ordered array — the same platform may repeat. */
	sources: SourceConfig[];
}

export interface SourceConfig {
	/** Stable per-source id (referenced by ChatMessage.sourceId). */
	id: string;
	platform: Platform;
	/** twitch/kick channel slug, or a YouTube URL / video ID / @handle. */
	channel: string;
	/** Optional display name, e.g. "Main Twitch", "Indie YT". */
	label?: string;
}

export type BadgeKind =
	| 'broadcaster'
	| 'moderator'
	| 'subscriber'
	| 'member'
	| 'verified'
	| 'vip'
	| 'og'
	| 'unknown';

export interface Badge {
	kind: BadgeKind;
	/** Platform-specific badge title, e.g. "6-Month Subscriber". */
	title?: string;
}

export type Fragment =
	| { kind: 'text'; text: string }
	| { kind: 'emote'; name: string; url: string };

export interface ChatAuthor {
	name: string;
	/**
	 * Account/login name, present only when it differs from `name` beyond
	 * case — e.g. Twitch localized display names (name "ぺっく", login
	 * "gmpekk"). Clients render it as a readable fallback: ぺっく (gmpekk).
	 */
	login?: string;
	/** Platform-provided hex color, or hash-derived by the server when absent upstream. */
	color?: string;
	/** Platform-provided avatar URL when available (YouTube in v1). Absent-friendly by design. */
	avatarUrl?: string;
	badges: Badge[];
}

export interface ChatMessage {
	/** Platform message id, or synthesized when the platform omits one. */
	id: string;
	/** Which SourceConfig produced this message. */
	sourceId: string;
	platform: Platform;
	/** Channel the message came from. */
	channel: string;
	/** Epoch milliseconds (arrival time if the platform omits it). */
	timestamp: number;
	author: ChatAuthor;
	/** Ordered text + emote fragments. */
	fragments: Fragment[];
}

export type SourceState = 'connecting' | 'live' | 'reconnecting' | 'failed';

/** SSE `hello` event — first event on every stream. */
export interface HelloEvent {
	apiVersion: number;
}

/** SSE `status` event — per-source connection state changes. */
export interface StatusEvent {
	sourceId: string;
	platform: Platform;
	channel: string;
	state: SourceState;
	/** Human-readable detail, present for `failed`/`reconnecting`. */
	detail?: string;
}

/** SSE `message` event payload is a ChatMessage. */
export type StreamEvent =
	| { event: 'hello'; data: HelloEvent }
	| { event: 'status'; data: StatusEvent }
	| { event: 'message'; data: ChatMessage };
