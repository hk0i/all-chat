import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwordHash';

describe('passwordHash', () => {
	it('verifies the correct password', async () => {
		const hash = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
	});

	it('rejects an incorrect password', async () => {
		const hash = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('wrong password', hash)).toBe(false);
	});

	it('salts each hash differently', async () => {
		const a = await hashPassword('same password');
		const b = await hashPassword('same password');
		expect(a).not.toBe(b);
		expect(await verifyPassword('same password', a)).toBe(true);
		expect(await verifyPassword('same password', b)).toBe(true);
	});

	it('encodes the algorithm and cost params in the stored hash', async () => {
		const hash = await hashPassword('pw');
		expect(hash).toMatch(/^scrypt:131072:8:1:[0-9a-f]+:[0-9a-f]+$/);
	});

	it('rejects malformed or garbage stored hashes instead of throwing', async () => {
		await expect(verifyPassword('pw', 'not a real hash')).resolves.toBe(false);
		await expect(verifyPassword('pw', 'argon2id:1:2:3:aa:bb')).resolves.toBe(false);
		await expect(verifyPassword('pw', '')).resolves.toBe(false);
	});
});
