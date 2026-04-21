import { spinner, multiselect } from '@clack/prompts';
import { exit, handleCancel } from './prompts';
import type { GuildEvent } from './types';

const GUILD_API_BASE = 'https://guild.host/api/next';

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

		const data = (await response.json()) as {
			events: { edges: { node: GuildEvent }[] };
		};

		const events = data.events.edges.map((edge) => edge.node);
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
