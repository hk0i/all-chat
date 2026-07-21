<script lang="ts">
	import { goto } from '$app/navigation';

	let { data } = $props();

	let password = $state('');
	let confirmPassword = $state('');
	let error = $state<string | undefined>();
	let submitting = $state(false);

	const MIN_PASSWORD_LENGTH = 8;

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = undefined;

		if (!data.enabled && password !== confirmPassword) {
			error = "passwords don't match";
			return;
		}

		submitting = true;
		try {
			const response = await fetch(data.enabled ? '/api/auth/login' : '/api/auth/setup', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (!response.ok) {
				error = ((await response.json()) as { message?: string }).message ?? response.statusText;
				return;
			}
			await goto('/');
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>All Chat — {data.enabled ? 'Log in' : 'Set admin password'}</title>
</svelte:head>

<main>
	<form onsubmit={submit}>
		<h1>{data.enabled ? 'Log in' : 'Set admin password'}</h1>
		{#if !data.enabled}
			<p class="hint">
				No admin password is set yet — choose one now to enable app auth
				(EDD §6.1). Access is public until a password is set.
			</p>
		{/if}

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<label>
			Password
			<input type="password" bind:value={password} minlength={data.enabled ? undefined : MIN_PASSWORD_LENGTH} required />
		</label>

		{#if !data.enabled}
			<label>
				Confirm password
				<input type="password" bind:value={confirmPassword} minlength={MIN_PASSWORD_LENGTH} required />
			</label>
		{/if}

		<button type="submit" disabled={submitting}>
			{submitting ? 'Working…' : data.enabled ? 'Log in' : 'Set password'}
		</button>
	</form>
</main>

<style>
	main {
		display: flex;
		justify-content: center;
		padding: 3rem 1rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 360px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 1.5rem;
	}

	h1 {
		font-size: 1.1rem;
		margin: 0;
	}

	.hint {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.error {
		color: var(--status-failed);
		margin: 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	input {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		color: var(--text);
		font-size: 1rem;
	}

	button {
		margin-top: 0.5rem;
		background: var(--accent);
		color: var(--bg);
		border: none;
		border-radius: 4px;
		padding: 0.5rem;
		font-size: 1rem;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
