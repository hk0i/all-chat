<script lang="ts">
	import type { BearerTokenInfo, PlatformProviderStatus, Profile, UrlTokenInfo } from '@all-chat/contract';
	import { copyToClipboard } from '$lib/clipboard';
	import { toggleTheme } from '$lib/theme';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let bearerTokens = $state<BearerTokenInfo[]>(data.bearerTokens);
	// svelte-ignore state_referenced_locally
	let urlTokens = $state<UrlTokenInfo[]>(data.urlTokens);
	// svelte-ignore state_referenced_locally
	let profiles = $state<Profile[]>(data.profiles);
	// svelte-ignore state_referenced_locally
	let authEnabled = $state(data.authEnabled);
	// svelte-ignore state_referenced_locally
	let platformProviders = $state<PlatformProviderStatus[]>(data.platformProviders);

	let error = $state<string | undefined>();

	/** Only ever populated right after creation — the server never returns a token's plaintext again. */
	let revealedToken = $state<{ label: string; token: string } | undefined>();
	let copied = $state(false);

	let newBearerName = $state('');
	let newBearerScope = $state<'read' | 'write'>('read');
	let newUrlProfileId = $state<string>('');

	const profileName = (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.name ?? id) : 'any profile');

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleString();
	}

	async function createBearerToken(event: SubmitEvent) {
		event.preventDefault();
		error = undefined;
		if (!newBearerName.trim()) return;

		const response = await fetch('/api/auth/tokens/bearer', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: newBearerName.trim(), scope: newBearerScope })
		});
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		const { id, token } = (await response.json()) as { id: string; token: string };
		bearerTokens = [
			...bearerTokens,
			{ id, name: newBearerName.trim(), scope: newBearerScope, createdAt: Date.now(), lastUsedAt: null }
		];
		revealedToken = { label: `Bearer token "${newBearerName.trim()}"`, token };
		newBearerName = '';
		newBearerScope = 'read';
	}

	async function revokeBearerToken(id: string) {
		error = undefined;
		const response = await fetch(`/api/auth/tokens/bearer/${id}`, { method: 'DELETE' });
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		bearerTokens = bearerTokens.filter((t) => t.id !== id);
	}

	async function createUrlToken(event: SubmitEvent) {
		event.preventDefault();
		error = undefined;

		const profileId = newUrlProfileId || null;
		const response = await fetch('/api/auth/tokens/url', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ profileId })
		});
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		const { id, token } = (await response.json()) as { id: string; token: string };
		urlTokens = [...urlTokens, { id, profileId, createdAt: Date.now(), lastUsedAt: null }];
		revealedToken = { label: `URL token for ${profileName(profileId)}`, token };
		newUrlProfileId = '';
	}

	async function revokeUrlToken(id: string) {
		error = undefined;
		const response = await fetch(`/api/auth/tokens/url/${id}`, { method: 'DELETE' });
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		urlTokens = urlTokens.filter((t) => t.id !== id);
	}

	async function copyRevealedToken() {
		if (!revealedToken) return;
		await copyToClipboard(revealedToken.token);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	/**
	 * "Change password" is just this followed by `/login`'s first-run setup
	 * form again — no separate change-password flow needed.
	 */
	async function disableAuth() {
		error = undefined;
		if (!confirm('Disable app auth? The deployment becomes open access until a new password is set.')) return;

		const response = await fetch('/api/auth/password', { method: 'DELETE' });
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		authEnabled = false;
	}

	const PLATFORM_LABELS: Record<string, string> = { twitch: 'Twitch', youtube: 'YouTube' };

	async function disconnectConnection(platform: string, id: string, accountLabel: string) {
		error = undefined;
		if (
			!confirm(
				`Disconnect ${PLATFORM_LABELS[platform] ?? platform} account "${accountLabel}"? You cannot send chat messages through it until you reconnect.`
			)
		) {
			return;
		}
		const response = await fetch(`/api/auth/oauth/connections/${id}`, { method: 'DELETE' });
		if (!response.ok) {
			error = ((await response.json()) as { message?: string }).message ?? response.statusText;
			return;
		}
		platformProviders = platformProviders.map((p) =>
			p.platform === platform ? { ...p, connections: p.connections.filter((c) => c.id !== id) } : p
		);
	}
</script>

<svelte:head>
	<title>All Chat — admin</title>
</svelte:head>

<main>
	<header>
		<h1><a href="/">All Chat</a> / admin</h1>
		<div class="controls">
			<a class="nav" href="/profiles">profiles</a>
			<button onclick={() => toggleTheme()}>theme</button>
		</div>
	</header>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if revealedToken}
		<section class="reveal">
			<p>
				<strong>{revealedToken.label}</strong> — copy it now, it won't be shown again:
			</p>
			<div class="reveal-row">
				<code>{revealedToken.token}</code>
				<button onclick={copyRevealedToken}>{copied ? 'copied!' : 'copy'}</button>
				<button onclick={() => (revealedToken = undefined)}>dismiss</button>
			</div>
		</section>
	{/if}

	<section>
		<h2>Admin password</h2>
		{#if authEnabled}
			<p class="hint">App auth is on — a session, bearer token, or scoped URL token is required for everything except the paths listed in EDD §6.1.</p>
			<button onclick={disableAuth}>disable auth</button>
		{:else}
			<p class="hint">
				App auth is off — the deployment is open access (v1-compatible default). Set a password from
				the <a href="/login">login page</a> to enable it.
			</p>
		{/if}
	</section>

	<section>
		<h2>Platform connections</h2>
		<p class="hint">
			Reading already works anonymously for these — connecting unlocks <em>sending</em> messages through
			them (EDD-V2 §5). Connect as many accounts per platform as you like (a co-streamer's, an alt) — each
			is independent. Kick and Facebook aren't wired up yet.
		</p>

		{#each platformProviders as p (p.platform)}
			<div class="provider">
				<div class="provider-row">
					<span class="name">{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
					{#if !p.configured}
						<span class="meta">not configured on this deployment — set its client id/secret env vars</span>
					{:else}
						<a class="connect" href={`/api/auth/oauth/${p.platform}/start`}>
							{p.connections.length === 0 ? 'connect' : 'connect another account'}
						</a>
					{/if}
				</div>
				{#if p.connections.length > 0}
					<ul class="tokens">
						{#each p.connections as c (c.id)}
							<li>
								<span class="name">{c.accountLabel}</span>
								<span class="meta">connected since {formatDate(c.connectedAt)}</span>
								<button onclick={() => disconnectConnection(p.platform, c.id, c.accountLabel)}>disconnect</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</section>

	<section>
		<h2>Bearer tokens</h2>
		<p class="hint">For headless API clients (e.g. a future mobile app or bot). Grants read access; write is reserved for a future send endpoint.</p>

		{#if bearerTokens.length === 0}
			<p class="empty">None yet.</p>
		{:else}
			<ul class="tokens">
				{#each bearerTokens as t (t.id)}
					<li>
						<span class="name">{t.name}</span>
						<span class="scope">{t.scope}</span>
						<span class="meta">created {formatDate(t.createdAt)} · last used {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'never'}</span>
						<button onclick={() => revokeBearerToken(t.id)}>revoke</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form onsubmit={createBearerToken}>
			<input type="text" placeholder="name (e.g. mobile app)" bind:value={newBearerName} required />
			<select bind:value={newBearerScope}>
				<option value="read">read</option>
				<option value="write">write</option>
			</select>
			<button type="submit">create</button>
		</form>
	</section>

	<section>
		<h2>URL tokens</h2>
		<p class="hint">Read-only — page load + chat stream only, for OBS browser sources. Never grants CRUD.</p>

		{#if urlTokens.length === 0}
			<p class="empty">None yet.</p>
		{:else}
			<ul class="tokens">
				{#each urlTokens as t (t.id)}
					<li>
						<span class="name">{profileName(t.profileId)}</span>
						<span class="meta">created {formatDate(t.createdAt)} · last used {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'never'}</span>
						<button onclick={() => revokeUrlToken(t.id)}>revoke</button>
					</li>
				{/each}
			</ul>
		{/if}

		<form onsubmit={createUrlToken}>
			<select bind:value={newUrlProfileId}>
				<option value="">any profile (URL's own ?profile=)</option>
				{#each profiles as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
			<button type="submit">create</button>
		</form>
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 720px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
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

	h1 a {
		color: var(--text);
		text-decoration: none;
	}

	h1 a:hover {
		color: var(--accent);
	}

	h2 {
		font-size: 1rem;
		margin: 0 0 0.25rem;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.nav {
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.nav:hover {
		color: var(--accent);
	}

	.error {
		color: var(--status-failed);
		margin: 0;
	}

	.hint,
	.empty,
	.meta {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0 0 0.5rem;
	}

	.reveal {
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: 6px;
		padding: 0.75rem;
	}

	.reveal p {
		margin: 0 0 0.5rem;
	}

	.reveal-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.reveal-row code {
		flex: 1;
		overflow-x: auto;
		white-space: nowrap;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
	}

	.provider {
		margin-bottom: 0.75rem;
	}

	.provider-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.tokens {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tokens li {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.name {
		font-weight: 600;
	}

	.scope {
		color: var(--text-muted);
		font-size: 0.85rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 0.35rem;
	}

	.tokens .meta {
		flex: 1;
		margin: 0;
		text-align: right;
	}

	.connect {
		margin-left: auto;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem 0.6rem;
		text-decoration: none;
	}

	.connect:hover {
		border-color: var(--accent);
	}

	form {
		display: flex;
		gap: 0.5rem;
	}

	input,
	select {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
	}

	input {
		flex: 1;
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
</style>
