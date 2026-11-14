const DISCORD_COOLDOWN_MS = 60 * 60 * 1000;
const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_TIMEOUT_MS = 10_000;

interface ProblemReporterDeps {
	fetchFn: typeof fetch;
	env: Record<string, string | undefined>;
	now: () => number;
}

/** Logs every problem; also posts it to `ALERT_DISCORD_WEBHOOK_URL`, at most once per problem id per hour. */
export class ProblemReporter {
	private readonly deps: ProblemReporterDeps;
	private readonly lastPostedAt = new Map<string, number>();

	constructor(deps: Partial<ProblemReporterDeps> = {}) {
		this.deps = { fetchFn: fetch, env: process.env, now: Date.now, ...deps };
	}

	report(problemId: string, message: string): void {
		console.error(`[alert] ${message}`);

		const webhookUrl = this.deps.env.ALERT_DISCORD_WEBHOOK_URL;
		if (!webhookUrl) return;

		const now = this.deps.now();
		const lastPostedAt = this.lastPostedAt.get(problemId);
		if (lastPostedAt !== undefined && now - lastPostedAt < DISCORD_COOLDOWN_MS) return;
		this.lastPostedAt.set(problemId, now);

		void this.postToDiscord(webhookUrl, message);
	}

	private async postToDiscord(webhookUrl: string, message: string): Promise<void> {
		try {
			const response = await this.deps.fetchFn(webhookUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					content: `**All Chat** ${message}`.slice(0, DISCORD_CONTENT_LIMIT),
					allowed_mentions: { parse: [] }
				}),
				signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS)
			});
			if (!response.ok) console.warn(`[alert] discord webhook answered ${response.status}`);
		} catch (error) {
			// The webhook URL is a secret: log the error name only, never the URL or full error.
			console.warn(`[alert] discord webhook unreachable (${(error as Error).name})`);
		}
	}
}

const reporter = new ProblemReporter();

export const reportProblem = (problemId: string, message: string): void => reporter.report(problemId, message);
