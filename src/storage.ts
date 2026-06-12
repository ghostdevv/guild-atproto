import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Did, RecordKey } from '@atcute/lexicons';
import type { SyncState } from './types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'sync-state.json';
const DATA_DIR = join(import.meta.dirname, '../.data');

export async function ensureDataDir(): Promise<void> {
	if (!existsSync(DATA_DIR)) {
		await mkdir(DATA_DIR, { recursive: true });
	}
}

export async function loadSyncState(): Promise<SyncState> {
	const statePath = join(DATA_DIR, STATE_FILE);

	if (!existsSync(statePath)) {
		return { mappings: {}, lastSync: new Date().toISOString() };
	}

	const data = await readFile(statePath, 'utf-8');
	return JSON.parse(data) as SyncState;
}

export async function saveSyncState(state: SyncState): Promise<void> {
	await ensureDataDir();
	const statePath = join(DATA_DIR, STATE_FILE);
	await writeFile(statePath, JSON.stringify(state, null, 2));
}

export async function getMapping(
	guildSlug: string,
): Promise<{ rkey: string; syncedAt: string } | null> {
	const state = await loadSyncState();
	return state.mappings[guildSlug] ?? null;
}

export async function setMapping(
	guildSlug: string,
	rkey: RecordKey,
): Promise<void> {
	const state = await loadSyncState();
	state.mappings[guildSlug] = { rkey, syncedAt: new Date().toISOString() };
	state.lastSync = new Date().toISOString();
	await saveSyncState(state);
}

export async function setActor(actor: Did): Promise<void> {
	const state = await loadSyncState();
	state.actor = actor;
	await saveSyncState(state);
}
