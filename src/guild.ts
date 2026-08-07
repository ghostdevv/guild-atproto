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

const InstantSchema = v.pipe(
	v.string(),
	v.trim(),
	v.rawTransform((ctx) => {
		try {
			return Temporal.Instant.from(ctx.dataset.value);
		} catch (error) {
			// oxlint-disable-next-line typescript/restrict-template-expressions
			const message = Error.isError(error) ? error.message : `${error}`;
			ctx.addIssue({ message: `invalid instant: ${message}` });
			return ctx.NEVER;
		}
	}),
);

const GuildEventSchema = v.object({
	slug: v.string(),
	fullUrl: v.pipe(v.string(), URLSchema),
	name: v.string(),
	description: v.optional(v.string()),
	startAt: InstantSchema,
	endAt: InstantSchema,
	timeZone: v.string(),
	visibility: v.union([v.literal('LISTED'), v.literal('UNLISTED')]),
	hasVenue: v.boolean(),
	hasExternalUrl: v.boolean(),
	createdAt: InstantSchema,
	uploadedSocialCard: v.nullable(
		v.object({
			url: v.pipe(
				v.string(),
				URLSchema,
				v.check((url) => url.endsWith('png'), 'url is png'),
			),
		}),
	),
	generatedSocialCardURL: v.nullable(
		v.pipe(
			v.string(),
			URLSchema,
			v.check((url) => url.endsWith('svg'), 'url is svg'),
		),
	),
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

		const events = result.events.edges
			.map((edge) => edge.node)
			.filter((event) => event.visibility === 'LISTED');

		s.stop('Events fetched!');
		return events;
	} catch (error) {
		s.stop('Failed to fetch guild events');
		throw error;
	}
}

const PresentationSchema = v.object({
	title: v.string(),
	description: v.nullish(v.string()),
	videoSourceUrl: v.nullish(v.string()),
	presenter: v.nullish(
		v.object({ firstName: v.string(), lastName: v.string() }),
	),
	presenterFirstName: v.nullish(v.string()),
	presenterLastName: v.nullish(v.string()),
});

export type GuildPresentation = v.InferOutput<typeof PresentationSchema>;

const EventDetailSchema = v.object({
	presentations: v.object({
		edges: v.array(v.object({ node: PresentationSchema })),
	}),
});

export async function fetchGuildPresentations(
	slug: string,
): Promise<GuildPresentation[]> {
	const url = new URL(GUILD_API_BASE);
	url.pathname += `/events/${slug}`;

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Failed to fetch event: ${response.statusText}`);
	}

	const result = v.parse(EventDetailSchema, await response.json());
	return result.presentations.edges.map((edge) => edge.node);
}

const AttendeesResponseSchema = v.object({ totalCount: v.number() });

export async function fetchGuildAttendeeCount(
	slug: string,
	accessToken: string,
): Promise<number | null> {
	const url = new URL(GUILD_API_BASE);
	url.pathname += `/events/${slug}/attendees`;
	url.searchParams.set('first', '1');

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) return null;

	const result = v.parse(AttendeesResponseSchema, await response.json());
	return result.totalCount;
}
