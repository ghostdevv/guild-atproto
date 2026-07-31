import { outro, isCancel, multiselect } from '@clack/prompts';
import { isOnGuild, type AtmoEvent } from './at-events.ts';
import type { GuildEvent } from './guild.ts';

export function handleCancel<T>(
	result: T,
): asserts result is Exclude<T, symbol> {
	if (isCancel(result)) {
		exit('Operation cancelled.');
	}
}

export function exit(message: string): never {
	outro(message);
	process.exit(0);
}

export async function selectEvents(
	atmoEvents: AtmoEvent[],
	guildEvents: GuildEvent[],
) {
	if (guildEvents.length === 0) {
		exit('No events found for this guild.');
	}

	const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

	const selected = await multiselect({
		message: 'Select events to sync:',
		options: guildEvents.map((event) => ({
			value: event,
			label: event.name,
			hint: formatter.format(event.startAt),
		})),
		initialValues: guildEvents.filter((event) => {
			return atmoEvents.some((e) => isOnGuild(e, event));
		}),
	});

	handleCancel(selected);

	if (selected.length === 0) {
		exit('No events selected.');
	}

	return selected;
}
