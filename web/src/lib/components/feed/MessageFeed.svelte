<script lang="ts">
	import { fade } from 'svelte/transition';
	import AvatarDisc from '$lib/components/feed/AvatarDisc.svelte';
	import BadgeStrip from '$lib/components/feed/BadgeStrip.svelte';
	import PlatformIcon from '$lib/components/feed/PlatformIcon.svelte';
	import { readableColor } from '$lib/colorContrast';
	import { formatTimestamp } from '$lib/formatTime';
	import type { ChatSession } from '$lib/chat/session.svelte';
	import type { Theme } from '$lib/theme';

	interface Props {
		session: ChatSession;
		showIcons: boolean;
		showAvatars: boolean;
		showTimestamps: boolean;
		theme: Theme;
		overlay?: boolean;
	}

	let {
		session,
		showIcons,
		showAvatars,
		showTimestamps,
		theme,
		overlay = false
	}: Props = $props();

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
</script>

<div class="feed-wrap">
	<ul class="feed" class:overlay bind:this={session.feedElement} onscroll={session.onFeedScroll}>
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

<style>
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
	.feed.overlay {
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

	.feed.overlay li {
		text-shadow:
			-1px -1px 0 #000,
			1px -1px 0 #000,
			-1px 1px 0 #000,
			1px 1px 0 #000,
			0 2px 4px rgba(0, 0, 0, 0.6);
	}
</style>
