import { describe, expect, it, vi } from 'vitest';
import {
	YouTubeResolveError,
	parseHandleInput,
	parseVideoIdInput,
	resolveHandleToLiveVideoId,
	resolveInput
} from './resolve';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('parseVideoIdInput', () => {
	it('accepts bare ids and common URL shapes', () => {
		expect(parseVideoIdInput(VIDEO_ID)).toBe(VIDEO_ID);
		expect(parseVideoIdInput(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
		expect(parseVideoIdInput(`youtube.com/watch?v=${VIDEO_ID}&t=42`)).toBe(VIDEO_ID);
		expect(parseVideoIdInput(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
		expect(parseVideoIdInput(`https://www.youtube.com/live/${VIDEO_ID}`)).toBe(VIDEO_ID);
	});

	it('rejects handles, non-youtube URLs, and junk', () => {
		expect(parseVideoIdInput('@somechannel')).toBeUndefined();
		expect(parseVideoIdInput(`https://example.com/watch?v=${VIDEO_ID}`)).toBeUndefined();
		expect(parseVideoIdInput('not a video')).toBeUndefined();
		expect(parseVideoIdInput('shortid')).toBeUndefined();
	});
});

describe('parseHandleInput', () => {
	it('accepts @handles and youtube.com/@handle URLs', () => {
		expect(parseHandleInput('@somechannel')).toBe('@somechannel');
		expect(parseHandleInput('https://www.youtube.com/@somechannel')).toBe('@somechannel');
		expect(parseHandleInput('https://www.youtube.com/@somechannel/live')).toBe('@somechannel');
	});

	it('rejects video ids and non-youtube URLs', () => {
		expect(parseHandleInput(VIDEO_ID)).toBeUndefined();
		expect(parseHandleInput('https://example.com/@x')).toBeUndefined();
	});
});

describe('resolveHandleToLiveVideoId', () => {
	it('extracts the canonical watch URL from the live page', async () => {
		const html = `<html><link rel="canonical" href="https://www.youtube.com/watch?v=${VIDEO_ID}"></html>`;
		const fetchFn = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
		expect(await resolveHandleToLiveVideoId('@chan', fetchFn)).toBe(VIDEO_ID);
		expect(fetchFn.mock.calls[0][0]).toBe('https://www.youtube.com/@chan/live');
	});

	it('flags not-live channels distinctly', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('<html>no canonical</html>', { status: 200 }));
		await expect(resolveHandleToLiveVideoId('@chan', fetchFn)).rejects.toMatchObject({ notLive: true });
	});

	it('maps 404 to channel-not-found', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
		await expect(resolveHandleToLiveVideoId('@chan', fetchFn)).rejects.toThrow(/not found/);
	});
});

describe('resolveInput', () => {
	it('short-circuits URL/id forms without network', async () => {
		const fetchFn = vi.fn();
		expect(await resolveInput(VIDEO_ID, fetchFn)).toBe(VIDEO_ID);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('rejects uninterpretable input', async () => {
		await expect(resolveInput('%%%', vi.fn())).rejects.toBeInstanceOf(YouTubeResolveError);
	});
});
