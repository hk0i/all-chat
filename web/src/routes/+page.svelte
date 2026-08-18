<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Profile } from '@all-chat/contract';
	import AvatarDisc from '$lib/components/feed/AvatarDisc.svelte';
	import BadgeStrip from '$lib/components/feed/BadgeStrip.svelte';
	import PlatformIcon from '$lib/components/feed/PlatformIcon.svelte';
	import ProfileSwitcher from '$lib/components/feed/ProfileSwitcher.svelte';
	import { readableColor } from '$lib/colorContrast';
	import { formatTimestamp } from '$lib/formatTime';
	import { createChatSession } from '$lib/chat/session.svelte';
	import { currentTheme, toggleTheme, type Theme } from '$lib/theme';

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

	/**
	 * Platforms with more than one live source in the current view — e.g. two
	 * Twitch channels in one profile. The platform icon alone can't tell them
	 * apart, so those messages also get a channel tag (EDD §3).
	 */
	let duplicatePlatforms = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const status of Object.values(session.statuses)) {
			counts.set(status.platform, (counts.get(status.platform) ?? 0) + 1);
		}
		return new Set([...counts].filter(([, count]) => count > 1).map(([platform]) => platform));
	});

	/** Compose box (EDD-V2 §5) — one box out, mirroring the one unified feed in. Sends to every connected source in the active profile, no per-platform picking (explicitly descoped for now). */
	let composeText = $state('');

	async function sendMessage() {
		const text = composeText.trim();
		if (!text || !profileId || session.sending) return;
		await session.sendMessage(text, profileId);
		if (!session.sendError) composeText = '';
	}

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
		<header>
			<h1>
				All Chat {#if profileName}
					/ <ProfileSwitcher
						{profileId}
						{profileName}
						{profileList}
						{profileListError}
						{profileSwitchError}
						onswitch={switchProfile}
					/>
				{/if}
				<span class="app-version">v{__APP_VERSION__}</span>
			</h1>
			<div class="controls">
				{#each Object.values(session.statuses) as status (status.sourceId)}
					<span class="status status-{status.state}" title="{status.platform}/{status.channel}: {status.state}"></span>
				{/each}
				<a class="nav" href="/profiles">profiles</a>
				<a class="nav" href="/admin">admin</a>
				<button class:off={!showIcons} onclick={() => (showIcons = !showIcons)}>icons</button>
				<button class:off={!showAvatars} onclick={() => (showAvatars = !showAvatars)}>avatars</button>
				<button class:off={!showTimestamps} onclick={() => (showTimestamps = !showTimestamps)}>time</button>
				<button onclick={() => (theme = toggleTheme())}>theme</button>
			</div>
		</header>
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

	<div class="feed-wrap">
		<ul class="feed" bind:this={session.feedElement} onscroll={session.onFeedScroll}>
			{#each session.messages as message (message.id)}
			{@const messageDate = new Date(message.timestamp)}
			<li
				class={showIcons ? `striped platform-${message.platform}` : undefined}
				out:fade={session.fadeSeconds !== undefined ? { duration: 400 } : { duration: 0 }}
			>
				{#if showTimestamps}<time class="timestamp" datetime={messageDate.toISOString()}
						>{formatTimestamp(messageDate)}</time
					>{/if}{#if showIcons}<PlatformIcon
						platform={message.platform}
					/>{#if duplicatePlatforms.has(message.platform)}<span class="source-tag"
							>{message.channel}</span
						>{/if}{/if}{#if showAvatars}<AvatarDisc
						author={message.author}
					/>{/if}{#if message.author.badges.length}<BadgeStrip
						badges={message.author.badges}
					/>{/if}<span
					class="author"
					style:color={message.author.color
						? readableColor(message.author.color, theme)
						: undefined}
					>{message.author.name}{#if message.author.login}
						<span class="login">({message.author.login})</span>{/if}</span
				>
				{#each message.fragments as fragment, index (index)}
					{#if fragment.kind === 'text'}<span>{fragment.text}</span>{:else}<img
							src={fragment.url}
							alt={fragment.name}
							class="emote"
						/>{/if}
				{/each}
			</li>
			{/each}
		</ul>
		{#if !session.stickToBottom}
			<button class="resume-pill" onclick={session.resumeScroll}>
				paused{session.missedCount > 0
					? ` — ${session.missedCount} new message${session.missedCount === 1 ? '' : 's'}`
					: ''} ↓
			</button>
		{/if}
	</div>

	{#if profileId && !overlayMode}
		<form class="compose" onsubmit={(e) => (e.preventDefault(), sendMessage())}>
			<input
				bind:value={composeText}
				placeholder="Send a message to every connected platform…"
				disabled={session.sending}
			/>
			<button class="primary" type="submit" disabled={session.sending || !composeText.trim()}>
				{session.sending ? 'sending…' : 'send'}
			</button>
		</form>
		{#if session.sendError}
			<p class="error-banner" role="alert">{session.sendError}</p>
		{:else if session.sendResults}
			{#if session.sendResults.length === 0}
				<p class="hint">No connected accounts to send through — connect one in admin first.</p>
			{:else}
				<p class="send-results">
					{#each session.sendResults as result (result.sourceId)}
						<span class="send-result" class:failed={!result.ok} title={result.error}>
							<PlatformIcon platform={result.platform} />{result.ok ? 'sent' : result.error}
						</span>
					{/each}
				</p>
			{/if}
		{/if}
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

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border);
	}

	h1 {
		font-size: 1.1rem;
		margin: 0;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.status-live {
		background: var(--status-live);
	}

	.status-reconnecting,
	.status-connecting {
		background: var(--status-reconnecting);
	}

	.status-failed {
		background: var(--status-failed);
	}

	button {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem 0.6rem;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--accent);
	}

	.nav {
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.nav:hover {
		color: var(--accent);
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

	.compose {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0;
	}

	.compose input {
		flex: 1;
		min-width: 0;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		font: inherit;
	}

	.compose input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.compose button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--neutral-800);
		font-weight: 600;
	}

	.send-results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.send-result.failed {
		color: var(--status-failed);
	}

	.feed-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.feed {
		list-style: none;
		margin: 0;
		padding: 0.5rem 0;
		overflow-y: auto;
		flex: 1;
	}

	.resume-pill {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.feed li {
		padding: 0.15rem 0;
	}

	/* Platform accent stripe — brand colors, part of the icons option (EDD §3). */
	.feed li.striped {
		padding-left: 0.5rem;
		border-left: 3px solid transparent;
	}

	.feed li.platform-twitch {
		border-left-color: var(--platform-twitch);
	}

	.feed li.platform-kick {
		border-left-color: var(--platform-kick);
	}

	.feed li.platform-youtube {
		border-left-color: var(--platform-youtube);
	}

	.feed li.platform-facebook {
		border-left-color: var(--platform-facebook);
	}

	button.off {
		opacity: 0.5;
	}

	.timestamp {
		font-size: 0.7em;
		color: var(--text-muted);
		margin-right: 0.4rem;
		font-variant-numeric: tabular-nums;
	}

	.source-tag {
		font-size: 0.7em;
		color: var(--text-muted);
		margin-right: 0.35rem;
	}

	.author {
		font-weight: 600;
		margin-right: 0.4rem;
	}

	.login {
		font-weight: 400;
		opacity: 0.6;
	}

	.emote {
		height: 1.4em;
		vertical-align: middle;
	}

	/*
	 * Overlay mode renders over arbitrary stream video, so text needs a
	 * synthetic stroke (layered shadows in every direction) rather than
	 * relying on background contrast — colors that read fine on the app's
	 * own bg/surface tokens can vanish against gameplay footage.
	 */
	main.overlay {
		max-width: none;
		padding: 0.5rem 1rem;
	}

	main.overlay .feed {
		font-size: 1.3rem;
		/*
		 * Anchor to the bottom of the viewport instead of the top — a chat
		 * overlay reads as messages arriving at the bottom and pushing older
		 * ones up, not as a top-anchored log with empty space below it. No
		 * scrollbar: overflow is expected to stay bounded by the fade-eviction
		 * sweep, and a scrollbar has no place on a chrome-less stream overlay.
		 */
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		overflow-y: hidden;
	}

	main.overlay .feed li {
		text-shadow:
			-1px -1px 0 #000,
			1px -1px 0 #000,
			-1px 1px 0 #000,
			1px 1px 0 #000,
			0 2px 4px rgba(0, 0, 0, 0.6);
	}

	.app-version {
		margin-left: 0.5rem;
		font-size: 0.7rem;
		font-weight: normal;
		color: var(--text-muted);
	}
</style>
