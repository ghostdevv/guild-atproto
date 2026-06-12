import type { Did, RecordKey } from '@atcute/lexicons';

export interface GuildEvent {
	id: string;
	slug: string;
	prettyUrl: string;
	fullUrl: string;
	shortUrl: string;
	name: string;
	description: string;
	startAt: string;
	endAt: string;
	timeZone: string;
	visibility: 'LISTED' | 'UNLISTED';
	hasVenue: boolean;
	hasExternalUrl: boolean;
	venue: null;
}

export interface SyncState {
	mappings: Record<string, { rkey: RecordKey; syncedAt: string }>;
	lastSync: string;
	actor?: Did;
}
