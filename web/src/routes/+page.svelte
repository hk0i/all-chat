<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';
	import type { ChatMessage, Profile, StatusEvent } from '@all-chat/contract';
	import AvatarDisc from '$lib/components/feed/AvatarDisc.svelte';
	import BadgeStrip from '$lib/components/feed/BadgeStrip.svelte';
	import PlatformIcon from '$lib/components/feed/PlatformIcon.svelte';
	import { readableColor } from '$lib/colorContrast';
	import { openChatStream } from '$lib/stream';
	import { currentTheme, toggleTheme, type Theme } from '$lib/theme';

	const MAX_MESSAGES = 1000;

	/**
	 * Default `fade` when overlay mode doesn't specify one — an overlay left
	 * running for hours shouldn't pile up messages forever on stream.
	 * Hardcoded for now; a future settings screen should expose this instead
	 * of requiring a query param (EDD §10).
	 */
	const DEFAULT_OVERLAY_FADE_SECONDS = 10;

	/** How close to the bottom (px) still counts as "at the bottom". */
	const STICK_THRESHOLD_PX = 40;

	let messages = $state<ChatMessage[]>([]);
	let statuses = $state<Record<string, StatusEvent>>({});
	let connected = $state(false);
	/** Whether ?profile= or ?source= was passed at all — distinguishes "nothing to connect to" from a real failure below. */
	let hasParams = $state(false);
	/** Set when the stream connection fails permanently (see stream.ts onError). */
	let streamError = $state<string | undefined>();
	/** Display name of the connected profile (?profile=), for the header title — undefined for ad-hoc ?source= or before it resolves. */
	let profileName = $state<string | undefined>();
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
	 * Seconds a message stays before it's evicted from the feed. Defaults on
	 * in overlay mode (DEFAULT_OVERLAY_FADE_SECONDS), off otherwise; `&fade=N`
	 * overrides either way, and `&fade=0` disables eviction even in overlay.
	 */
	let fadeSeconds = $state<number | undefined>();
	/** message id → receipt time (ms); drives the fade-eviction sweep. */
	const receivedAt = new Map<string, number>();
	let fadeSweepHandle: ReturnType<typeof setInterval> | undefined;

	/**
	 * Platforms with more than one live source in the current view — e.g. two
	 * Twitch channels in one profile. The platform icon alone can't tell them
	 * apart, so those messages also get a channel tag (EDD §3).
	 */
	let duplicatePlatforms = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const status of Object.values(statuses)) {
			counts.set(status.platform, (counts.get(status.platform) ?? 0) + 1);
		}
		return new Set([...counts].filter(([, count]) => count > 1).map(([platform]) => platform));
	});

	let feedElement = $state<HTMLUListElement | undefined>();
	/** False once the user scrolls up; new messages then pause instead of yanking the view. */
	let stickToBottom = $state(true);
	let missedCount = $state(0);

	/**
	 * Incoming SSE messages land here first, not directly in `messages` —
	 * a busy channel (10k+ msg/min, EDD §7) firing one Svelte state update
	 * per message would re-render the list that often. Buffered and flushed
	 * once per animation frame instead, so render rate tracks the display's
	 * refresh rate, not the chat's.
	 */
	let messageBuffer: ChatMessage[] = [];
	let flushHandle: number | undefined;

	function scheduleFlush() {
		if (flushHandle !== undefined) return;
		flushHandle = requestAnimationFrame(flushMessages);
	}

	function flushMessages() {
		flushHandle = undefined;
		if (messageBuffer.length === 0) return;
		const incoming = messageBuffer;
		messageBuffer = [];
		const now = Date.now();
		for (const message of incoming) receivedAt.set(message.id, now);
		messages = [...messages, ...incoming].slice(-MAX_MESSAGES);
		if (!stickToBottom) missedCount += incoming.length;
	}

	/** Evicts messages older than `fadeSeconds`; the `out:fade` transition animates their removal. */
	function sweepExpired() {
		if (fadeSeconds === undefined) return;
		const cutoff = Date.now() - fadeSeconds * 1000;
		const next = messages.filter((message) => (receivedAt.get(message.id) ?? 0) > cutoff);
		if (next.length === messages.length) return;
		messages = next;
		const keep = new Set(next.map((message) => message.id));
		for (const id of receivedAt.keys()) if (!keep.has(id)) receivedAt.delete(id);
	}

	function onFeedScroll() {
		if (!feedElement) return;
		const distanceFromBottom =
			feedElement.scrollHeight - feedElement.scrollTop - feedElement.clientHeight;
		const atBottom = distanceFromBottom <= STICK_THRESHOLD_PX;
		if (atBottom && !stickToBottom) missedCount = 0;
		stickToBottom = atBottom;
	}

	function resumeScroll() {
		stickToBottom = true;
		missedCount = 0;
		scrollToBottom();
	}

	function scrollToBottom() {
		if (feedElement) feedElement.scrollTop = feedElement.scrollHeight;
	}

	// Keep pinned to the newest message unless the user scrolled up.
	$effect(() => {
		void messages.length;
		if (stickToBottom) scrollToBottom();
	});

	// Scaffold wiring: connect when the URL carries ?profile= or ?source= params.
	onMount(() => {
		theme = currentTheme();
		const params = page.url.searchParams;
		overlayMode = params.get('overlay') === '1';
		document.body.classList.toggle('overlay', overlayMode);
		showIcons = params.get('icons') !== '0';
		showAvatars = params.has('avatars')
			? params.get('avatars') !== '0'
			: params.get('overlay') !== '1';

		if (params.has('fade')) {
			const fadeParam = Number(params.get('fade'));
			if (Number.isFinite(fadeParam) && fadeParam > 0) fadeSeconds = fadeParam;
		} else if (overlayMode) {
			fadeSeconds = DEFAULT_OVERLAY_FADE_SECONDS;
		}
		if (fadeSeconds !== undefined) fadeSweepHandle = setInterval(sweepExpired, 1000);

		let closeStream: (() => void) | undefined;

		function connectStream(streamParams: URLSearchParams) {
			closeStream?.();
			closeStream = openChatStream(streamParams.toString(), {
				onHello: () => (connected = true),
				onMessage: (message) => {
					messageBuffer.push(message);
					scheduleFlush();
				},
				onStatus: (status) => {
					statuses = { ...statuses, [status.sourceId]: status };
				},
				onError: (message) => {
					connected = false;
					streamError = message;
				}
			});
		}

		const explicitTarget = params.has('profile') || params.has('source');
		hasParams = explicitTarget;

		let pointerPollHandle: ReturnType<typeof setInterval> | undefined;

		if (explicitTarget) {
			connectStream(params);
			const profileParam = params.get('profile');
			if (profileParam) {
				fetch(`/api/profiles/${encodeURIComponent(profileParam)}`)
					.then((response) => (response.ok ? (response.json() as Promise<Profile>) : null))
					.then((profile) => {
						if (profile) profileName = profile.name;
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

			const applyPointer = (profileId: string | null) => {
				if (activeProfileId !== undefined && profileId === activeProfileId) return;
				activeProfileId = profileId;
				overlayNoProfile = !profileId;
				closeStream?.();
				closeStream = undefined;
				messages = [];
				statuses = {};
				connected = false;
				streamError = undefined;
				messageBuffer = [];
				receivedAt.clear();
				if (!profileId) return;
				const target = new URLSearchParams(params);
				target.set('profile', profileId);
				connectStream(target);
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
			closeStream?.();
			if (flushHandle !== undefined) cancelAnimationFrame(flushHandle);
			if (fadeSweepHandle !== undefined) clearInterval(fadeSweepHandle);
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
				All Chat {#if profileName} / <span class="profile-name">{profileName}</span>{/if}
				<span class="app-version">v{__APP_VERSION__}</span>
			</h1>
			<div class="controls">
				{#each Object.values(statuses) as status (status.sourceId)}
					<span class="status status-{status.state}" title="{status.platform}/{status.channel}: {status.state}"></span>
				{/each}
				<a class="nav" href="/profiles">profiles</a>
				<button class:off={!showIcons} onclick={() => (showIcons = !showIcons)}>icons</button>
				<button class:off={!showAvatars} onclick={() => (showAvatars = !showAvatars)}>avatars</button>
				<button onclick={() => (theme = toggleTheme())}>theme</button>
			</div>
		</header>
	{/if}

	{#if streamError}
		<p class="error-banner" role="alert">Couldn't connect: {streamError}</p>
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
		<ul class="feed" bind:this={feedElement} onscroll={onFeedScroll}>
			{#each messages as message (message.id)}
			<li
				class={showIcons ? `striped platform-${message.platform}` : undefined}
				out:fade={fadeSeconds !== undefined ? { duration: 400 } : { duration: 0 }}
			>
				{#if showIcons}<PlatformIcon
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
		{#if !stickToBottom}
			<button class="resume-pill" onclick={resumeScroll}>
				paused{missedCount > 0 ? ` — ${missedCount} new message${missedCount === 1 ? '' : 's'}` : ''} ↓
			</button>
		{/if}
	</div>
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

	button.off {
		opacity: 0.5;
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

	.profile-name {
		color: var(--text-muted);
	}

	.app-version {
		margin-left: 0.5rem;
		font-size: 0.7rem;
		font-weight: normal;
		color: var(--text-muted);
	}
</style>
