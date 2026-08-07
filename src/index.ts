import { intro, outro, group, text, spinner } from '@clack/prompts';
import { type Handle, isHandle } from '@atcute/lexicons/syntax';
// import { authenticateWithGuild } from './guild-oauth.ts';
import { exit, selectEvents } from './prompts.ts';
import { fetchGuildEvents, fetchGuildPresentations } from './guild.ts';
import { login } from './oauth.ts';
import {
	guildEventToAtmosphere,
	fetchAtmoEvents,
	eventsAreEqual,
	isOnGuild,
} from './at-events.ts';
import { fetchAtmoTalks, syncTalks, type StrongRef } from './talks.ts';
import {
	ComAtprotoRepoCreateRecord,
	ComAtprotoRepoPutRecord,
} from '@atcute/atproto';

intro('Guild ATProto Sync');

// todo, when the api returns the online location when
// you're authenticated, re-enable this and use it to
// add the youtube/stream.place links to the atmo event
// const _guildTokens = await authenticateWithGuild();

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
const atmoTalks = await fetchAtmoTalks(session.client, session.actor);
const guildEvents = await fetchGuildEvents(choices.guildSlug);

for (const guildEvent of await selectEvents(atmoEvents, guildEvents)) {
	const s = spinner();
	s.start(`Syncing ${guildEvent.name}`);

	const existingAtmoEvent = atmoEvents.find((e) => isOnGuild(e, guildEvent));

	const newAtmoEvent = await guildEventToAtmosphere(
		session.client,
		guildEvent,
		existingAtmoEvent,
	);

	let eventRef: StrongRef;

	if (!existingAtmoEvent) {
		const response = await session.client.call(ComAtprotoRepoCreateRecord, {
			input: {
				collection: 'community.lexicon.calendar.event',
				record: newAtmoEvent,
				repo: session.actor,
			},
		});

		if (!response.ok) {
			s.stop(`Failed to create atmosphere event for ${guildEvent.name}`);
			process.exit(1);
		}

		// prettier-ignore
		s.stop(`Created atmosphere event for ${guildEvent.name} (https://pds.ls/${response.data.uri})`);
		eventRef = {
			$type: 'com.atproto.repo.strongRef',
			uri: response.data.uri,
			cid: response.data.cid,
		};
	} else if (eventsAreEqual(existingAtmoEvent, newAtmoEvent)) {
		const uri = `at://${session.actor}/community.lexicon.calendar.event/${existingAtmoEvent.rkey}`;
		s.stop(
			`No changes needed for ${guildEvent.name} (https://pds.ls/${uri})`,
		);
		eventRef = {
			$type: 'com.atproto.repo.strongRef',
			uri,
			cid: existingAtmoEvent.cid,
		};
	} else {
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
		eventRef = {
			$type: 'com.atproto.repo.strongRef',
			uri: response.data.uri,
			cid: response.data.cid,
		};
	}

	const presentations = await fetchGuildPresentations(guildEvent.slug);

	if (presentations.length > 0) {
		const ts = spinner();
		ts.start(
			`Syncing ${presentations.length} talks for ${guildEvent.name}`,
		);
		const { created, updated } = await syncTalks(
			session.client,
			session.actor,
			eventRef,
			presentations,
			atmoTalks,
		);
		ts.stop(
			`Talks for ${guildEvent.name}: ${created} created, ${updated} updated`,
		);
	}
}

outro('Sync complete!');
process.exit(0);
