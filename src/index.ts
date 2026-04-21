import { intro, outro, tasks, group, text } from '@clack/prompts';
import { fetchGuildEvents, selectEvents } from './guild';
import { authenticate, restoreSession } from './oauth';
import { loadSyncState } from './storage';
import { syncEvents } from './sync';
import { exit } from './prompts';

intro('Guild ATProto Sync');

const GUILD_SLUG_REGEX = /^[a-z0-9-]+$/;

const { guildSlug, handle } = await group(
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

					if (!value.includes('.')) {
						return 'Handle should be like myhandle.npmx.social';
					}
				},
			}),
	},
	{ onCancel: () => exit('Operation cancelled.') },
);

const storedState = await loadSyncState();
const savedDid = storedState.mappings['__auth_did']?.rkey;

let session = await restoreSession(savedDid);
session ??= await authenticate(handle);

const events = await fetchGuildEvents(guildSlug);

const selectedEvents = await selectEvents(events);

await tasks([
	{
		title: 'Syncing events to ATProto',
		task: async () => {
			await syncEvents(session.client, selectedEvents as typeof events);
		},
	},
]);

outro('Sync complete!');
