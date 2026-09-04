<script lang="ts">
	import { toggleTheme, type Theme } from '$lib/theme';

	interface Props {
		showIcons: boolean;
		showAvatars: boolean;
		showTimestamps: boolean;
		theme: Theme;
	}

	let {
		showIcons = $bindable(),
		showAvatars = $bindable(),
		showTimestamps = $bindable(),
		theme = $bindable()
	}: Props = $props();

	let open = $state(false);
	let el = $state<HTMLElement | undefined>();

	// Close on an outside click or Escape. Toggling an option does not close it.
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
</script>

<span class="options-menu" bind:this={el}>
	<button
		type="button"
		class="options-trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="gear" aria-hidden="true">⚙</span><span class="label">options</span>
	</button>
	{#if open}
		<div class="options-dropdown" role="menu">
			<button class:off={!showIcons} onclick={() => (showIcons = !showIcons)}>icons</button>
			<button class:off={!showAvatars} onclick={() => (showAvatars = !showAvatars)}>avatars</button>
			<button class:off={!showTimestamps} onclick={() => (showTimestamps = !showTimestamps)}
				>time</button
			>
			<button onclick={() => (theme = toggleTheme())}>theme</button>
		</div>
	{/if}
</span>

<style>
	.options-menu {
		position: relative;
		display: inline-block;
	}

	.options-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.options-trigger[aria-expanded='true'] {
		color: var(--accent);
	}

	@media (max-width: 480px) {
		.options-trigger .label {
			display: none;
		}
	}

	.options-dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 7rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem;
	}

	.options-dropdown button {
		width: 100%;
		text-align: left;
	}

	button.off {
		opacity: 0.5;
	}
</style>
