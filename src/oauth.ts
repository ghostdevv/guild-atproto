import { NodeDnsHandleResolver } from '@atcute/identity-resolver-node';
import type { OAuthSession } from '@atcute/oauth-node-client';
import type { Did, Handle } from '@atcute/lexicons';
import { handles, sessions } from './storage';
import { log, spinner } from '@clack/prompts';
import { serve } from '@hono/node-server';
import { Client } from '@atcute/client';
import open from 'tiny-open';
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

const PORT = 3456;

function createClient(session: OAuthSession): Client {
	return new Client({ handler: session });
}

export function createOAuthClient(): OAuthClient {
	return new OAuthClient({
		metadata: {
			redirect_uris: [`http://127.0.0.1:${PORT}/callback`],
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
}

async function authenticate(handle: Handle) {
	const oauth = createOAuthClient();
	const app = new Hono();

	const {
		promise: sessionPromise,
		resolve: resolveSession,
		reject: rejectAuth,
	} = Promise.withResolvers<OAuthSession>();

	app.get('/callback', async (c) => {
		try {
			const searchParams = new URL(c.req.url).searchParams;
			const { session } = await oauth.callback(searchParams);

			resolveSession(session);

			return c.html(`
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>Authenticated!</title>
				</head>
				<body>
					<h1>✓</h1>
					<p>Successfully authenticated! You can close this window.</p>
				</body>
				</html>
			`);
		} catch (error) {
			rejectAuth(error);
			return c.html(`
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<title>Error</title>
				</head>
				<body>
					<h1>Error</h1>
					<p>Authentication failed. Check console for details.</p>
				</body>
				</html>
			`);
		}
	});

	const server = serve({ fetch: app.fetch, port: PORT });

	const { url: authUrl } = await oauth.authorize({
		target: { type: 'account', identifier: handle },
		state: {},
	});

	log.info(`Opening ${authUrl.toString()}`);
	const s = spinner();
	s.start('Awaiting oauth...');

	await open(authUrl.toString());
	const session = await sessionPromise;

	s.stop('Authenticated!');

	server.close();
	return session;
}

async function restoreSession(handle: Handle, did: Did) {
	const oauth = createOAuthClient();

	try {
		return await oauth.restore(did);
	} catch {
		log.error(`Failed to restore session for ${handle}, creating new`);
		return null;
	}
}

export async function login(handle: Handle) {
	const did = handles.get(handle);

	if (did) {
		const session = await restoreSession(handle, did);

		if (session) {
			return {
				actor: session.did,
				client: createClient(session),
			};
		}
	}

	const session = await authenticate(handle);
	await handles.set(handle, session.did);

	return {
		actor: session.did,
		client: createClient(session),
	};
}
