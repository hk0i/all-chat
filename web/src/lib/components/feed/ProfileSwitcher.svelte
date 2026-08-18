<script lang="ts">
	import type { Profile } from '@all-chat/contract';

	interface Props {
		profileId: string | undefined;
		profileName: string;
		profileList: Profile[];
		profileListError: string | undefined;
		profileSwitchError: string | undefined;
		onswitch: (target: Profile) => void;
	}

	let {
		profileId,
		profileName,
		profileList,
		profileListError,
		profileSwitchError,
		onswitch
	}: Props = $props();

	let open = $state(false);
	let el = $state<HTMLElement | undefined>();

	// Close on an outside click or Escape.
	$effect(() => {
		if (!open) return;
		function onDocClick(event: MouseEvent) {
			if (el && !el.contains(event.target as Node)) open = false;
		}
		function onKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') open = false;
		}
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKeydown);
		};
	});

	function select(target: Profile) {
		open = false;
		onswitch(target);
	}
</script>

<span class="profile-switcher" bind:this={el}>
	<button
		type="button"
		class="profile-name profile-name-trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{profileName} <span class="caret" aria-hidden="true">▾</span>
	</button>
	{#if open}
		<div class="profile-dropdown" role="menu">
			{#each profileList as p (p.id)}
				<button
					type="button"
					role="menuitem"
					class="profile-option"
					class:active={p.id === profileId}
					onclick={() => select(p)}
				>
					{p.name}
				</button>
			{:else}
				<p class="profile-dropdown-empty">No profiles yet.</p>
			{/each}
			{#if profileListError}
				<p class="profile-dropdown-error">{profileListError}</p>
			{/if}
			{#if profileSwitchError}
				<p class="profile-dropdown-error">{profileSwitchError}</p>
			{/if}
		</div>
	{/if}
</span>

<style>
	.profile-name {
		color: var(--text-muted);
	}

	.profile-switcher {
		position: relative;
		display: inline-block;
	}

	.profile-name-trigger {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		cursor: pointer;
	}

	.profile-name-trigger:hover,
	.profile-name-trigger[aria-expanded='true'] {
		color: var(--accent);
	}

	.profile-name-trigger:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: 2px;
	}

	.profile-name-trigger .caret {
		font-size: 0.7em;
	}

	.profile-dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		left: 0;
		z-index: 10;
		min-width: 10rem;
		max-height: 16rem;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem;
	}

	.profile-option {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
		font: inherit;
		color: var(--text);
		cursor: pointer;
	}

	.profile-option:hover {
		background: var(--bg);
	}

	.profile-option:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}

	.profile-option.active {
		color: var(--accent);
		font-weight: bold;
	}

	.profile-dropdown-empty,
	.profile-dropdown-error {
		margin: 0;
		padding: 0.35rem 0.5rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.profile-dropdown-error {
		color: var(--status-failed);
	}
</style>
