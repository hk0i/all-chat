<script lang="ts">
	import type { ChatAuthor } from '@all-chat/contract';

	let { author }: { author: ChatAuthor } = $props();
</script>

{#if author.avatarUrl}
	<img class="avatar" src={author.avatarUrl} alt="" />
{:else}
	<span class="avatar avatar-initial" style:background={author.color}>
		{author.name.trim().charAt(0).toUpperCase() || '?'}
	</span>
{/if}

<style>
	.avatar {
		width: 1.4em;
		height: 1.4em;
		border-radius: 50%;
		vertical-align: middle;
		margin-right: 0.35rem;
		object-fit: cover;
	}

	.avatar-initial {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7em;
		font-weight: 700;
		color: var(--neutral-900);
		line-height: 1;
	}
</style>
