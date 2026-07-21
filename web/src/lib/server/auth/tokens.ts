import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Bearer tokens and read-only URL tokens (EDD §6.1) are high-entropy random
 * secrets, not user-chosen passwords — brute force isn't the threat model,
 * so a fast SHA-256 digest is the right hash here (unlike {@link
 * ../passwordHash}'s deliberately slow scrypt). Storing the digest rather
 * than the token itself means a leaked `config.json` doesn't hand out live
 * credentials.
 */

/** A fresh random token in its plaintext form — shown to the user once, at creation time, then never again. */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function verifyTokenHash(token: string, storedHash: string): boolean {
	const actual = Buffer.from(hashToken(token), 'hex');
	const expected = Buffer.from(storedHash, 'hex');
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Signed, stateless session cookie value: `<expiresAtMs>.<hmac>`. No server-side
 * session store to prune or revoke individually — rotating the signing secret
 * (regenerated whenever the admin password is cleared/reset) invalidates every
 * outstanding session at once, which is all a single-admin app needs.
 */
export function createSessionToken(secret: string, expiresAtMs: number): string {
	const mac = createHmac('sha256', secret).update(String(expiresAtMs)).digest('hex');
	return `${expiresAtMs}.${mac}`;
}

export function verifySessionToken(secret: string, token: string): boolean {
	const [expiresAtStr, mac] = token.split('.');
	if (!expiresAtStr || !mac) return false;
	const expiresAtMs = Number(expiresAtStr);
	if (!Number.isInteger(expiresAtMs) || expiresAtMs < Date.now()) return false;

	const expected = createHmac('sha256', secret).update(expiresAtStr).digest('hex');
	const actual = Buffer.from(mac, 'hex');
	const expectedBuf = Buffer.from(expected, 'hex');
	return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}
