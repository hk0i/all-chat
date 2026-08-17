import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * `.env` lives at the repo root (docker-compose.yml reads it from there too,
 * for its own ${VAR} interpolation) — one shared file for both. `envDir`
 * alone only points Vite's own `import.meta.env` at it; server code here
 * reads plain `process.env.TWITCH_CLIENT_ID` etc. directly (providers.ts,
 * facebookOAuth.ts), which Vite never populates on its own. `loadEnv` +
 * `Object.assign` is the documented workaround for exactly that gap.
 */
const ROOT_DIR = resolve(process.cwd(), '..');

export default defineConfig(({ mode }) => {
	Object.assign(process.env, loadEnv(mode, ROOT_DIR, ''));

	return {
		envDir: ROOT_DIR,
		define: {
			__APP_VERSION__: JSON.stringify(version)
		},
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter()
			})
		],
		server: {
			// Dev-only: honor an assigned PORT (e.g. from preview tooling).
			port: process.env.PORT ? Number(process.env.PORT) : 5173,
			// Fail loudly instead of silently bumping to the next free port —
			// OAuth redirect_uri is built from url.origin at request time, so a
			// silent port shift breaks every registered redirect URI (Twitch/
			// Google/Facebook all match it exactly, docs/2026-07-20-all-chat-v2.edd.md §3).
			strictPort: true
		},
		test: {
			include: ['src/**/*.test.ts'],
			environment: 'node'
		}
	};
});
