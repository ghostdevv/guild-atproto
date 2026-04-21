import { outro, isCancel } from '@clack/prompts';

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
