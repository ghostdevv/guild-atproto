import { log, spinner } from '@clack/prompts';
import { guildTokens } from './storage.ts';
import { serve } from '@hono/node-server';
import open from 'tiny-open';
import { Hono } from 'hono';

const GUILD_API_BASE = 'https://guild.host';
const AUTHORIZE_URL = `${GUILD_API_BASE}/oauth/authorize`;
const TOKEN_URL = `${GUILD_API_BASE}/api/oauth/token`;
const USERINFO_URL = `${GUILD_API_BASE}/api/oauth/userinfo`;

const GUILD_CLIENT_ID = process.env.GUILD_OAUTH_CLIENT_ID;
const GUILD_CLIENT_SECRET = process.env.GUILD_OAUTH_CLIENT_SECRET;
const GUILD_REDIRECT_URI =
	process.env.GUILD_OAUTH_REDIRECT_URI ||
	'http://localhost:3456/guild-callback';

interface GuildTokensData {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scopes: string;
}

interface GuildTokenResponse {
	access_token: string;
	refresh_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
}

function isConfigured(): boolean {
	return !!GUILD_CLIENT_ID && !!GUILD_CLIENT_SECRET;
}

const BASE64URL_PLUS = '+';
const BASE64URL_SLASH = '/';
const BASE64URL_EQUALS_REGEX = /=+$/;

function generateRandomBytes(size: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	return btoa(String.fromCodePoint(...bytes))
		.replaceAll(BASE64URL_PLUS, '-')
		.replaceAll(BASE64URL_SLASH, '_')
		.replace(BASE64URL_EQUALS_REGEX, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const data = new TextEncoder().encode(verifier);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(hash);
	return btoa(String.fromCodePoint(...bytes))
		.replaceAll(BASE64URL_PLUS, '-')
		.replaceAll(BASE64URL_SLASH, '_')
		.replace(BASE64URL_EQUALS_REGEX, '');
}

export async function authenticateWithGuild(): Promise<GuildTokensData | null> {
	if (!isConfigured()) {
		log.warning(
			'Guild OAuth not configured - set GUILD_OAUTH_CLIENT_ID and GUILD_OAUTH_CLIENT_SECRET env vars',
		);
		return null;
	}

	const existingTokens = guildTokens.get();
	if (existingTokens && existingTokens.expiresAt > Date.now()) {
		return existingTokens;
	}

	if (existingTokens && existingTokens.expiresAt <= Date.now()) {
		const refreshed = await refreshGuildToken(existingTokens.refreshToken);
		if (refreshed) return refreshed;
	}

	const s = spinner();
	s.start('Authenticating with Guild...');

	try {
		const codeVerifier = generateRandomBytes(32);
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		const state = generateRandomBytes(16);

		const app = new Hono();

		const {
			promise: tokenPromise,
			resolve: resolveToken,
			reject: rejectToken,
		} = Promise.withResolvers<GuildTokensData>();

		app.get('/guild-callback', async (c) => {
			try {
				const searchParams = new URL(c.req.url).searchParams;
				const code = searchParams.get('code');
				const returnedState = searchParams.get('state');
				const error = searchParams.get('error');

				if (error || !code) {
					rejectToken(new Error(error || 'No code provided'));
					return c.html(`
						<!DOCTYPE html>
						<html>
						<head><title>Error</title></head>
						<body><h1>Error</h1><p>Authentication failed: ${error}</p></body>
						</html>
					`);
				}

				if (returnedState !== state) {
					rejectToken(new Error('State mismatch'));
					return c.html(`
						<!DOCTYPE html>
						<html>
						<head><title>Error</title></head>
						<body><h1>Error</h1><p>State mismatch - possible CSRF attack</p></body>
						</html>
					`);
				}

				const tokenResponse = await fetch(TOKEN_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: new URLSearchParams({
						grant_type: 'authorization_code',
						code,
						client_id: GUILD_CLIENT_ID!,
						client_secret: GUILD_CLIENT_SECRET!,
						redirect_uri: GUILD_REDIRECT_URI,
						code_verifier: codeVerifier,
					}),
				});

				if (!tokenResponse.ok) {
					const errText = await tokenResponse.text();
					rejectToken(new Error(`Token exchange failed: ${errText}`));
					return c.html(`
						<!DOCTYPE html>
						<html>
						<head><title>Error</title></head>
						<body><h1>Error</h1><p>Token exchange failed</p></body>
						</html>
					`);
				}

				const tokens =
					(await tokenResponse.json()) as GuildTokenResponse;
				const expiresAt = Date.now() + (tokens.expires_in - 60) * 1000;

				const newTokens: GuildTokensData = {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
					expiresAt,
					scopes: tokens.scope,
				};

				await guildTokens.set(newTokens);
				resolveToken(newTokens);

				return c.html(`
					<!DOCTYPE html>
					<html>
					<head><title>Authenticated!</title></head>
					<body><h1>✓</h1><p>Successfully authenticated with Guild!</p></body>
					</html>
				`);
			} catch (err) {
				rejectToken(err);
				return c.html(`
					<!DOCTYPE html>
					<html>
					<head><title>Error</title></head>
					<body><h1>Error</h1><p>Authentication failed</p></body>
					</html>
				`);
			}
		});

		const server = serve({ fetch: app.fetch, port: 3456 });

		const authParams = new URLSearchParams({
			response_type: 'code',
			client_id: GUILD_CLIENT_ID!,
			redirect_uri: GUILD_REDIRECT_URI,
			scope: 'event_attendees:read',
			state,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
		});

		const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;

		s.message(`Opening ${authUrl}`);
		await open(authUrl);

		const tokens = await tokenPromise;
		server.close();

		s.stop('Authenticated with Guild!');
		return tokens;
	} catch (error) {
		s.stop('Failed to authenticate with Guild');
		log.error(String(error));
		return null;
	}
}

async function refreshGuildToken(
	refreshToken: string,
): Promise<GuildTokensData | null> {
	if (!isConfigured()) return null;

	try {
		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: GUILD_CLIENT_ID!,
				client_secret: GUILD_CLIENT_SECRET!,
			}),
		});

		if (!response.ok) {
			return null;
		}

		const tokens = (await response.json()) as GuildTokenResponse;
		const expiresAt = Date.now() + (tokens.expires_in - 60) * 1000;

		const newTokens: GuildTokensData = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt,
			scopes: tokens.scope,
		};

		await guildTokens.set(newTokens);
		return newTokens;
	} catch {
		return null;
	}
}

export async function getGuildAccessToken(): Promise<string | null> {
	if (!isConfigured()) return null;

	const tokens = guildTokens.get();
	if (!tokens) return null;

	if (tokens.expiresAt <= Date.now()) {
		const refreshed = await refreshGuildToken(tokens.refreshToken);
		if (refreshed) return refreshed.accessToken;
		return null;
	}

	return tokens.accessToken;
}

export async function fetchGuildUserProfile() {
	const accessToken = await getGuildAccessToken();
	if (!accessToken) return null;

	const response = await fetch(USERINFO_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch user profile: ${response.statusText}`);
	}

	return response.json();
}
