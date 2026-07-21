// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Injected by Vite's `define` (vite.config.ts) from web/package.json at build time. */
	const __APP_VERSION__: string;
}

export {};
