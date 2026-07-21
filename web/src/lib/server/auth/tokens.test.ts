import { describe, expect, it } from 'vitest';
import { createSessionToken, generateToken, hashToken, verifySessionToken, verifyTokenHash } from './tokens';

describe('generateToken', () => {
	it('produces distinct high-entropy tokens', () => {
		const a = generateToken();
		const b = generateToken();
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThan(30);
	});
});

describe('hashToken / verifyTokenHash', () => {
	it('verifies a token against its own hash', () => {
		const token = generateToken();
		expect(verifyTokenHash(token, hashToken(token))).toBe(true);
	});

	it('rejects a different token', () => {
		const hash = hashToken(generateToken());
		expect(verifyTokenHash(generateToken(), hash)).toBe(false);
	});
});

describe('session tokens', () => {
	const secret = 'test-secret';

	it('verifies a token signed with the same secret before expiry', () => {
		const token = createSessionToken(secret, Date.now() + 60_000);
		expect(verifySessionToken(secret, token)).toBe(true);
	});

	it('rejects an expired token', () => {
		const token = createSessionToken(secret, Date.now() - 1);
		expect(verifySessionToken(secret, token)).toBe(false);
	});

	it('rejects a token signed with a different secret', () => {
		const token = createSessionToken('other-secret', Date.now() + 60_000);
		expect(verifySessionToken(secret, token)).toBe(false);
	});

	it('rejects malformed tokens instead of throwing', () => {
		expect(verifySessionToken(secret, 'not-a-real-token')).toBe(false);
		expect(verifySessionToken(secret, '')).toBe(false);
	});
});
