<script lang="ts">
	import ProfileSwitcher from '$lib/components/feed/ProfileSwitcher.svelte';
	import DisplayOptionsMenu from '$lib/components/feed/DisplayOptionsMenu.svelte';
	import type { Theme } from '$lib/theme';
	import type { Profile, StatusEvent } from '@all-chat/contract';

	interface Props {
		profileId: string | undefined;
		profileName: string | undefined;
		profileList: Profile[];
		profileListError: string | undefined;
		profileSwitchError: string | undefined;
		onswitch: (target: Profile) => void;
		statuses: Record<string, StatusEvent>;
		showIcons: boolean;
		showAvatars: boolean;
		showTimestamps: boolean;
		theme: Theme;
	}

	let {
		profileId,
		profileName,
		profileList,
		profileListError,
		profileSwitchError,
		onswitch,
		statuses,
		showIcons = $bindable(),
		showAvatars = $bindable(),
		showTimestamps = $bindable(),
		theme = $bindable()
	}: Props = $props();
</script>

<header>
	<h1>
		All Chat {#if profileName}
			/ <ProfileSwitcher
				{profileId}
				{profileName}
				{profileList}
				{profileListError}
				{profileSwitchError}
				{onswitch}
			/>
		{/if}
		<span class="app-version">v{__APP_VERSION__}</span>
	</h1>
	<div class="controls">
		{#each Object.values(statuses) as status (status.sourceId)}
			<span class="status status-{status.state}" title="{status.platform}/{status.channel}: {status.state}"></span>
		{/each}
		<a class="nav" href="/profiles">profiles</a>
		<a class="nav" href="/admin">admin</a>
		<DisplayOptionsMenu bind:showIcons bind:showAvatars bind:showTimestamps bind:theme />
	</div>
</header>

<style>
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

	.nav {
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.nav:hover {
		color: var(--accent);
	}

	.app-version {
		margin-left: 0.5rem;
		font-size: 0.7rem;
		font-weight: normal;
		color: var(--text-muted);
	}
</style>
