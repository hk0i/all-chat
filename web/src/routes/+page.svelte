<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Profile } from '@all-chat/contract';
	import ComposeForm from '$lib/components/feed/ComposeForm.svelte';
	import DockHeader from '$lib/components/feed/DockHeader.svelte';
	import MessageFeed from '$lib/components/feed/MessageFeed.svelte';
	import { createChatSession } from '$lib/chat/session.svelte';
	import { currentTheme, type Theme } from '$lib/theme';

	/**
	 * Default `fade` when overlay mode doesn't specify one — an overlay left
	 * running for hours shouldn't pile up messages forever on stream.
	 * Hardcoded for now; a future settings screen should expose this instead
	 * of requiring a query param (EDD §10).
	 */
	const DEFAULT_OVERLAY_FADE_SECONDS = 10;

	const session = createChatSession();

	/** Whether ?profile= or ?source= was passed at all — distinguishes "nothing to connect to" from a real failure below. */
	let hasParams = $state(false);
	/** Display name of the connected profile (?profile=), for the header title — undefined for ad-hoc ?source= or before it resolves. */
	let profileName = $state<string | undefined>();
	/** The active profile's id — set whenever there's a real profile to send through (?profile= or the switchable overlay pointer); undefined for ad-hoc ?source= (no persisted sources to look up connections against). */
	let profileId = $state<string | undefined>();
	/** Full profile list for the header quick-switcher dropdown — fetched once on mount. */
	let profileList = $state<Profile[]>([]);
	let profileListError = $state<string | undefined>();
	let profileSwitchError = $state<string | undefined>();
	/** Overlay mode with no explicit `profile=`/`source=`: true once we've checked the switchable pointer and it's unset. */
	let overlayNoProfile = $state(false);
	/** Polling interval — how often a profile-agnostic overlay re-checks which profile it should show. */
	const OVERLAY_POINTER_POLL_MS = 5000;

	/**
	 * Platform icons + accent stripes, on by default; `&icons=0` disables
	 * (overlay URLs) and the header toggle flips it live (EDD §3, display
	 * options).
	 */
	let showIcons = $state(true);

	/**
	 * Avatars default on in the dock/browser, off in overlay mode (visual
	 * noise on stream) — `&avatars=` always wins when present (EDD §3).
	 */
	let showAvatars = $state(true);

	/**
	 * Timestamps default on in the dock/browser, off in overlay mode (visual
	 * noise on stream) — `&timestamps=` always wins when present, same split
	 * as `showAvatars` above (docs/2026-08-17-message-timestamps.edd.md §7).
	 */
	let showTimestamps = $state(true);

	/**
	 * Drives author-name contrast clamping (colorContrast.ts) — the pre-paint
	 * script in app.html sets data-theme before this ever renders, so it's
	 * safe to read synchronously here.
	 */
	let theme = $state<Theme>('dark');

	/**
	 * Browser-source overlay: transparent background, no header/chrome,
	 * larger stroked text for on-stream legibility (EDD §3). `?overlay=1`.
	 */
	let overlayMode = $state(false);

	/** Header dropdown selection: switches the local view and best-effort repoints the overlay pointer, mirroring the /profiles "watch" link + ★ toggle. */
	async function switchProfile(target: Profile) {
		if (target.id === profileId) return;
		profileSwitchError = undefined;

		session.resetMessages();

		profileName = target.name;
		profileId = target.id;
		hasParams = true;
		overlayNoProfile = false;

		const nextParams = new URLSearchParams(page.url.searchParams);
		nextParams.set('profile', target.id);
		session.connectStream(nextParams);
		goto(`/?${nextParams.toString()}`, { replaceState: true, noScroll: true, keepFocus: true });

		try {
			const response = await fetch('/api/overlay-profile', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ profileId: target.id })
			});
			if (!response.ok) {
				profileSwitchError = ((await response.json()) as { message?: string }).message ?? response.statusText;
			}
		} catch (cause) {
			profileSwitchError = (cause as Error).message;
		}
	}

	// Scaffold wiring: connect when the URL carries ?profile= or ?source= params.
	onMount(() => {
		theme = currentTheme();

		fetch('/api/profiles')
			.then((response) =>
				response.ok ? (response.json() as Promise<Profile[]>) : Promise.reject(new Error(response.statusText))
			)
			.then((list) => (profileList = list))
			.catch((cause) => (profileListError = (cause as Error).message));

		const params = page.url.searchParams;
		overlayMode = params.get('overlay') === '1';
		document.body.classList.toggle('overlay', overlayMode);
		showIcons = params.get('icons') !== '0';
		showAvatars = params.has('avatars')
			? params.get('avatars') !== '0'
			: params.get('overlay') !== '1';
		showTimestamps = params.has('timestamps')
			? params.get('timestamps') !== '0'
			: params.get('overlay') !== '1';

		let fadeSeconds: number | undefined;
		if (params.has('fade')) {
			const fadeParam = Number(params.get('fade'));
			if (Number.isFinite(fadeParam) && fadeParam > 0) fadeSeconds = fadeParam;
		} else if (overlayMode) {
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
		} else if (overlayMode) {
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
		} else {
			// Bare `/`: adopt the currently-active overlay profile (set via the
			// ★ toggle on /profiles) as an implicit target, so a fresh default-route
			// load reflects state already configured in this session.
			fetch('/api/overlay-profile')
				.then((response) => response.json())
				.then((data: { profileId: string | null }) => {
					if (!data.profileId) return;
					return fetch(`/api/profiles/${encodeURIComponent(data.profileId)}`)
						.then((response) => (response.ok ? (response.json() as Promise<Profile>) : null))
						.then((profile) => {
							if (!profile) return;
							profileName = profile.name;
							profileId = profile.id;
							hasParams = true;
							const target = new URLSearchParams(params);
							target.set('profile', profile.id);
							session.connectStream(target);
						});
				})
				.catch(() => {});
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

<main class:overlay={overlayMode}>
	{#if !overlayMode}
		<DockHeader
			{profileId}
			{profileName}
			{profileList}
			{profileListError}
			{profileSwitchError}
			onswitch={switchProfile}
			statuses={session.statuses}
			bind:showIcons
			bind:showAvatars
			bind:showTimestamps
			bind:theme
		/>
	{/if}

	{#if session.streamError}
		<p class="error-banner" role="alert">Couldn't connect: {session.streamError}</p>
	{:else if overlayMode && overlayNoProfile}
		<p class="hint">
			No overlay profile selected — pick one from <a href="/profiles">Profiles</a>.
		</p>
	{:else if !hasParams && !overlayMode}
		<p class="hint">
			Pass <code>?source=twitch:somechannel</code> (repeatable) or <code>?profile=name</code> to
			connect.
		</p>
	{/if}

	<MessageFeed {session} {showIcons} {showAvatars} {showTimestamps} {theme} overlay={overlayMode} />

	{#if profileId && !overlayMode}
		<ComposeForm {session} {profileId} />
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		height: 100vh;
		max-width: 720px;
		margin: 0 auto;
		padding: 0 1rem;
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

	main.overlay {
		max-width: none;
		padding: 0.5rem 1rem;
	}
</style>
