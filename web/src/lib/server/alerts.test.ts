import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemReporter } from './alerts';

const WEBHOOK_URL = 'https://discord.example/webhook';
const HOUR_MS = 60 * 60 * 1000;
const DISCORD_CONTENT_LIMIT = 2000;

/** Lets the fire-and-forget post settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProblemReporter', () => {
	let clock: number;
	let fetchFn: ReturnType<typeof vi.fn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	const newReporter = (env: Record<string, string | undefined> = { ALERT_DISCORD_WEBHOOK_URL: WEBHOOK_URL }) =>
		new ProblemReporter({ fetchFn: fetchFn as unknown as typeof fetch, env, now: () => clock });

	beforeEach(() => {
		clock = 1_000_000;
		fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('logs without posting when no webhook URL is set', async () => {
		newReporter({}).report('p1', 'something broke');
		await flush();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('posts the message to the webhook without allowing mentions', async () => {
		newReporter().report('p1', 'something broke');
		await flush();
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe(WEBHOOK_URL);
		const body = JSON.parse(init.body);
		expect(body.content).toContain('something broke');
		expect(body.allowed_mentions.parse).toEqual([]);
	});

	it('posts the same problem once within an hour but logs every time', async () => {
		const reporter = newReporter();
		reporter.report('p1', 'again');
		clock += HOUR_MS - 1;
		reporter.report('p1', 'again');
		await flush();
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(2);
	});

	it('posts the same problem again after an hour', async () => {
		const reporter = newReporter();
		reporter.report('p1', 'again');
		clock += HOUR_MS;
		reporter.report('p1', 'again');
		await flush();
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('posts different problems independently', async () => {
		const reporter = newReporter();
		reporter.report('p1', 'one');
		reporter.report('p2', 'two');
		await flush();
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('survives a failed post without logging the webhook URL', async () => {
		fetchFn.mockRejectedValue(new Error(`connect failed for ${WEBHOOK_URL}`));
		expect(() => newReporter().report('p1', 'something broke')).not.toThrow();
		await flush();
		const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
		expect(logged).not.toContain(WEBHOOK_URL);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it('truncates content to the Discord limit', async () => {
		newReporter().report('p1', 'x'.repeat(DISCORD_CONTENT_LIMIT + 500));
		await flush();
		const body = JSON.parse(fetchFn.mock.calls[0][1].body);
		expect(body.content).toHaveLength(DISCORD_CONTENT_LIMIT);
	});
});
