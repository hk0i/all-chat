/**
 * Minimal IRCv3 line parser — only what Twitch chat needs (EDD §3.1).
 *
 * Wire format: `[@tags] [:prefix] COMMAND [params] [:trailing]`
 *
 * Example — one real chat message as Twitch sends it:
 *
 *   @badges=moderator/1;color=#FF4500;display-name=Foo;id=uuid;tmi-sent-ts=1700000000000
 *     :foo!foo@foo.tmi.twitch.tv PRIVMSG #somechannel :hello world
 *
 * (single line on the wire; wrapped here for readability) parses to:
 *
 *   {
 *     tags: { badges: 'moderator/1', color: '#FF4500', 'display-name': 'Foo',
 *             id: 'uuid', 'tmi-sent-ts': '1700000000000' },
 *     prefix: 'foo!foo@foo.tmi.twitch.tv',
 *     command: 'PRIVMSG',
 *     params: ['#somechannel', 'hello world']
 *   }
 *
 * References:
 * - Twitch IRC overview:     https://dev.twitch.tv/docs/chat/irc/
 * - Twitch tag definitions:  https://dev.twitch.tv/docs/chat/irc/#tags
 * - IRCv3 message-tags spec: https://ircv3.net/specs/extensions/message-tags.html
 *   (defines the `@key=value;…` prefix and the escaping rules in
 *   `unescapeTagValue` below)
 * - Base IRC grammar:        RFC 1459 §2.3.1
 */

export interface IrcLine {
	tags: Record<string, string>;
	/** Sender prefix without the leading ':', e.g. "nick!user@host". */
	prefix?: string;
	command: string;
	/** Middle params plus the trailing param (if any) as the last element. */
	params: string[];
}

/** IRCv3 tag value unescaping: \s \: \\ \r \n */
function unescapeTagValue(value: string): string {
	let out = '';
	for (let i = 0; i < value.length; i++) {
		if (value[i] !== '\\') {
			out += value[i];
			continue;
		}
		const next = value[++i];
		if (next === 's') out += ' ';
		else if (next === ':') out += ';';
		else if (next === '\\') out += '\\';
		else if (next === 'r') out += '\r';
		else if (next === 'n') out += '\n';
		else if (next !== undefined) out += next;
	}
	return out;
}

export function parseIrcLine(raw: string): IrcLine | undefined {
	let rest = raw.replace(/\r?\n$/, '');
	if (!rest) return undefined;

	const tags: Record<string, string> = {};
	if (rest.startsWith('@')) {
		const space = rest.indexOf(' ');
		if (space === -1) return undefined;
		for (const pair of rest.slice(1, space).split(';')) {
			const eq = pair.indexOf('=');
			if (eq === -1) tags[pair] = '';
			else tags[pair.slice(0, eq)] = unescapeTagValue(pair.slice(eq + 1));
		}
		rest = rest.slice(space + 1);
	}

	let prefix: string | undefined;
	if (rest.startsWith(':')) {
		const space = rest.indexOf(' ');
		if (space === -1) return undefined;
		prefix = rest.slice(1, space);
		rest = rest.slice(space + 1);
	}

	const params: string[] = [];
	let command = '';
	while (rest.length > 0) {
		if (params.length > 0 || command) {
			if (rest.startsWith(':')) {
				params.push(rest.slice(1));
				break;
			}
		}
		const space = rest.indexOf(' ');
		const token = space === -1 ? rest : rest.slice(0, space);
		if (!command) command = token;
		else params.push(token);
		rest = space === -1 ? '' : rest.slice(space + 1);
	}

	if (!command) return undefined;
	return { tags, prefix, command, params };
}

/** Login name from a prefix like "nick!user@host". */
export function loginFromPrefix(prefix: string | undefined): string | undefined {
	if (!prefix) return undefined;
	const bang = prefix.indexOf('!');
	return bang === -1 ? prefix : prefix.slice(0, bang);
}
