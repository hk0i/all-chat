<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Profile } from '@all-chat/contract';
	import MessageFeed from '$lib/components/feed/MessageFeed.svelte';
	import { createChatSession } from '$lib/chat/session.svelte';
	import { currentTheme, type Theme } from '$lib/theme';

	/**
	 * Default `fade` when the URL doesn't specify one — an overlay left
	 * running for hours shouldn't pile up messages forever on stream.
	 * Hardcoded for now; a future settings screen should expose this instead
	 * of requiring a query param (EDD §10).
	 */
	const DEFAULT_OVERLAY_FADE_SECONDS = 10;

	/** Polling interval — how often this profile-agnostic overlay re-checks which profile it should show. */
	const OVERLAY_POINTER_POLL_MS = 5000;

	const session = createChatSession();

	/** Whether ?profile= or ?source= was passed at all. */
	let hasParams = $state(false);
	/** Display name of the connected profile (?profile=), for the page title — undefined for ad-hoc ?source= or the pointer-driven case (before EDD §3 tracked names for it). */
	let profileName = $state<string | undefined>();
	/** The active profile's id — set from ?profile=, or from the switchable overlay pointer. */
	let profileId = $state<string | undefined>();
	/** No explicit `profile=`/`source=`: true once we've checked the switchable pointer and it's unset. */
	let overlayNoProfile = $state(false);

	/** `&icons=0` disables; on by default (EDD §3, display options). */
	let showIcons = $state(true);
	/** Avatars default off on stream (visual noise); `&avatars=` always wins when present (EDD §3). */
	let showAvatars = $state(false);
	/** Timestamps default off on stream; `&timestamps=` always wins when present (docs/2026-08-17-message-timestamps.edd.md §7). */
	let showTimestamps = $state(false);

	/** Drives author-name contrast clamping (colorContrast.ts) — same as the dock route. */
	let theme = $state<Theme>('dark');

	onMount(() => {
		theme = currentTheme();
		document.body.classList.add('overlay');

		const params = page.url.searchParams;
		showIcons = params.get('icons') !== '0';
		showAvatars = params.has('avatars') ? params.get('avatars') !== '0' : false;
		showTimestamps = params.has('timestamps') ? params.get('timestamps') !== '0' : false;

		let fadeSeconds: number | undefined;
		if (params.has('fade')) {
			const fadeParam = Number(params.get('fade'));
			if (Number.isFinite(fadeParam) && fadeParam > 0) fadeSeconds = fadeParam;
		} else {
			fadeSeconds = DEFAULT_OVERLAY_FADE_SECONDS;
		}
		session.startFadeSweep(fadeSeconds);

		const explicitTarget = params.has('profile') || params.has('source');
		hasParams = explicitTarget;

		let pointerPollHandle: ReturnType<typeof setInterval> | undefined;

		if (explicitTarget) {
			session.connectStream(params);
			const profileParam = params.get('profile');
			if (profileParam) {
				fetch(`/api/profiles/${encodeURIComponent(profileParam)}`)
					.then((response) => (response.ok ? (response.json() as Promise<Profile>) : null))
					.then((profile) => {
						if (profile) {
							profileName = profile.name;
							profileId = profile.id;
						}
					})
					.catch(() => {});
			}
		} else {
			// Profile-agnostic overlay: one fixed OBS URL, switchable from the
			// Profiles page without touching the source in OBS (EDD §3).
			// `undefined` = not checked yet, distinct from an actual `null` pointer
			// (nothing selected) — otherwise a pointer that's null on the very
			// first check never triggers the "no profile selected" state below.
			let activeProfileId: string | null | undefined;

			const applyPointer = (pointerProfileId: string | null) => {
				if (activeProfileId !== undefined && pointerProfileId === activeProfileId) return;
				activeProfileId = pointerProfileId;
				profileId = pointerProfileId ?? undefined;
				overlayNoProfile = !pointerProfileId;
				session.closeStream();
				session.resetMessages();
				if (!pointerProfileId) return;
				const target = new URLSearchParams(params);
				target.set('profile', pointerProfileId);
				session.connectStream(target);
			};

			const checkPointer = () =>
				fetch('/api/overlay-profile')
					.then((response) => response.json())
					.then((data: { profileId: string | null }) => applyPointer(data.profileId))
					.catch(() => {});

			checkPointer();
			pointerPollHandle = setInterval(checkPointer, OVERLAY_POINTER_POLL_MS);
		}

		return () => {
			session.dispose();
			if (pointerPollHandle !== undefined) clearInterval(pointerPollHandle);
		};
	});
</script>

<svelte:head>
	<title>{profileName ? `All Chat — ${profileName}` : 'All Chat'}</title>
</svelte:head>

<main>
	{#if session.streamError}
		<p class="error-banner" role="alert">Couldn't connect: {session.streamError}</p>
	{:else if overlayNoProfile}
		<p class="hint">
			No overlay profile selected — pick one from <a href="/profiles">Profiles</a>.
		</p>
	{/if}

	<MessageFeed {session} {showIcons} {showAvatars} {showTimestamps} {theme} overlay />
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		height: 100vh;
		margin: 0 auto;
		padding: 0.5rem 1rem;
	}

	.hint {
		color: var(--text-muted);
	}

	.error-banner {
		color: var(--status-failed);
		border: 1px solid var(--status-failed);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
	}
</style>
