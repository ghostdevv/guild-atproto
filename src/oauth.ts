import { NodeDnsHandleResolver } from '@atcute/identity-resolver-node';
import { log, spinner, type SpinnerResult } from '@clack/prompts';
import type { OAuthSession } from '@atcute/oauth-node-client';
import type { Did, Handle } from '@atcute/lexicons';
import { handles, sessions } from './storage.ts';
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
				scope.blob({ accept: ['image/*'] }),
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

async function authenticate(handle: Handle, s: SpinnerResult) {
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

	s.message(`Opening ${authUrl.toString()}`);

	await open(authUrl.toString());
	const session = await sessionPromise;

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
	const s = spinner();
	s.start('Logging into the atmosphere');

	const did = handles.get(handle);

	if (did) {
		s.message('Restoring session');
		const session = await restoreSession(handle, did);

		if (session) {
			s.stop('Session restored!');

			return {
				actor: session.did,
				client: createClient(session),
			};
		}
	}

	s.message('Creating new session');
	const session = await authenticate(handle, s);
	await handles.set(handle, session.did);
	s.stop('Logged in!');

	return {
		actor: session.did,
		client: createClient(session),
	};
}
