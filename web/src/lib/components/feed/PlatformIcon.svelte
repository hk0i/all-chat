<script lang="ts">
	import type { Platform } from '@all-chat/contract';

	let { platform }: { platform: Platform } = $props();

	/**
	 * Brand glyph paths from Simple Icons (https://simpleicons.org, CC0),
	 * all on a 24×24 viewBox. Colored via the --platform-* tokens — brand
	 * colors on purpose, not Tango palette (EDD §5.2).
	 */
	const PATHS: Record<Platform, string> = {
		twitch:
			'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z',
		kick: 'M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z',
		youtube:
			'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
		facebook:
			'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.732-.009c-.958 0-1.63.194-2.05.663-.421.463-.593 1.153-.593 2.208v1.209h3.906l-.593 3.667h-3.313v7.98H9.101z'
	};
</script>

<svg
	class="platform-icon"
	viewBox="0 0 24 24"
	role="img"
	aria-label={platform}
	style="color: var(--platform-{platform})"
>
	<path d={PATHS[platform]} />
</svg>

<style>
	.platform-icon {
		width: 0.85em;
		height: 0.85em;
		fill: currentColor;
		vertical-align: -0.05em;
		margin-right: 0.35rem;
	}
</style>
