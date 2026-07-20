import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Which profile a profile-agnostic overlay URL (`?overlay=1`, no `profile=`)
 * currently resolves to — lets one fixed OBS Browser Source URL be
 * repointed at a different profile from the Profiles page, without editing
 * the source in OBS (EDD §3). A single global pointer, not per-source —
 * one overlay, swappable across profiles.
 */

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const POINTER_PATH = join(DATA_DIR, 'overlay-profile.json');

interface OverlayPointer {
	profileId: string | null;
}

async function load(): Promise<OverlayPointer> {
	try {
		return JSON.parse(await readFile(POINTER_PATH, 'utf8')) as OverlayPointer;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profileId: null };
		throw error;
	}
}

/** Atomic write: temp file then rename (same pattern as profiles.ts). */
async function save(pointer: OverlayPointer): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
	const tmp = `${POINTER_PATH}.tmp`;
	await writeFile(tmp, JSON.stringify(pointer, null, '\t'), 'utf8');
	await rename(tmp, POINTER_PATH);
}

export async function getOverlayProfileId(): Promise<string | null> {
	return (await load()).profileId;
}

export async function setOverlayProfileId(profileId: string | null): Promise<void> {
	await save({ profileId });
}
