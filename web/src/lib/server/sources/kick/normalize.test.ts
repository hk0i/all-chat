import { describe, expect, it } from 'vitest';
import { hashColor } from '../color';
import { kickEventToChatMessage } from './normalize';

/** Recorded-shape fixture (fields trimmed to the ones we consume). */
const FULL_EVENT = {
	id: 'k-msg-1',
	chatroom_id: 12345,
	content: 'gg [emote:37225:EZ] well played [emote:11111:PogU]',
	type: 'message',
	created_at: '2026-07-19T12:34:56+00:00',
	sender: {
		id: 789,
		username: 'NightViewer',
		slug: 'nightviewer',
		identity: {
			color: '#8A2BE2',
			badges: [
				{ type: 'moderator', text: 'Moderator' },
				{ type: 'subscriber', text: 'Subscriber', count: 6 },
				{ type: 'sub_gifter', text: 'Sub Gifter', count: 50 }
			]
		}
	}
};

describe('kickEventToChatMessage', () => {
	it('normalizes a full event', () => {
		const message = kickEventToChatMessage(FULL_EVENT, 'src-k', 'gmpekk');
		expect(message).toMatchObject({
			id: 'k-msg-1',
			sourceId: 'src-k',
			platform: 'kick',
			channel: 'gmpekk',
			timestamp: Date.parse('2026-07-19T12:34:56+00:00'),
			author: { name: 'NightViewer', color: '#8A2BE2' }
		});
		expect(message?.author.badges).toEqual([
			{ kind: 'moderator', title: 'Moderator' },
			{ kind: 'subscriber', title: '6-month subscriber' },
			{ kind: 'unknown', title: 'Sub Gifter' }
		]);
	});

	it('splits emote placeholders into fragments', () => {
		const message = kickEventToChatMessage(FULL_EVENT, 's', 'c');
		expect(message?.fragments).toEqual([
			{ kind: 'text', text: 'gg ' },
			{ kind: 'emote', name: 'EZ', url: 'https://files.kick.com/emotes/37225/fullsize' },
			{ kind: 'text', text: ' well played ' },
			{ kind: 'emote', name: 'PogU', url: 'https://files.kick.com/emotes/11111/fullsize' }
		]);
	});

	it('hash-derives a color when identity.color is missing', () => {
		const message = kickEventToChatMessage(
			{ id: 'x', content: 'hi', type: 'message', sender: { username: 'plain' } },
			's',
			'c'
		);
		expect(message?.author.color).toBe(hashColor('plain'));
	});

	it('accepts replies, skips non-message event types', () => {
		const base = { id: 'x', content: 'hi', sender: { username: 'u' } };
		expect(kickEventToChatMessage({ ...base, type: 'reply' }, 's', 'c')).toBeDefined();
		expect(kickEventToChatMessage({ ...base, type: 'celebration' }, 's', 'c')).toBeUndefined();
	});

	it('rejects malformed payloads', () => {
		expect(kickEventToChatMessage(null, 's', 'c')).toBeUndefined();
		expect(kickEventToChatMessage({}, 's', 'c')).toBeUndefined();
		expect(kickEventToChatMessage({ content: 'hi' }, 's', 'c')).toBeUndefined(); // no sender
	});

	it('synthesizes id and timestamp when absent', () => {
		const message = kickEventToChatMessage(
			{ content: 'hi', sender: { username: 'u' } },
			's',
			'chan'
		);
		expect(message?.id).toMatch(/^kick-chan-\d+-u$/);
		expect(message?.timestamp).toBeGreaterThan(0);
	});
});
