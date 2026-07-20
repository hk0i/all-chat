<script lang="ts">
	import type { Platform, Profile } from '@all-chat/contract';
	import { toggleTheme } from '$lib/theme';

	let { data } = $props();

	/* Local working copy on purpose: mutations land via API calls below, not re-runs of load. */
	// svelte-ignore state_referenced_locally
	let profiles = $state<Profile[]>(data.profiles);

	/**
	 * Source row being edited. `id` is absent on newly added rows — the server
	 * assigns one on save so ChatMessage.sourceId stays stable for the row's
	 * whole life. `key` is a client-only handle for Svelte's keyed each
	 * (reorder-safe, unlike an array index).
	 */
	interface DraftSource {
		key: string;
		id?: string;
		platform: Platform;
		channel: string;
		label: string;
	}

	interface Draft {
		/** Profile id being edited, or undefined for a brand-new profile. */
		id?: string;
		name: string;
		sources: DraftSource[];
	}

	let draft = $state<Draft | undefined>();
	let error = $state<string | undefined>();
	let saving = $state(false);

	const newKey = () => crypto.randomUUID();

	const CHANNEL_PLACEHOLDER: Record<Platform, string> = {
		twitch: 'channel name',
		kick: 'chatroom id (or channel slug)',
		youtube: '@handle, video URL, or video id'
	};

	function edit(profile: Profile) {
		error = undefined;
		draft = {
			id: profile.id,
			name: profile.name,
			sources: profile.sources.map((source) => ({
				key: newKey(),
				id: source.id,
				platform: source.platform,
				channel: source.channel,
				label: source.label ?? ''
			}))
		};
	}

	function startNew() {
		error = undefined;
		draft = { name: '', sources: [] };
	}

	function addSource() {
		if (!draft) return;
		draft.sources.push({ key: newKey(), platform: 'twitch', channel: '', label: '' });
	}

	function removeSource(index: number) {
		draft?.sources.splice(index, 1);
	}

	function moveSource(index: number, delta: -1 | 1) {
		if (!draft) return;
		const target = index + delta;
		if (target < 0 || target >= draft.sources.length) return;
		const [row] = draft.sources.splice(index, 1);
		draft.sources.splice(target, 0, row);
	}

	async function save() {
		if (!draft) return;
		saving = true;
		error = undefined;
		const body = JSON.stringify({
			name: draft.name,
			sources: draft.sources.map(({ id, platform, channel, label }) => ({
				...(id ? { id } : {}),
				platform,
				channel,
				...(label.trim() ? { label: label.trim() } : {})
			}))
		});
		try {
			const response = await fetch(draft.id ? `/api/profiles/${draft.id}` : '/api/profiles', {
				method: draft.id ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				body
			});
			if (!response.ok) {
				error = ((await response.json()) as { message?: string }).message ?? response.statusText;
				return;
			}
			const saved = (await response.json()) as Profile;
			profiles = draft.id
				? profiles.map((p) => (p.id === saved.id ? saved : p))
				: [...profiles, saved];
			draft = undefined;
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			saving = false;
		}
	}

	async function remove(profile: Profile) {
		if (!confirm(`Delete profile "${profile.name}"?`)) return;
		error = undefined;
		const response = await fetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
		if (!response.ok && response.status !== 404) {
			error = `delete failed (${response.status})`;
			return;
		}
		profiles = profiles.filter((p) => p.id !== profile.id);
		if (draft?.id === profile.id) draft = undefined;
	}
</script>

<svelte:head>
	<title>All Chat — Profiles</title>
</svelte:head>

<main>
	<header>
		<h1><a href="/">All Chat</a> / profiles</h1>
		<button onclick={() => toggleTheme()}>theme</button>
	</header>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<ul class="profiles">
		{#each profiles as profile (profile.id)}
			<li class="profile" class:editing={draft?.id === profile.id}>
				<div class="profile-row">
					<span class="name">{profile.name}</span>
					<span class="summary">
						{profile.sources.length} source{profile.sources.length === 1 ? '' : 's'}
					</span>
					<a class="watch" href="/?profile={profile.id}">watch</a>
					<button onclick={() => edit(profile)}>edit</button>
					<button class="danger" onclick={() => remove(profile)}>delete</button>
				</div>
			</li>
		{:else}
			<li class="empty">No profiles yet — create one to group chat sources.</li>
		{/each}
	</ul>

	{#if draft}
		<section class="editor">
			<h2>{draft.id ? 'Edit profile' : 'New profile'}</h2>
			<label class="field">
				Name
				<input bind:value={draft.name} placeholder="e.g. Gaming" />
			</label>

			<h3>Sources</h3>
			{#each draft.sources as source, index (source.key)}
				<div class="source-row">
					<select bind:value={source.platform}>
						<option value="twitch">Twitch</option>
						<option value="kick">Kick</option>
						<option value="youtube">YouTube</option>
					</select>
					<input
						class="channel"
						bind:value={source.channel}
						placeholder={CHANNEL_PLACEHOLDER[source.platform]}
					/>
					<input class="label" bind:value={source.label} placeholder="label (optional)" />
					<button aria-label="move up" disabled={index === 0} onclick={() => moveSource(index, -1)}
						>↑</button
					>
					<button
						aria-label="move down"
						disabled={index === draft.sources.length - 1}
						onclick={() => moveSource(index, 1)}>↓</button
					>
					<button class="danger" aria-label="remove source" onclick={() => removeSource(index)}
						>✕</button
					>
				</div>
			{:else}
				<p class="empty">No sources — the feed will be empty until you add one.</p>
			{/each}
			<button onclick={addSource}>+ add source</button>

			<div class="actions">
				<button class="primary" disabled={saving || !draft.name.trim()} onclick={save}>
					{saving ? 'saving…' : 'save'}
				</button>
				<button onclick={() => (draft = undefined)}>cancel</button>
			</div>
		</section>
	{:else}
		<button class="primary" onclick={startNew}>+ new profile</button>
	{/if}
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

	h2,
	h3 {
		font-size: 1rem;
		margin: 0;
	}

	.error {
		color: var(--status-failed);
		margin: 0;
	}

	.profiles {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.profile {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}

	.profile.editing {
		border-color: var(--accent);
	}

	.profile-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.name {
		font-weight: 600;
	}

	.summary {
		color: var(--text-muted);
		flex: 1;
	}

	.watch {
		color: var(--accent);
	}

	.empty {
		color: var(--text-muted);
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.source-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.source-row .channel {
		flex: 2;
		min-width: 0;
	}

	.source-row .label {
		flex: 1;
		min-width: 0;
	}

	input,
	select {
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
		font: inherit;
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: var(--accent);
	}

	button {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.25rem 0.6rem;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--neutral-800);
		font-weight: 600;
		align-self: flex-start;
	}

	button.danger:hover:not(:disabled) {
		border-color: var(--status-failed);
		color: var(--status-failed);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
</style>
