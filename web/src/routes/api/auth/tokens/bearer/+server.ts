import { error, json } from '@sveltejs/kit';
import { createBearerToken, listBearerTokens } from '$lib/server/auth/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listBearerTokens());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown; scope?: unknown } | null;
	if (!body || typeof body.name !== 'string' || !body.name.trim()) {
		throw error(400, 'name is required');
	}
	if (body.scope !== 'read' && body.scope !== 'write') throw error(400, "scope must be 'read' or 'write'");

	// The plaintext token is only ever returned here, at creation time — the server keeps only its hash.
	const { id, token } = await createBearerToken(body.name.trim(), body.scope);
	return json({ id, token });
};
