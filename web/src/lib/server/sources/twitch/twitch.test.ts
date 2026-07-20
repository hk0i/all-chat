import { describe, expect, it } from 'vitest';
import { loginFromPrefix, parseIrcLine } from './irc';
import { hashColor, privmsgToChatMessage } from './normalize';

// Recorded-shape fixture lines (tags trimmed to the ones we consume).
const PRIVMSG_FULL =
	'@badge-info=subscriber/8;badges=subscriber/6,vip/1;color=#8A2BE2;display-name=NightViewer;' +
	'emotes=25:4-8/1902:16-20;id=abc-123;tmi-sent-ts=1784000000000 ' +
	':nightviewer!nightviewer@nightviewer.tmi.twitch.tv PRIVMSG #gmpekk :yo! Kappa hello Keepo end';

const PRIVMSG_PLAIN =
	'@color=;display-name=Casual;id=def-456;tmi-sent-ts=1784000000001 ' +
	':casual!casual@casual.tmi.twitch.tv PRIVMSG #gmpekk :plain message';

const PING = 'PING :tmi.twitch.tv';

describe('parseIrcLine', () => {
	it('parses tags, prefix, command, and trailing param', () => {
		const line = parseIrcLine(PRIVMSG_FULL);
		expect(line?.command).toBe('PRIVMSG');
		expect(line?.tags['display-name']).toBe('NightViewer');
		expect(line?.params).toEqual(['#gmpekk', 'yo! Kappa hello Keepo end']);
		expect(loginFromPrefix(line?.prefix)).toBe('nightviewer');
	});

	it('parses commands without tags or prefix', () => {
		const line = parseIrcLine(PING);
		expect(line?.command).toBe('PING');
		expect(line?.params).toEqual(['tmi.twitch.tv']);
	});

	it('unescapes tag values', () => {
		const line = parseIrcLine('@system-msg=hi\\sthere\\n;empty= :x NOTICE #c :m');
		expect(line?.tags['system-msg']).toBe('hi there\n');
		expect(line?.tags.empty).toBe('');
	});

	it('returns undefined for blank input', () => {
		expect(parseIrcLine('\r\n')).toBeUndefined();
	});
});

describe('privmsgToChatMessage', () => {
	it('normalizes a full-tagged message', () => {
		const message = privmsgToChatMessage(parseIrcLine(PRIVMSG_FULL)!, 'src-1');
		expect(message).toMatchObject({
			id: 'abc-123',
			sourceId: 'src-1',
			platform: 'twitch',
			channel: 'gmpekk',
			timestamp: 1784000000000,
			author: { name: 'NightViewer', color: '#8A2BE2' }
		});
		expect(message?.author.badges).toEqual([
			{ kind: 'subscriber', title: '8-month subscriber' },
			{ kind: 'vip' }
		]);
	});

	it('splits emote ranges into fragments', () => {
		const message = privmsgToChatMessage(parseIrcLine(PRIVMSG_FULL)!, 'src-1');
		expect(message?.fragments).toEqual([
			{ kind: 'text', text: 'yo! ' },
			{ kind: 'emote', name: 'Kappa', url: expect.stringContaining('/25/') },
			{ kind: 'text', text: ' hello ' },
			{ kind: 'emote', name: 'Keepo', url: expect.stringContaining('/1902/') },
			{ kind: 'text', text: ' end' }
		]);
	});

	it('indexes emote ranges by code points, not UTF-16 units', () => {
		// "🎉🎉 Kappa" — Kappa at code-point range 3-7 (emoji are 1 code point each).
		const raw =
			'@emotes=25:3-7;id=e1;tmi-sent-ts=1784000000002 ' +
			':u!u@u.tmi.twitch.tv PRIVMSG #c :\u{1F389}\u{1F389} Kappa';
		const message = privmsgToChatMessage(parseIrcLine(raw)!, 's');
		expect(message?.fragments).toEqual([
			{ kind: 'text', text: '\u{1F389}\u{1F389} ' },
			{ kind: 'emote', name: 'Kappa', url: expect.stringContaining('/25/') }
		]);
	});

	it('hash-derives a stable color when the tag is empty', () => {
		const message = privmsgToChatMessage(parseIrcLine(PRIVMSG_PLAIN)!, 's');
		expect(message?.author.color).toBe(hashColor('casual'));
		expect(message?.author.color).toMatch(/^hsl\(/);
	});

	it('unwraps /me ACTION messages', () => {
		const raw =
			'@id=a1;tmi-sent-ts=1784000000003 :u!u@u.tmi.twitch.tv PRIVMSG #c :\x01ACTION waves\x01';
		const message = privmsgToChatMessage(parseIrcLine(raw)!, 's');
		expect(message?.fragments).toEqual([{ kind: 'text', text: 'waves' }]);
	});

	it('ignores non-PRIVMSG lines', () => {
		expect(privmsgToChatMessage(parseIrcLine(PING)!, 's')).toBeUndefined();
	});
});
