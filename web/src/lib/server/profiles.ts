import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Profile, SourceConfig } from '@all-chat/contract';

const DATA_DIR = process.env.DATA_DIR ?? 'data';
const PROFILES_PATH = join(DATA_DIR, 'profiles.json');

const slugify = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'profile';

export const newSourceId = () => randomBytes(4).toString('hex');

async function load(): Promise<Profile[]> {
	try {
		return JSON.parse(await readFile(PROFILES_PATH, 'utf8')) as Profile[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

/** Atomic write: temp file then rename (EDD §3.4). */
async function save(profiles: Profile[]): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
	const tmp = `${PROFILES_PATH}.tmp`;
	await writeFile(tmp, JSON.stringify(profiles, null, '\t'), 'utf8');
	await rename(tmp, PROFILES_PATH);
}

export async function listProfiles(): Promise<Profile[]> {
	return load();
}

export async function findProfile(idOrName: string): Promise<Profile | undefined> {
	const profiles = await load();
	const needle = idOrName.toLowerCase();
	return profiles.find((p) => p.id === idOrName || p.name.toLowerCase() === needle);
}

export async function createProfile(name: string, sources: SourceConfig[]): Promise<Profile> {
	const profiles = await load();
	let id = slugify(name);
	while (profiles.some((p) => p.id === id)) id = `${slugify(name)}-${newSourceId().slice(0, 4)}`;
	const profile: Profile = { id, name, sources };
	profiles.push(profile);
	await save(profiles);
	return profile;
}

export async function updateProfile(id: string, patch: Pick<Profile, 'name' | 'sources'>): Promise<Profile | undefined> {
	const profiles = await load();
	const index = profiles.findIndex((p) => p.id === id);
	if (index === -1) return undefined;
	profiles[index] = { ...profiles[index], name: patch.name, sources: patch.sources };
	await save(profiles);
	return profiles[index];
}

export async function deleteProfile(id: string): Promise<boolean> {
	const profiles = await load();
	const next = profiles.filter((p) => p.id !== id);
	if (next.length === profiles.length) return false;
	await save(next);
	return true;
}
