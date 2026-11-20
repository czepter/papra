import { createHash, randomBytes } from 'node:crypto';
import { createInMemoryDatabase, seedDatabase } from '../app/database/database.test-utils';
import { createServer } from '../app/server';
import { createTestServerDependencies } from '../app/server.test-utils';
import { overrideConfig } from '../config/config.test-utils';
import { getMcpOauthUrls } from './mcp.oauth.models';

export const OAUTH_TEST_REDIRECT_URI = 'http://127.0.0.1:33418/callback';
export const OAUTH_TEST_PASSWORD = 'StrongPassword123!';

export function createPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  return { verifier, challenge };
}

export async function setupOauthTest({
  config = {},
}: { config?: Parameters<typeof overrideConfig>[0] } = {}) {
  const { db } = await createInMemoryDatabase();
  const fullConfig = overrideConfig({
    ...config,
    mcp: { enabled: true, ...(config as { mcp?: object }).mcp },
  });
  const { app } = createServer(createTestServerDependencies({ db, config: fullConfig }));
  const urls = getMcpOauthUrls({ config: fullConfig });
  const clientOrigin = new URL(urls.consentPageUrl).origin;

  async function signUp({ email = 'alice@example.com' }: { email?: string } = {}) {
    const response = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: OAUTH_TEST_PASSWORD, name: 'Alice' }),
    });
    const { user } = (await response.json()) as { user: { id: string } };

    return { userId: user.id };
  }

  async function signIn({ email = 'alice@example.com' }: { email?: string } = {}) {
    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: OAUTH_TEST_PASSWORD }),
    });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

    return { cookie };
  }

  async function registerClient(overrides: Record<string, unknown> = {}) {
    const response = await app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test MCP Client',
        redirect_uris: [OAUTH_TEST_REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        ...overrides,
      }),
    });

    return { response };
  }

  function authorizeUrl({
    clientId,
    challenge,
    scope = 'organizations:read documents:read offline_access',
    resource = urls.resource,
    redirectUri = OAUTH_TEST_REDIRECT_URI,
    state = 'state-123',
    challengeMethod = 'S256',
  }: {
    clientId: string;
    challenge?: string;
    scope?: string;
    resource?: string | null;
    redirectUri?: string;
    state?: string;
    challengeMethod?: string;
  }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
    });
    if (challenge !== undefined) {
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', challengeMethod);
    }
    if (resource !== null) {
      params.set('resource', resource);
    }

    return `/api/auth/oauth2/authorize?${params.toString()}`;
  }

  async function authorize({
    cookie,
    ...args
  }: Parameters<typeof authorizeUrl>[0] & { cookie?: string }) {
    const response = await app.request(authorizeUrl(args), {
      headers: cookie === undefined ? {} : { cookie },
    });

    return { response, location: response.headers.get('location') };
  }

  // The consent page posts the signed query up to and including sig, the plugin reads the request from it
  async function decide({
    cookie,
    consentLocation,
    accept,
    origin = clientOrigin,
  }: {
    cookie: string;
    consentLocation: string;
    accept: boolean;
    origin?: string;
  }) {
    // Same rule as the oauth provider client: everything up to and including the signature
    const signedParams = new URLSearchParams();
    for (const [key, value] of new URL(consentLocation).searchParams.entries()) {
      signedParams.append(key, value);
      if (key === 'sig') {
        break;
      }
    }
    const signedQuery = signedParams.toString();
    const response = await app.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({ accept, oauth_query: signedQuery }),
    });

    return { response };
  }

  async function exchangeCode({
    clientId,
    code,
    verifier,
    resource = urls.resource,
    redirectUri = OAUTH_TEST_REDIRECT_URI,
  }: {
    clientId: string;
    code: string;
    verifier: string;
    resource?: string | null;
    redirectUri?: string;
  }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (resource !== null) {
      body.set('resource', resource);
    }

    return app.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  async function refresh({
    clientId,
    refreshToken,
    scope,
    resource = urls.resource,
  }: {
    clientId: string;
    refreshToken: string;
    scope?: string;
    resource?: string;
  }) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource,
    });
    if (scope !== undefined) {
      body.set('scope', scope);
    }

    return await app.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  // Runs register, authorize, consent and token exchange for a signed-in user, and returns the tokens
  async function runFullFlow({
    cookie,
    scope,
    resource,
    clientOverrides,
  }: {
    cookie: string;
    scope?: string;
    resource?: string | null;
    clientOverrides?: Record<string, unknown>;
  }) {
    const { response: registerResponse } = await registerClient(clientOverrides);
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
    const { verifier, challenge } = createPkcePair();
    const { location: consentLocation } = await authorize({
      cookie,
      clientId,
      challenge,
      scope,
      resource,
    });
    const { response: decision } = await decide({
      cookie,
      consentLocation: consentLocation as string,
      accept: true,
    });
    const { url } = (await decision.json()) as { url: string };
    const code = new URL(url).searchParams.get('code') as string;
    const tokenResponse = await exchangeCode({ clientId, code, verifier, resource });
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    return { clientId, verifier, tokens, tokenResponse };
  }

  return {
    app,
    db,
    config: fullConfig,
    urls,
    clientOrigin,
    seedDatabase: async (args: Omit<Parameters<typeof seedDatabase>[0], 'db'>) =>
      seedDatabase({ db, ...args }),
    signUp,
    signIn,
    registerClient,
    authorizeUrl,
    authorize,
    decide,
    exchangeCode,
    refresh,
    runFullFlow,
  };
}
