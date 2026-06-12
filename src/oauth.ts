import { NodeDnsHandleResolver } from '@atcute/identity-resolver-node';
import type { OAuthSession } from '@atcute/oauth-node-client';
import type { Did, Handle } from '@atcute/lexicons';
import { log, spinner } from '@clack/prompts';
import { serve } from '@hono/node-server';
import { Client } from '@atcute/client';
import { sessions } from './storage';
import { Hono } from 'hono';
import {
	type StoredState,
	MemoryStore,
	OAuthClient,
	scope,
} from '@atcute/oauth-node-client';
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from '@atcute/identity-resolver';

function createClient(session: OAuthSession): Client {
	return new Client({ handler: session });
}

let oauthClient: OAuthClient | null = null;

export function createOAuthClient(port: number): OAuthClient {
	if (oauthClient) {
		return oauthClient;
	}

	oauthClient = new OAuthClient({
		metadata: {
			redirect_uris: [`http://127.0.0.1:${port}/callback`],
			scope: [
				scope.repo({
					collection: ['community.lexicon.calendar.event'],
					action: ['create', 'update', 'delete'],
				}),
			],
		},
		stores: {
			sessions,
			states: new MemoryStore<string, StoredState>({
				maxSize: 10,
				ttl: 10 * 60_000,
			}),
		},
		actorResolver: new LocalActorResolver({
			handleResolver: new CompositeHandleResolver({
				methods: {
					dns: new NodeDnsHandleResolver(),
					http: new WellKnownHandleResolver(),
				},
			}),
			didDocumentResolver: new CompositeDidDocumentResolver({
				methods: {
					plc: new PlcDidDocumentResolver(),
					web: new WebDidDocumentResolver(),
				},
			}),
		}),
	});

	return oauthClient;
}

async function openUrl(url: string): Promise<void> {
	const { exec } = await import('node:child_process');
	const plat = process.platform;
	if (plat === 'darwin') {
		exec(`open "${url}"`);
	} else if (plat === 'win32') {
		exec(`start "" "${url}"`);
	} else {
		exec(`xdg-open "${url}"`);
	}
}

export async function authenticate(
	handle: Handle,
): Promise<{ session: OAuthSession; client: Client }> {
	const port = 3456;
	const oauth = createOAuthClient(port);

	const app = new Hono();

	const {
		promise: sessionPromise,
		resolve: resolveSession,
		reject: rejectAuth,
	} = Promise.withResolvers<OAuthSession>();

	app.get('/callback', async (c) => {
		try {
			const callbackUrl = new URL(c.req.url);
			const { session } = await oauth.callback(callbackUrl.searchParams);

			resolveSession(session);

			return c.html(`
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>Authenticated!</title>
					<style>
						body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; }
						h1 { color: #22c55e; }
						p { color: #666; }
					</style>
				</head>
				<body>
					<h1>✓</h1>
					<p>Successfully authenticated! You can close this window.</p>
				</body>
				</html>
			`);
		} catch (error) {
			rejectAuth(
				error instanceof Error ? error : new Error(String(error)),
			);
			return c.html(`
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>Error</title>
					<style>
						body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; }
						h1 { color: #ef4444; }
					</style>
				</head>
				<body>
					<h1>Error</h1>
					<p>Authentication failed. Check console for details.</p>
				</body>
				</html>
			`);
		}
	});

	const server = serve({ fetch: app.fetch, port: 3456 });

	const { url: authUrl } = await oauth.authorize({
		target: { type: 'account', identifier: handle },
		state: {},
	});

	log.info(`Opening ${authUrl.toString()}`);
	const s = spinner();
	s.start('Awaiting oauth...');

	await openUrl(authUrl.toString());
	const session = await sessionPromise;

	s.stop('Authenticated!');

	// oxlint-disable-next-line promise/avoid-new
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});

	const client = createClient(session);

	return { session, client };
}

export async function restoreSession(did: Did): Promise<{
	session: OAuthSession;
	client: Client;
} | null> {
	const oauth = createOAuthClient(3456);

	try {
		const session = await oauth.restore(did);
		const client = createClient(session);
		return { session, client };
	} catch {
		return null;
	}
}
