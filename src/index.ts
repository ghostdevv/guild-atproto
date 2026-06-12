import { intro, outro, group, text, spinner } from '@clack/prompts';
import { type Handle, isHandle } from '@atcute/lexicons/syntax';
import { exit, selectEvents } from './prompts.ts';
import { fetchGuildEvents } from './guild.ts';
import { login } from './oauth.ts';
import {
	guildEventToAtmosphere,
	fetchAtmoEvents,
	eventsAreEqual,
	isOnGuild,
} from './at-events.ts';
import {
	ComAtprotoRepoCreateRecord,
	ComAtprotoRepoPutRecord,
} from '@atcute/atproto';

intro('Guild ATProto Sync');

const GUILD_SLUG_REGEX = /^[a-z0-9-]+$/;

const choices = await group(
	{
		guildSlug: () =>
			text({
				message: 'Enter Guild slug:',
				placeholder: 'svelte-society-london',
				validate(value) {
					if (!value || value.length === 0) {
						return 'Slug is required';
					}

					if (!GUILD_SLUG_REGEX.test(value)) {
						return 'Slug can only contain lowercase letters, numbers, and dashes';
					}
				},
			}),
		handle: () =>
			text({
				message: 'Enter your ATProto handle:',
				placeholder: 'myhandle.npmx.social',
				validate(value) {
					if (!value || value.length === 0) {
						return 'Handle is required';
					}

					if (!isHandle(value)) {
						return 'Handle should be like myhandle.npmx.social';
					}
				},
			}),
	},
	{ onCancel: () => exit('Operation cancelled.') },
);

const session = await login(choices.handle as Handle);

const atmoEvents = await fetchAtmoEvents(session.client, session.actor);
const guildEvents = await fetchGuildEvents(choices.guildSlug);

for (const guildEvent of await selectEvents(atmoEvents, guildEvents)) {
	const s = spinner();
	s.start(`Syncing ${guildEvent.name}`);

	const existingAtmoEvent = atmoEvents.find((e) => isOnGuild(e, guildEvent));
	if (!existingAtmoEvent) {
		const response = await session.client.call(ComAtprotoRepoCreateRecord, {
			input: {
				collection: 'community.lexicon.calendar.event',
				record: guildEventToAtmosphere(guildEvent),
				repo: session.actor,
			},
		});

		if (!response.ok) {
			s.stop(`Failed to create atmosphere event for ${guildEvent.name}`);
			process.exit(1);
		}

		// prettier-ignore
		s.stop(`Created atmosphere event for ${guildEvent.name} (https://pds.ls/${response.data.uri})`);
		continue;
	}

	const newAtmoEvent = guildEventToAtmosphere(guildEvent);

	if (eventsAreEqual(existingAtmoEvent, newAtmoEvent)) {
		const pdsls = `https://pds.ls/at://${session.actor}/community.lexicon.calendar.event/${existingAtmoEvent.rkey}`;
		s.stop(`No changes needed for ${guildEvent.name} (${pdsls})`);
		continue;
	}

	const response = await session.client.call(ComAtprotoRepoPutRecord, {
		input: {
			collection: 'community.lexicon.calendar.event',
			rkey: existingAtmoEvent.rkey,
			record: newAtmoEvent,
			repo: session.actor,
		},
	});

	if (!response.ok) {
		s.stop(`Failed to update atmosphere event for ${guildEvent.name}`);
		process.exit(1);
	}

	// prettier-ignore
	s.stop(`Updated atmosphere event for ${guildEvent.name} (https://pds.ls/${response.data.uri})`);
}

outro('Sync complete!');
process.exit(0);
