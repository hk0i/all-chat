import { json } from '@sveltejs/kit';
import { API_VERSION } from '@all-chat/contract';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ ok: true, apiVersion: API_VERSION });
