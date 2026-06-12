import { CommunityLexiconCalendarEvent } from '@atcute/lexicon-community';
import { ok, type Client } from '@atcute/client';
import { is, type Did } from '@atcute/lexicons';
import type { GuildEvent } from './guild';
import { mappings } from './storage';
import { dequal } from 'dequal';
import { log } from '@clack/prompts';

function mapToCalendarEvent(
	event: GuildEvent,
): CommunityLexiconCalendarEvent.Main {
	const uris: CommunityLexiconCalendarEvent.Main['uris'] = [];

	if (event.fullUrl) {
		uris.push({
			uri: event.fullUrl as `${string}:${string}`,
			name: 'Register on Guild',
		});
	}

	let mode: CommunityLexiconCalendarEvent.Main['mode'] =
		'community.lexicon.calendar.event#inperson';
	if (event.hasExternalUrl && !event.hasVenue) {
		mode = 'community.lexicon.calendar.event#virtual';
	} else if (event.hasExternalUrl && event.hasVenue) {
		mode = 'community.lexicon.calendar.event#hybrid';
	}

	return {
		$type: 'community.lexicon.calendar.event',
		createdAt: new Date().toISOString(),
		name: event.name,
		description: event.description,
		startsAt: event.startAt,
		endsAt: event.endAt,
		mode,
		status: 'community.lexicon.calendar.event#scheduled',
		uris,
		locations: [],
	};
}

export async function syncEvent(
	repo: Did,
	client: Client,
	event: GuildEvent,
): Promise<{ action: 'created' | 'updated' | 'skipped'; rkey?: string }> {
	const record = mapToCalendarEvent(event);
	const existingMapping = mappings.get(event.slug);

	if (!existingMapping) {
		const rkey = crypto.randomUUID();

		await ok(
			client.post('com.atproto.repo.createRecord', {
				input: {
					repo,
					collection: 'community.lexicon.calendar.event',
					rkey,
					record,
				},
			}),
		);

		await mappings.set(event.slug, rkey);

		return { action: 'created', rkey };
	}

	const existingResult = await client.get('com.atproto.repo.getRecord', {
		params: {
			repo,
			collection: 'community.lexicon.calendar.event',
			rkey: existingMapping.rkey,
		},
	});

	if (!existingResult.ok) {
		const rkey = crypto.randomUUID();

		await ok(
			client.post('com.atproto.repo.createRecord', {
				input: {
					repo,
					collection: 'community.lexicon.calendar.event',
					rkey,
					record,
				},
			}),
		);

		await mappings.set(event.slug, rkey);

		return { action: 'created', rkey };
	}

	const existingRecord = existingResult.data;

	if (!is(CommunityLexiconCalendarEvent.mainSchema, existingRecord)) {
		log.warn('fetched record does not match schema, skipping completely');
		return { action: 'skipped', rkey: existingMapping.rkey };
	}

	if (dequal(existingRecord, record)) {
		return { action: 'skipped', rkey: existingMapping.rkey };
	}

	await ok(
		client.post('com.atproto.repo.putRecord', {
			input: {
				repo,
				collection: 'community.lexicon.calendar.event',
				rkey: existingMapping.rkey,
				record,
			},
		}),
	);

	await mappings.set(event.slug, existingMapping.rkey);

	return { action: 'updated', rkey: existingMapping.rkey };
}

export async function syncEvents(
	repo: Did,
	client: Client,
	events: GuildEvent[],
): Promise<void> {
	for (const event of events) {
		const result = await syncEvent(repo, client, event);
		console.log(
			`${event.name}: ${result.action}`,
			result.rkey ? `(${result.rkey})` : '',
		);
	}
}
