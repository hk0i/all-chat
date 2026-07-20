<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { ChatMessage, StatusEvent } from '@all-chat/contract';
	import AvatarDisc from '$lib/components/feed/AvatarDisc.svelte';
	import PlatformIcon from '$lib/components/feed/PlatformIcon.svelte';
	import { openChatStream } from '$lib/stream';
	import { toggleTheme } from '$lib/theme';

	const MAX_MESSAGES = 1000;

	/** How close to the bottom (px) still counts as "at the bottom". */
	const STICK_THRESHOLD_PX = 40;

	let messages = $state<ChatMessage[]>([]);
	let statuses = $state<Record<string, StatusEvent>>({});
	let connected = $state(false);

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

	let feedElement = $state<HTMLUListElement | undefined>();
	/** False once the user scrolls up; new messages then pause instead of yanking the view. */
	let stickToBottom = $state(true);
	let missedCount = $state(0);

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
		const params = page.url.searchParams;
		showIcons = params.get('icons') !== '0';
		showAvatars = params.has('avatars')
			? params.get('avatars') !== '0'
			: params.get('overlay') !== '1';
		if (!params.has('profile') && !params.has('source')) return;

		const close = openChatStream(params.toString(), {
			onHello: () => (connected = true),
			onMessage: (message) => {
				messages = [...messages.slice(-(MAX_MESSAGES - 1)), message];
				if (!stickToBottom) missedCount += 1;
			},
			onStatus: (status) => {
				statuses = { ...statuses, [status.sourceId]: status };
			},
			onError: () => (connected = false)
		});
		return close;
	});
</script>

<svelte:head>
	<title>All Chat</title>
</svelte:head>

<main>
	<header>
		<h1>All Chat</h1>
		<div class="controls">
			{#each Object.values(statuses) as status (status.sourceId)}
				<span class="status status-{status.state}" title="{status.platform}/{status.channel}: {status.state}"></span>
			{/each}
			<a class="nav" href="/profiles">profiles</a>
			<button class:off={!showIcons} onclick={() => (showIcons = !showIcons)}>icons</button>
			<button class:off={!showAvatars} onclick={() => (showAvatars = !showAvatars)}>avatars</button>
			<button onclick={() => toggleTheme()}>theme</button>
		</div>
	</header>

	{#if !connected && messages.length === 0}
		<p class="hint">
			Pass <code>?source=twitch:somechannel</code> (repeatable) or <code>?profile=name</code> to
			connect. Scaffold build — sources are fakes until platform ingestion lands.
		</p>
	{/if}

	<div class="feed-wrap">
		<ul class="feed" bind:this={feedElement} onscroll={onFeedScroll}>
			{#each messages as message (message.id)}
			<li class={showIcons ? `striped platform-${message.platform}` : undefined}>
				{#if showIcons}<PlatformIcon platform={message.platform} />{/if}{#if showAvatars}<AvatarDisc
						author={message.author}
					/>{/if}<span
					class="author"
					style:color={message.author.color}
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
</style>
