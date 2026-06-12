import { spinner, multiselect } from '@clack/prompts';
import { exit, handleCancel } from './prompts';
import * as v from 'valibot';

const GUILD_API_BASE = 'https://guild.host/api/next';

const GuildEventSchema = v.object({
	id: v.string(),
	slug: v.string(),
	prettyUrl: v.string(),
	fullUrl: v.string(),
	shortUrl: v.string(),
	name: v.string(),
	description: v.string(),
	startAt: v.string(),
	endAt: v.string(),
	timeZone: v.string(),
	visibility: v.union([v.literal('LISTED'), v.literal('UNLISTED')]),
	hasVenue: v.boolean(),
	hasExternalUrl: v.boolean(),
});

export type GuildEvent = v.InferOutput<typeof GuildEventSchema>;

const EventsResponseSchema = v.object({
	events: v.object({
		edges: v.array(v.object({ node: GuildEventSchema })),
	}),
});

export async function fetchGuildEvents(slug: string): Promise<GuildEvent[]> {
	const s = spinner();
	s.start('Fetching events...');

	try {
		const response = await fetch(
			`${GUILD_API_BASE}/${slug}/events?first=50`,
		);

		if (!response.ok) {
			throw new Error(`Failed to fetch events: ${response.statusText}`);
		}

		const result = v.parse(EventsResponseSchema, await response.json());
		const events = result.events.edges.map((edge) => edge.node);
		s.stop('Events fetched!');
		return events;
	} catch (error) {
		s.stop('Failed to fetch events');
		throw error;
	}
}

export async function selectEvents(
	events: GuildEvent[],
): Promise<GuildEvent[] | symbol> {
	if (events.length === 0) {
		exit('No events found for this guild.');
	}

	const selected = await multiselect({
		message: 'Select events to sync:',
		options: events.map((event) => ({
			value: event,
			label: event.name,
			hint: new Date(event.startAt).toLocaleDateString(),
		})),
		required: false,
	});

	handleCancel(selected);

	if (selected.length === 0) {
		exit('No events selected.');
	}

	return selected;
}
