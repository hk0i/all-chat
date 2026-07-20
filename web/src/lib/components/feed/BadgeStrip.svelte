<script lang="ts">
	import type { Badge, BadgeKind } from '@all-chat/contract';

	let { badges }: { badges: Badge[] } = $props();

	/**
	 * Short label per recognized kind. `unknown` covers platform badge sets
	 * we don't map (event badges, misc partner programs) — their own text
	 * ("moments", "legendus"...) reads as noise, not signal, so those badges
	 * are dropped rather than shown as a bare "?".
	 */
	const LABELS: Partial<Record<BadgeKind, string>> = {
		broadcaster: 'HOST',
		moderator: 'MOD',
		subscriber: 'SUB',
		member: 'MEM',
		verified: '✓',
		vip: 'VIP',
		og: 'OG'
	};

	let known = $derived(badges.filter((badge) => badge.kind !== 'unknown'));
</script>

{#each known as badge, index (index)}
	<span class="badge badge-{badge.kind}" title={badge.title ?? badge.kind}>
		{LABELS[badge.kind]}
	</span>
{/each}

<style>
	.badge {
		display: inline-block;
		font-size: 0.6em;
		font-weight: 700;
		line-height: 1.4;
		padding: 0 0.3em;
		border-radius: 3px;
		margin-right: 0.3rem;
		vertical-align: middle;
		color: var(--neutral-900);
	}

	.badge-broadcaster {
		background: var(--primary-500);
	}

	.badge-moderator {
		background: var(--success-500);
	}

	.badge-vip {
		background: var(--secondary-500);
	}

	.badge-subscriber,
	.badge-member {
		background: var(--primary-300);
	}

	.badge-og {
		background: var(--warning-500);
	}

	.badge-verified {
		background: var(--neutral-300);
	}
</style>
