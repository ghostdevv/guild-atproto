import { CommunityLexiconCalendarEvent } from '@atcute/lexicon-community';
import { ComAtprotoRepoListRecords } from '@atcute/atproto';
import type { GuildEvent } from './guild.ts';
import type { Client } from '@atcute/client';
import { spinner } from '@clack/prompts';
import { dequal } from 'dequal';
import {
	parseResourceUri,
	type RecordKey,
	type Did,
	is,
} from '@atcute/lexicons';

export type AtmoEvent = CommunityLexiconCalendarEvent.Main;

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

export function guildEventToAtmosphere(event: GuildEvent): AtmoEvent {
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
		rsvpExpected: false,
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
	return dequal(beforeFiltered, after);
}
