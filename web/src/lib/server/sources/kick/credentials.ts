import { reportProblem } from '../../alerts';
import {
	KICK_PUSHER_CLUSTER_HOST,
	KICK_PUSHER_FALLBACK_HOST,
	KICK_PUSHER_FALLBACK_KEY,
	KICK_REALTIME_CONNECTION_API
} from './constants';

export interface PusherCredentials {
	appKey: string;
	host: string;
	/** `env` = KICK_PUSHER_KEY, `kick` = Kick's realtime endpoint, `fallback` = built-in constant. */
	origin: 'env' | 'kick' | 'fallback';
}

interface RealtimeConnectionResponse {
	data?: {
		connections?: { provider?: string; credentials?: { app_key?: unknown; cluster?: unknown } }[];
	};
}

const FETCH_TIMEOUT_MS = 10_000;
const APP_KEY_PATTERN = /^[A-Za-z0-9]+$/;
/** The cluster becomes part of a hostname, so only a bare DNS label is accepted. */
const CLUSTER_PATTERN = /^[a-z0-9-]+$/;

const isAppKey = (value: unknown): value is string =>
	typeof value === 'string' && APP_KEY_PATTERN.test(value);
const isCluster = (value: unknown): value is string =>
	typeof value === 'string' && CLUSTER_PATTERN.test(value);

/** Asks Kick for its current Pusher app, offering Pusher only (offering Centrifugo makes Kick return that instead). */
export async function fetchPusherCredentials(fetchFn: typeof fetch = fetch): Promise<PusherCredentials> {
	const response = await fetchFn(KICK_REALTIME_CONNECTION_API, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({
			client: { id: crypto.randomUUID(), type: 'web' },
			capabilities: { accepted_providers: [{ provider: 'pusher' }] }
		}),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`kick realtime lookup failed with status ${response.status}`);
	}

	const body = (await response.json()) as RealtimeConnectionResponse | null;
	const pusher = body?.data?.connections?.find((connection) => connection.provider === 'pusher');
	const { app_key: appKey, cluster } = pusher?.credentials ?? {};
	if (!isAppKey(appKey) || !isCluster(cluster)) {
		throw new Error('kick realtime response has no usable pusher credentials (shape drift?)');
	}
	return { appKey, host: KICK_PUSHER_CLUSTER_HOST(cluster), origin: 'kick' };
}

const KICK_ANSWER_TTL_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAILED_FETCH_MS = 5 * 60 * 1000;
/** A key refused this soon after Kick handed it out means the answer is wrong, not stale. */
const FRESH_ANSWER_WINDOW_MS = 60 * 1000;

const FALLBACK_CREDENTIALS: PusherCredentials = {
	appKey: KICK_PUSHER_FALLBACK_KEY,
	host: KICK_PUSHER_FALLBACK_HOST,
	origin: 'fallback'
};

export interface CredentialSource {
	/** Credentials to try next (EDD-kick-credentials §4.2). Never rejects. */
	current(): Promise<PusherCredentials>;
	/** Pusher refused `appKey`; the next `current()` must not return it again. */
	reject(appKey: string): void;
}

export type ReportProblem = (problemId: string, message: string) => void;

interface CredentialStoreDeps {
	fetchCredentials: () => Promise<PusherCredentials>;
	env: Record<string, string | undefined>;
	now: () => number;
	report: ReportProblem;
}

export class KickCredentialStore implements CredentialSource {
	private readonly deps: CredentialStoreDeps;
	private envKeyRefused = false;
	private kickAnswer: PusherCredentials | undefined;
	private kickAnswerAt = 0;
	private nextFetchAt = 0;
	private inFlight: Promise<PusherCredentials> | undefined;

	constructor(deps: Partial<CredentialStoreDeps> = {}) {
		this.deps = {
			fetchCredentials: fetchPusherCredentials,
			env: process.env,
			now: Date.now,
			report: reportProblem,
			...deps
		};
	}

	async current(): Promise<PusherCredentials> {
		const fromEnv = this.envCredentials();
		if (fromEnv && !this.envKeyRefused) return fromEnv;

		const now = this.deps.now();
		if (this.kickAnswer && now - this.kickAnswerAt < KICK_ANSWER_TTL_MS) return this.kickAnswer;
		if (now < this.nextFetchAt) return this.standIn();

		this.inFlight ??= this.fetchKickAnswer().finally(() => {
			this.inFlight = undefined;
		});
		return this.inFlight;
	}

	reject(appKey: string): void {
		if (!this.envKeyRefused && this.envCredentials()?.appKey === appKey) {
			this.envKeyRefused = true;
			this.deps.report(
				'kick-env-key-refused',
				'KICK_PUSHER_KEY was refused by Pusher; fetching the current key from Kick. Update or remove KICK_PUSHER_KEY.'
			);
			return;
		}
		if (this.kickAnswer?.appKey !== appKey) return;

		if (this.deps.now() - this.kickAnswerAt < FRESH_ANSWER_WINDOW_MS) {
			this.deps.report(
				'kick-fetched-key-refused',
				'Pusher refused the chat key Kick just handed out; Kick chat cannot connect.'
			);
		}
		this.kickAnswer = undefined;
	}

	/** Read on every call: the secrets file fills process.env after module load. */
	private envCredentials(): PusherCredentials | undefined {
		const appKey = this.deps.env.KICK_PUSHER_KEY;
		if (!appKey) return undefined;
		return { appKey, host: this.deps.env.KICK_PUSHER_HOST || KICK_PUSHER_FALLBACK_HOST, origin: 'env' };
	}

	private async fetchKickAnswer(): Promise<PusherCredentials> {
		try {
			this.kickAnswer = await this.deps.fetchCredentials();
			this.kickAnswerAt = this.deps.now();
			return this.kickAnswer;
		} catch (error) {
			this.nextFetchAt = this.deps.now() + RETRY_AFTER_FAILED_FETCH_MS;
			const standIn = this.standIn();
			this.deps.report(
				'kick-key-fetch-failed',
				`could not fetch the chat key from Kick (${(error as Error).message}); using ${
					standIn.origin === 'fallback' ? 'the built-in fallback key' : 'the last known key'
				}`
			);
			return standIn;
		}
	}

	private standIn(): PusherCredentials {
		return this.kickAnswer ?? FALLBACK_CREDENTIALS;
	}
}

export const kickCredentials: CredentialSource = new KickCredentialStore();
