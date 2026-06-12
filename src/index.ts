import { intro, outro, tasks, group, text } from '@clack/prompts';
import { type Handle, isHandle } from '@atcute/lexicons/syntax';
import { fetchGuildEvents, selectEvents } from './guild';
import { syncEvents } from './sync';
import { exit } from './prompts';
import { login } from './oauth';

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
const events = await fetchGuildEvents(choices.guildSlug);
const selectedEvents = await selectEvents(events);

await tasks([
	{
		title: 'Syncing events to ATProto',
		task: async () => {
			await syncEvents(
				session.actor,
				session.client,
				selectedEvents as typeof events,
			);
		},
	},
]);

outro('Sync complete!');
