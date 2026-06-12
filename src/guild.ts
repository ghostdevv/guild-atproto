import { spinner } from '@clack/prompts';
import * as v from 'valibot';

const GUILD_API_BASE = 'https://guild.host/api/next';

const URLSchema = v.rawTransform<string, `https://${string}`>((ctx) => {
	const url = new URL(ctx.dataset.value);

	if (url.protocol !== 'https:') {
		ctx.addIssue({ message: 'fullUrl must be a https url' });
		return ctx.NEVER;
	}

	return url.toString() as `https://${string}`;
});

const GuildEventSchema = v.object({
	slug: v.string(),
	fullUrl: v.pipe(v.string(), URLSchema),
	name: v.string(),
	description: v.string(),
	startAt: v.string(),
	endAt: v.string(),
	timeZone: v.string(),
	visibility: v.union([v.literal('LISTED'), v.literal('UNLISTED')]), // todo skip unlisted
	hasVenue: v.boolean(),
	hasExternalUrl: v.boolean(),
	createdAt: v.pipe(v.string(), v.toDate()),
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
		const url = new URL(GUILD_API_BASE);
		url.pathname += `/${slug}/events`;
		url.searchParams.set('first', '50');

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Failed to fetch events: ${response.statusText}`);
		}

		const result = v.parse(EventsResponseSchema, await response.json());
		const events = result.events.edges.map((edge) => edge.node);

		s.stop('Events fetched!');
		return events;
	} catch (error) {
		s.stop('Failed to fetch guild events');
		throw error;
	}
}
