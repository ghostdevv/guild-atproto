import { CommunityLexiconCalendarEvent } from '@atcute/lexicon-community';
import * as v from '@atcute/lexicons/validations';
import { isDeepStrictEqual } from 'node:util';
import type { GuildEvent } from './guild.ts';
import type { Client } from '@atcute/client';
import { spinner } from '@clack/prompts';
import { images } from './storage.ts';
import * as CID from '@atcute/cid';
import {
	parseResourceUri,
	type RecordKey,
	type Did,
	is,
} from '@atcute/lexicons';
import {
	ComAtprotoRepoListRecords,
	ComAtprotoRepoUploadBlob,
} from '@atcute/atproto';

// Extended to add the atmo.rsvp media field
const AtmoEventSchema = v.object({
	...CommunityLexiconCalendarEvent.mainSchema.object.shape,
	media: v.optional(
		v.array(
			v.object({
				role: v.literal('thumbnail'),
				content: v.blob(),
			}),
		),
	),
	additionalData: v.optional(
		v.object({
			externalSource: v.optional(
				v.object({
					url: v.genericUriString(),
					rsvpMode: v.literalEnum(['atmo_too', 'external_only']),
				}),
			),
		}),
	),
});

export type AtmoEvent = v.InferOutput<typeof AtmoEventSchema>;

export async function fetchAtmoEvents(client: Client, repo: Did) {
	const events: (AtmoEvent & { rkey: RecordKey })[] = [];
	let cursor: string | undefined;

	const s = spinner();
	s.start('Fetching atmosphere events');

	do {
		const response = await client.call(ComAtprotoRepoListRecords, {
			params: {
				collection: 'community.lexicon.calendar.event',
				limit: 30,
				repo,
			},
		});

		if (!response.ok) {
			s.error(`failed to fetch events: ${response.data.error}`);
			process.exit(1);
		}

		const hasMore =
			response.data.records.length === 30 &&
			response.data.cursor !== cursor;

		// oxlint-disable-next-line no-undefined
		cursor = hasMore ? response.data.cursor : undefined;

		for (const record of response.data.records) {
			if (!is(CommunityLexiconCalendarEvent.mainSchema, record.value)) {
				// prettier-ignore
				s.error(`invalid event record: ${JSON.stringify(record.value)}`);
				process.exit(1);
			}

			const parsed = parseResourceUri(record.uri);

			if (!parsed.rkey) {
				s.error(`event uri missing rkey: ${record.uri}`);
				process.exit(1);
			}

			events.push({ ...record.value, rkey: parsed.rkey });
		}
	} while (cursor);

	s.stop(`Found ${events.length} atmosphere events`);
	return events;
}

export async function guildEventToAtmosphere(
	client: Client,
	event: GuildEvent,
	existingAtmoEvent?: AtmoEvent,
): Promise<AtmoEvent> {
	const media = await getEventMedia(client, event, existingAtmoEvent);

	let mode: AtmoEvent['mode'] = 'community.lexicon.calendar.event#inperson';
	if (event.hasExternalUrl && !event.hasVenue) {
		mode = 'community.lexicon.calendar.event#virtual';
	} else if (event.hasExternalUrl && event.hasVenue) {
		mode = 'community.lexicon.calendar.event#hybrid';
	}

	return {
		$type: 'community.lexicon.calendar.event',
		name: event.name,
		description: `> Heads up! You must [register on Guild](${event.fullUrl}) to attend this event __in-person__.\n\n${event.description}`,
		createdAt: event.createdAt.toISOString(),
		startsAt: event.startAt,
		endsAt: event.endAt,
		mode,
		status: 'community.lexicon.calendar.event#scheduled',
		locations: [
			{
				$type: 'community.lexicon.calendar.event#uri',
				name: 'Register on Guild',
				uri: event.fullUrl,
			},
		],
		uris: [
			{
				$type: 'community.lexicon.calendar.event#uri',
				name: 'Register on Guild',
				uri: event.fullUrl,
			},
		],
		rsvpExpected: true,
		media,
		additionalData: {
			externalSource: {
				rsvpMode: 'external_only',
				url: event.fullUrl,
			},
		},
	};
}

export function isOnGuild(event: AtmoEvent, guildEvent: GuildEvent): boolean {
	const hasLocation = event.locations?.some(
		(l) =>
			l.$type === 'community.lexicon.calendar.event#uri' &&
			l.uri === guildEvent.fullUrl,
	);

	const hasURI = event.uris?.some((u) => u.uri === guildEvent.fullUrl);

	return hasLocation ?? hasURI ?? false;
}

export function eventsAreEqual(
	before: AtmoEvent & { rkey?: RecordKey },
	after: AtmoEvent,
): boolean {
	const { rkey: _rkey, ...beforeFiltered } = before;
	return isDeepStrictEqual(beforeFiltered, after);
}

async function getEventMedia(
	client: Client,
	guildEvent: GuildEvent,
	atmoEvent?: AtmoEvent,
): Promise<AtmoEvent['media']> {
	const image = await images.getOrSet(guildEvent.uploadedSocialCard.url);

	if (atmoEvent?.media) {
		const thumb = atmoEvent.media.find((m) => m.role === 'thumbnail');

		if (thumb) {
			const cid = await CID.create(0x55, new Uint8Array(image));
			const cidString = CID.toString(cid);

			if (thumb.content.ref.$link === cidString) {
				return [thumb];
			}
		}
	}

	const response = await client.call(ComAtprotoRepoUploadBlob, {
		input: image,
		headers: {
			'Content-Type': 'image/png',
		},
	});

	if (!response.ok) {
		throw new Error('Failed to upload blob', { cause: response.data });
	}

	return [
		{
			role: 'thumbnail',
			content: response.data.blob,
		},
	];
}
