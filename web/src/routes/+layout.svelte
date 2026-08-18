<script lang="ts">
	import '$lib/styles/tokens.css';
	import '$lib/styles/app.css';
	import favicon from '$lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
