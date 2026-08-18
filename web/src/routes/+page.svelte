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

	/** Platform icons + accent stripes, on by default; the header toggle flips it live (EDD §3, display options). */
	let showIcons = $state(true);
	let showAvatars = $state(true);
	let showTimestamps = $state(true);

	/**
	 * Drives author-name contrast clamping (colorContrast.ts) — the pre-paint
	 * script in app.html sets data-theme before this ever renders, so it's
	 * safe to read synchronously here.
	 */
	let theme = $state<Theme>('dark');

	/** Header dropdown selection: switches the local view and best-effort repoints the overlay pointer, mirroring the /profiles "watch" link + ★ toggle. */
	async function switchProfile(target: Profile) {
		if (target.id === profileId) return;
		profileSwitchError = undefined;

		session.resetMessages();

		profileName = target.name;
		profileId = target.id;
		hasParams = true;

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
		showIcons = params.get('icons') !== '0';
		showAvatars = params.has('avatars') ? params.get('avatars') !== '0' : true;
		showTimestamps = params.has('timestamps') ? params.get('timestamps') !== '0' : true;

		let fadeSeconds: number | undefined;
		if (params.has('fade')) {
			const fadeParam = Number(params.get('fade'));
			if (Number.isFinite(fadeParam) && fadeParam > 0) fadeSeconds = fadeParam;
		}
		session.startFadeSweep(fadeSeconds);

		const explicitTarget = params.has('profile') || params.has('source');
		hasParams = explicitTarget;

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
		};
	});
</script>

<svelte:head>
	<title>{profileName ? `All Chat — ${profileName}` : 'All Chat'}</title>
</svelte:head>

<main>
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

	{#if session.streamError}
		<p class="error-banner" role="alert">Couldn't connect: {session.streamError}</p>
	{:else if !hasParams}
		<p class="hint">
			Pass <code>?source=twitch:somechannel</code> (repeatable) or <code>?profile=name</code> to
			connect.
		</p>
	{/if}

	<MessageFeed {session} {showIcons} {showAvatars} {showTimestamps} {theme} />

	{#if profileId}
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
</style>
