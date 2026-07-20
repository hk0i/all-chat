import { afterEach, describe, expect, it, vi } from 'vitest';
import { KickLookupError, clearLookupCache, lookupChatroomId } from './lookup';

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => clearLookupCache());

describe('lookupChatroomId', () => {
	it('resolves chatroom.id and caches by lowercased slug', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { chatroom: { id: 12345 } }));
		expect(await lookupChatroomId('GMPekk', fetchFn)).toBe(12345);
		expect(await lookupChatroomId('gmpekk', fetchFn)).toBe(12345);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn.mock.calls[0][0]).toContain('/channels/gmpekk');
	});

	it('flags Cloudflare-ish statuses as blocked', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('challenge', { status: 403 }));
		await expect(lookupChatroomId('x', fetchFn)).rejects.toMatchObject({ blocked: true, status: 403 });
	});

	it('maps 404 to not-blocked with status', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
		await expect(lookupChatroomId('missing', fetchFn)).rejects.toMatchObject({
			blocked: false,
			status: 404
		});
	});

	it('rejects on shape drift', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { chatroom: {} }));
		await expect(lookupChatroomId('x', fetchFn)).rejects.toBeInstanceOf(KickLookupError);
	});

	it('does not cache failures', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response('challenge', { status: 403 }))
			.mockResolvedValueOnce(jsonResponse(200, { chatroom: { id: 7 } }));
		await expect(lookupChatroomId('x', fetchFn)).rejects.toBeInstanceOf(KickLookupError);
		expect(await lookupChatroomId('x', fetchFn)).toBe(7);
	});
});
