import {
	ComAtprotoRepoCreateRecord,
	ComAtprotoRepoListRecords,
	ComAtprotoRepoPutRecord,
} from '@atcute/atproto';
import { parseResourceUri, type Did, type RecordKey } from '@atcute/lexicons';
import { isDeepStrictEqual } from 'node:util';
import * as v from 'valibot';
import type { GuildPresentation } from './guild.ts';
import type { Client } from '@atcute/client';

const TALK_COLLECTION = 'dev.npmx.calendar.talk';

const StrongRefSchema = v.object({
	$type: v.literal('com.atproto.repo.strongRef'),
	uri: v.string(),
	cid: v.string(),
});

const TalkSchema = v.object({
	$type: v.literal('dev.npmx.calendar.talk'),
	event: StrongRefSchema,
	title: v.string(),
	abstract: v.optional(v.string()),
	speakers: v.optional(v.array(v.object({ name: v.string() }))),
	recording: v.optional(v.object({ uri: v.string() })),
	createdAt: v.string(),
});

export type StrongRef = v.InferOutput<typeof StrongRefSchema>;
export type Talk = v.InferOutput<typeof TalkSchema>;

function presenterName(presentation: GuildPresentation): string | undefined {
	if (presentation.presenter) {
		const { firstName, lastName } = presentation.presenter;
		return `${firstName} ${lastName}`.trim();
	}

	const name = [
		presentation.presenterFirstName,
		presentation.presenterLastName,
	]
		.filter(Boolean)
		.join(' ')
		.trim();

	return name || undefined;
}

export function presentationToTalk(
	event: StrongRef,
	presentation: GuildPresentation,
	createdAt: string,
): Talk {
	const name = presenterName(presentation);

	const talk: Talk = {
		$type: 'dev.npmx.calendar.talk',
		event,
		title: presentation.title,
		createdAt,
	};

	if (presentation.description) talk.abstract = presentation.description;
	if (name) talk.speakers = [{ name }];
	if (presentation.videoSourceUrl) {
		talk.recording = { uri: presentation.videoSourceUrl };
	}

	return talk;
}

export function talkKey(talk: Pick<Talk, 'event' | 'title'>): string {
	return `${talk.event.uri}::${talk.title}`;
}

export function talksAreEqual(
	before: Talk & { rkey?: RecordKey },
	after: Talk,
): boolean {
	const { rkey: _rkey, ...beforeFiltered } = before;
	return isDeepStrictEqual(beforeFiltered, after);
}

export async function fetchAtmoTalks(client: Client, repo: Did) {
	const talks: (Talk & { rkey: RecordKey })[] = [];
	let cursor: string | undefined;

	do {
		const response = await client.call(ComAtprotoRepoListRecords, {
			params: { collection: TALK_COLLECTION, limit: 100, repo, cursor },
		});

		if (!response.ok) break;

		for (const record of response.data.records) {
			if (!v.is(TalkSchema, record.value)) continue;

			const parsed = parseResourceUri(record.uri);
			if (parsed.rkey) {
				talks.push({ ...record.value, rkey: parsed.rkey });
			}
		}

		const hasMore =
			response.data.records.length === 100 &&
			response.data.cursor !== cursor;

		// oxlint-disable-next-line no-undefined
		cursor = hasMore ? response.data.cursor : undefined;
	} while (cursor);

	return talks;
}

export async function syncTalks(
	client: Client,
	repo: Did,
	event: StrongRef,
	presentations: GuildPresentation[],
	existingTalks: (Talk & { rkey: RecordKey })[],
): Promise<{ created: number; updated: number }> {
	let created = 0;
	let updated = 0;

	for (const presentation of presentations) {
		const key = `${event.uri}::${presentation.title}`;
		const existing = existingTalks.find((t) => talkKey(t) === key);
		const talk = presentationToTalk(
			event,
			presentation,
			existing?.createdAt ?? new Date().toISOString(),
		);

		if (!existing) {
			await client.call(ComAtprotoRepoCreateRecord, {
				input: { collection: TALK_COLLECTION, record: talk, repo },
			});
			created++;
			continue;
		}

		if (talksAreEqual(existing, talk)) continue;

		await client.call(ComAtprotoRepoPutRecord, {
			input: {
				collection: TALK_COLLECTION,
				rkey: existing.rkey,
				record: talk,
				repo,
			},
		});
		updated++;
	}

	return { created, updated };
}
