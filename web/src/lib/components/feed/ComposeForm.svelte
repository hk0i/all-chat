<script lang="ts">
	import PlatformIcon from '$lib/components/feed/PlatformIcon.svelte';
	import type { ChatSession } from '$lib/chat/session.svelte';

	/** Compose box (EDD-V2 §5) — one box out, mirroring the one unified feed in. Sends to every connected source in the active profile, no per-platform picking (explicitly descoped for now). */
	let { session, profileId }: { session: ChatSession; profileId: string | undefined } = $props();

	let composeText = $state('');

	async function sendMessage() {
		const text = composeText.trim();
		if (!text || !profileId || session.sending) return;
		await session.sendMessage(text, profileId);
		if (!session.sendError) composeText = '';
	}
</script>

<form class="compose" onsubmit={(e) => (e.preventDefault(), sendMessage())}>
	<input
		bind:value={composeText}
		placeholder="Send a message to every connected platform…"
		disabled={session.sending}
	/>
	<button class="primary" type="submit" disabled={session.sending || !composeText.trim()}>
		{session.sending ? 'sending…' : 'send'}
	</button>
</form>
{#if session.sendError}
	<p class="error-banner" role="alert">{session.sendError}</p>
{:else if session.sendResults}
	{#if session.sendResults.length === 0}
		<p class="hint">No connected accounts to send through — connect one in admin first.</p>
	{:else}
		<p class="send-results">
			{#each session.sendResults as result (result.sourceId)}
				<span class="send-result" class:failed={!result.ok} title={result.error}>
					<PlatformIcon platform={result.platform} />{result.ok ? 'sent' : result.error}
				</span>
			{/each}
		</p>
	{/if}
{/if}

<style>
	.compose {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0;
	}

	.compose input {
		flex: 1;
		min-width: 0;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.4rem 0.6rem;
		font: inherit;
	}

	.compose input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.compose button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--neutral-800);
		font-weight: 600;
	}

	.send-results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.send-result.failed {
		color: var(--status-failed);
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
</style>
