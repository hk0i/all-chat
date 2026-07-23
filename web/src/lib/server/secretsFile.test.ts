import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSecretsFile } from './secretsFile';

let dir: string;
const addedKeys = ['TEST_SECRET_ONE', 'TEST_SECRET_TWO', 'TEST_QUOTED'];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'allchat-secrets-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	for (const key of addedKeys) delete process.env[key];
});

describe('loadSecretsFile', () => {
	it('is a silent no-op when the file does not exist', () => {
		expect(() => loadSecretsFile(join(dir, 'missing'))).not.toThrow();
	});

	it('parses KEY=VALUE lines, skipping blanks/comments, and merges into process.env', () => {
		const path = join(dir, 'secrets');
		writeFileSync(
			path,
			['# a comment', '', 'TEST_SECRET_ONE=abc123', 'TEST_QUOTED="quoted value"'].join('\n')
		);
		chmodSync(path, 0o600);

		loadSecretsFile(path);

		expect(process.env.TEST_SECRET_ONE).toBe('abc123');
		expect(process.env.TEST_QUOTED).toBe('quoted value');
	});

	it('never overwrites a real env var already set', () => {
		process.env.TEST_SECRET_ONE = 'from-real-env';
		const path = join(dir, 'secrets');
		writeFileSync(path, 'TEST_SECRET_ONE=from-file');
		chmodSync(path, 0o600);

		loadSecretsFile(path);

		expect(process.env.TEST_SECRET_ONE).toBe('from-real-env');
	});

	it('warns but still loads when permissions are looser than owner-only', () => {
		const path = join(dir, 'secrets');
		writeFileSync(path, 'TEST_SECRET_TWO=xyz');
		chmodSync(path, 0o644);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		loadSecretsFile(path);

		expect(process.env.TEST_SECRET_TWO).toBe('xyz');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chmod 600'));
		warnSpy.mockRestore();
	});
});
