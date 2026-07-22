import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
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
		// Google/Facebook all match it exactly, docs/EDD-V2.md §3).
		strictPort: true
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
