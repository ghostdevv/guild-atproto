import type { SessionStore, StoredSession } from '@atcute/oauth-node-client';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { Did, Handle } from '@atcute/lexicons';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dirname, '../.data');
if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

async function read<T>(file: string, fallback: T): Promise<T> {
	if (!existsSync(file)) return fallback;
	const contents = await readFile(file, 'utf-8');
	return JSON.parse(contents);
}

class Storage<T> {
	private readonly file;
	protected value;

	constructor(file: string, value: T) {
		this.file = file;
		this.value = value;
	}

	protected async save() {
		await writeFile(this.file, JSON.stringify(this.value, null, 2));
	}
}

type SessionsData = Record<Did, StoredSession>;

class Sessions extends Storage<SessionsData> implements SessionStore {
	get(key: Did) {
		return this.value[key];
	}

	async set(key: Did, value: StoredSession) {
		this.value[key] = value;
		await this.save();
	}

	async delete(key: Did) {
		// oxlint-disable-next-line typescript/no-dynamic-delete
		delete this.value[key];
		await this.save();
	}

	async clear() {
		this.value = {};
		await this.save();
	}
}

const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

export const sessions = new Sessions(
	SESSIONS_FILE,
	await read(SESSIONS_FILE, {}),
);

class Handles extends Storage<Record<Handle, Did>> {
	get(identifier: Handle) {
		return this.value[identifier];
	}

	async set(identifier: Handle, did: Did) {
		this.value[identifier] = did;
		await this.save();
	}
}

const HANDLES_FILE = join(DATA_DIR, 'handles.json');

export const handles = new Handles(HANDLES_FILE, await read(HANDLES_FILE, {}));
