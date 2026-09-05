<script lang="ts">
	import '$lib/styles/tokens.css';
	import '$lib/styles/app.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

{@render children()}
