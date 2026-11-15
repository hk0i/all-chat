import { describe, expect, it, vi } from 'vitest';
import { KICK_CHANNEL_API, KickChannelError, parseKickChannel, resolveKickChatroom } from './kickChannel';

describe('parseKickChannel', () => {
	it.each(['', '   '])('treats %j as empty', (input) => {
		expect(parseKickChannel(input)).toEqual({ kind: 'empty' });
	});

	it.each(['424242', ' 424242 '])('treats %j as a chatroom id', (input) => {
		expect(parseKickChannel(input)).toEqual({ kind: 'chatroomId' });
	});

	it('accepts a bare slug', () => {
		expect(parseKickChannel('somestreamer')).toEqual({ kind: 'slug', slug: 'somestreamer' });
	});

	it('lowercases the slug', () => {
		expect(parseKickChannel('SomeStreamer')).toEqual({ kind: 'slug', slug: 'somestreamer' });
	});

	it.each(['kick.com/somestreamer', 'https://kick.com/somestreamer', 'https://www.kick.com/somestreamer/'])(
		'extracts the slug from %j',
		(input) => {
			expect(parseKickChannel(input)).toEqual({ kind: 'slug', slug: 'somestreamer' });
		}
	);

	it('parses an all-digit channel URL as a slug', () => {
		expect(parseKickChannel('kick.com/12345')).toEqual({ kind: 'slug', slug: '12345' });
	});

	it.each(['kick.com/somestreamer?x=1', 'kick.com/popout/somestreamer/chat', 'some streamer', 'kick.com'])(
		'rejects %j',
		(input) => {
			expect(parseKickChannel(input)).toEqual({ kind: 'invalid' });
		}
	);
});

describe('resolveKickChatroom', () => {
	const NO_ID = `didn't return a chatroom id`;

	it('resolves the chatroom id', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ chatroom: { id: 424242 } })));
		await expect(resolveKickChatroom('somestreamer', fetchFn)).resolves.toBe(424242);
		expect(fetchFn.mock.calls[0][0]).toBe(KICK_CHANNEL_API('somestreamer'));
	});

	it('rejects a 404 as an unknown channel', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
		const failure = resolveKickChatroom('somestreamer', fetchFn);
		await expect(failure).rejects.toBeInstanceOf(KickChannelError);
		await expect(failure).rejects.toThrow('No Kick channel named "somestreamer"');
	});

	it.each([
		['a 403', () => new Response('', { status: 403 })],
		['a body without a chatroom id', () => new Response('{}')],
		['a non-JSON body', () => new Response('<html>')]
	])('rejects %s', async (_name, makeResponse) => {
		const fetchFn = vi.fn().mockResolvedValue(makeResponse());
		const failure = resolveKickChatroom('somestreamer', fetchFn);
		await expect(failure).rejects.toBeInstanceOf(KickChannelError);
		await expect(failure).rejects.toThrow(NO_ID);
	});

	it('rejects when the request fails', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new TypeError('network'));
		const failure = resolveKickChatroom('somestreamer', fetchFn);
		await expect(failure).rejects.toBeInstanceOf(KickChannelError);
		await expect(failure).rejects.toThrow(`Couldn't reach kick.com`);
	});
});
