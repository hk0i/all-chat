import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// util.promisify only picks up one overload of scrypt's several; assert the
// options-accepting shape explicitly since every call site here passes options.
const scrypt = promisify(scryptCallback) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: ScryptOptions
) => Promise<Buffer>;

/**
 * scrypt cost parameters (OWASP-recommended baseline: N=2^17, r=8, p=1,
 * ~128MB working set) — a single self-hosted admin login doesn't need to
 * optimize for throughput, so the stronger end of the acceptable range is
 * cheap to afford. Encoded into the stored hash (not hardcoded at verify
 * time) so params can change later without invalidating existing hashes.
 *
 * Chosen over argon2id (EDD §6.1's original pick) to avoid a native-binding
 * dependency on the alpine/musl Docker base image; `crypto.scrypt` is a
 * built-in, OWASP-accepted alternative. If a native KDF is ever worth the
 * Dockerfile complexity, add an `argon2id:...` prefix branch in
 * {@link verifyPassword} alongside this one — existing `scrypt:` hashes keep
 * verifying under the old branch, no forced re-hash/migration.
 */
const N = 131072;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** scrypt needs roughly 128 * N * r bytes of working memory; Node's 32MB default maxmem is too small at N=131072. */
const maxmemFor = (n: number, r: number) => 128 * n * r * 2;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);
	const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: maxmemFor(N, R) });
	return `scrypt:${N}:${R}:${P}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split(':');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
	const n = Number(nStr);
	const r = Number(rStr);
	const p = Number(pStr);
	if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: maxmemFor(n, r) });
	return derived.length === expected.length && timingSafeEqual(derived, expected);
}
