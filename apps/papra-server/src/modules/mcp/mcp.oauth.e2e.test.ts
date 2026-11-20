import { sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createServer } from '../app/server';
import { createTestServerDependencies } from '../app/server.test-utils';
import { overrideConfig } from '../config/config.test-utils';
import { createPkcePair, OAUTH_TEST_REDIRECT_URI, setupOauthTest } from './mcp.oauth.test-utils';
import { getApiKeyHash } from '../api-keys/api-keys.models';
import { apiKeysTable } from '../api-keys/api-keys.tables';

type Setup = Awaited<ReturnType<typeof setupOauthTest>>;

async function setupWithUserAndOrganization(options: Parameters<typeof setupOauthTest>[0] = {}) {
  const t = await setupOauthTest(options);
  const { userId } = await t.signUp();
  await t.seedDatabase({
    organizations: [{ id: 'org_alice', name: 'Alice org' }],
    organizationMembers: [{ id: 'om_alice', organizationId: 'org_alice', userId, role: 'owner' }],
  });
  const { cookie } = await t.signIn();

  return { ...t, userId, cookie };
}

async function callMcp({
  t,
  token,
  body,
}: {
  t: Pick<Setup, 'app'>;
  token?: string;
  body: unknown;
}) {
  return t.app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function readRpcResult(response: Response) {
  const text = await response.text();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length);

  return JSON.parse(data ?? 'null') as {
    result?: any;
    error?: { code: number; message: string };
  };
}

async function readOrganizations(response: Response) {
  const { result } = await readRpcResult(response);

  return (JSON.parse(result.content[0].text) as { organizations: { id: string; name: string }[] })
    .organizations;
}

const toolsList = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const callTool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name, arguments: args },
});

function getRedirectParams({ url }: { url: string }) {
  return new URL(url).searchParams;
}

describe('mcp oauth e2e', () => {
  describe('the authorization code flow with PKCE', () => {
    test('a client registers, the user signs in and approves, and the access token opens /mcp', async () => {
      const t = await setupWithUserAndOrganization();

      const { response: registerResponse } = await t.registerClient();
      expect(registerResponse.status).toBeLessThan(300);
      const client = (await registerResponse.json()) as Record<string, unknown>;
      expect(client.client_id).toEqual(expect.any(String));
      expect(client.client_secret).toBeUndefined();
      expect(client.token_endpoint_auth_method).to.eql('none');

      const { verifier, challenge } = createPkcePair();
      const clientId = client.client_id as string;

      // Signed out: sent to the consent page, which sends the user on to the sign-in
      const signedOut = await t.authorize({ clientId, challenge });
      expect(signedOut.response.status).to.eql(302);
      expect(signedOut.location).to.match(new RegExp(`^${t.urls.consentPageUrl}\\?`));

      // Signed in: the same, with a signed query the consent decision is checked against
      const signedIn = await t.authorize({ clientId, challenge, cookie: t.cookie });
      expect(signedIn.response.status).to.eql(302);
      expect(new URL(signedIn.location as string).searchParams.get('sig')).toEqual(
        expect.any(String),
      );

      const { response: decision } = await t.decide({
        cookie: t.cookie,
        consentLocation: signedIn.location as string,
        accept: true,
      });
      expect(decision.status).to.eql(200);
      const { url } = (await decision.json()) as { url: string };
      expect(url.startsWith(OAUTH_TEST_REDIRECT_URI)).to.eql(true);
      const params = getRedirectParams({ url });
      expect(params.get('state')).to.eql('state-123');
      const code = params.get('code') as string;

      const tokenResponse = await t.exchangeCode({ clientId, code, verifier });
      expect(tokenResponse.status).to.eql(200);
      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };
      expect(tokens.token_type).to.eql('Bearer');
      expect(tokens.expires_in).toBeLessThanOrEqual(3600);
      expect(tokens.refresh_token).toEqual(expect.any(String));
      expect(tokens.scope.split(' ').sort()).to.eql([
        'documents:read',
        'offline_access',
        'organizations:read',
      ]);

      const listResponse = await callMcp({ t, token: tokens.access_token, body: toolsList });
      expect(listResponse.status).to.eql(200);
      const list = await readRpcResult(listResponse);
      expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain(
        'list_organizations',
      );

      const organizationsResponse = await callMcp({
        t,
        token: tokens.access_token,
        body: callTool('list_organizations'),
      });
      expect(organizationsResponse.status).to.eql(200);
      const [organization, ...others] = await readOrganizations(organizationsResponse);
      expect(others).to.eql([]);
      expect(organization).toMatchObject({ id: 'org_alice', name: 'Alice org' });
    });

    test('a tool that needs a scope the user did not approve returns the permission error, not a failure', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({
        cookie: t.cookie,
        scope: 'organizations:read',
      });

      const response = await callMcp({
        t,
        token: tokens.access_token,
        body: callTool('create_tag', { organizationId: 'org_alice', name: 'x', color: '#ffffff' }),
      });

      expect(response.status).to.eql(200);
      const result = await readRpcResult(response);
      expect(result.result.isError).to.eql(true);
      expect(result.result.content[0].text).to.match(/permission/i);
    });

    test('the granted scopes are exactly the approved ones, offline_access grants no tool permission', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({
        cookie: t.cookie,
        scope: 'organizations:read offline_access',
      });

      expect(tokens.scope.split(' ').sort()).to.eql(['offline_access', 'organizations:read']);
    });

    test('denying redirects to the client with access_denied and its state', async () => {
      const t = await setupWithUserAndOrganization();
      const { response: registerResponse } = await t.registerClient();
      const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
      const { challenge } = createPkcePair();
      const { location } = await t.authorize({ clientId, challenge, cookie: t.cookie });

      const { response } = await t.decide({
        cookie: t.cookie,
        consentLocation: location as string,
        accept: false,
      });

      const { url } = (await response.json()) as { url: string };
      const params = getRedirectParams({ url });
      expect(url.startsWith(OAUTH_TEST_REDIRECT_URI)).to.eql(true);
      expect(params.get('error')).to.eql('access_denied');
      expect(params.get('state')).to.eql('state-123');
      expect(params.get('code')).to.eql(null);
    });

    test('the first grant of a client always asks for consent, even for a signed-in user', async () => {
      const t = await setupWithUserAndOrganization();
      const { response: registerResponse } = await t.registerClient();
      const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
      const { challenge } = createPkcePair();

      const { location } = await t.authorize({ clientId, challenge, cookie: t.cookie });

      expect(location).to.match(new RegExp(`^${t.urls.consentPageUrl}\\?`));
    });

    test('requesting more scopes than the stored consent covers asks for consent again, a subset does not', async () => {
      const t = await setupWithUserAndOrganization();
      const { clientId } = await t.runFullFlow({ cookie: t.cookie, scope: 'organizations:read' });
      const { challenge } = createPkcePair();

      const subset = await t.authorize({
        clientId,
        challenge,
        cookie: t.cookie,
        scope: 'organizations:read',
      });
      expect(subset.location?.startsWith(OAUTH_TEST_REDIRECT_URI)).to.eql(true);

      const wider = await t.authorize({
        clientId,
        challenge,
        cookie: t.cookie,
        scope: 'organizations:read documents:read',
      });
      expect(wider.location).to.match(new RegExp(`^${t.urls.consentPageUrl}\\?`));
    });
  });

  describe('authorization request validation', () => {
    test('a missing code challenge is rejected and plain is not supported', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const { challenge } = createPkcePair();

      const missing = await t.authorize({ clientId, cookie: t.cookie });
      expect(new URL(missing.location as string).searchParams.get('error')).to.eql(
        'invalid_request',
      );

      const plain = await t.authorize({
        clientId,
        challenge,
        challengeMethod: 'plain',
        cookie: t.cookie,
      });
      // Rejected by the request validation: nothing is redirected, no code can be issued
      expect(plain.response.status).to.eql(400);
      expect(plain.location).to.eql(null);
    });

    test('an unknown scope is rejected', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const { challenge } = createPkcePair();

      const { location } = await t.authorize({
        clientId,
        challenge,
        cookie: t.cookie,
        scope: 'organizations:read admin:everything',
      });

      expect(new URL(location as string).searchParams.get('error')).to.eql('invalid_scope');
    });

    test('a redirect uri that differs from the registered one is rejected without redirecting to it', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient({
        redirect_uris: ['https://client.example/callback'],
      });
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const { challenge } = createPkcePair();

      for (const redirectUri of [
        'https://client.example/callback/',
        'https://client.example/callback?extra=1',
        'https://client.example:8443/callback',
        'https://evil.example/callback',
      ]) {
        const { location } = await t.authorize({
          clientId,
          challenge,
          cookie: t.cookie,
          redirectUri,
        });

        expect(location, redirectUri).not.toContain('client.example/callback/');
        expect(location, redirectUri).not.toContain('evil.example');
        expect(location, redirectUri).not.toContain('extra=1');
        expect(location, redirectUri).not.toContain(':8443');
        expect(new URL(location as string).searchParams.get('error'), redirectUri).to.eql(
          'invalid_redirect',
        );
      }
    });

    test('an unknown client is rejected', async () => {
      const t = await setupWithUserAndOrganization();
      const { challenge } = createPkcePair();

      const { location } = await t.authorize({
        clientId: 'does-not-exist',
        challenge,
        cookie: t.cookie,
      });

      expect(new URL(location as string).searchParams.get('error')).to.eql('invalid_client');
    });
  });

  describe('the consent decision', () => {
    test('a tampered signature is rejected', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const { challenge } = createPkcePair();
      const { location } = await t.authorize({ clientId, challenge, cookie: t.cookie });
      const tampered = (location as string).replace(/scope=[^&]+/, 'scope=tags%3Adelete');

      const { response: decision } = await t.decide({
        cookie: t.cookie,
        consentLocation: tampered,
        accept: true,
      });

      expect(decision.status).to.eql(400);
    });

    test('without a session there is nothing to approve', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const { challenge } = createPkcePair();
      const { location } = await t.authorize({ clientId, challenge, cookie: t.cookie });

      const { response: decision } = await t.decide({
        cookie: '',
        consentLocation: location as string,
        accept: true,
      });

      expect(decision.status).to.eql(401);
    });
  });

  describe('the token endpoint', () => {
    test('an authorization code works once only', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const pkce = createPkcePair();
      const { location } = await t.authorize({
        clientId,
        challenge: pkce.challenge,
        cookie: t.cookie,
      });
      const { response: decision } = await t.decide({
        cookie: t.cookie,
        consentLocation: location as string,
        accept: true,
      });
      const code = getRedirectParams({ url: ((await decision.json()) as { url: string }).url }).get(
        'code',
      ) as string;

      const first = await t.exchangeCode({ clientId, code, verifier: pkce.verifier });
      const second = await t.exchangeCode({ clientId, code, verifier: pkce.verifier });

      expect(first.status).to.eql(200);
      expect(second.status).to.eql(401);
      expect(((await second.json()) as { error: string }).error).to.eql('invalid_grant');
    });

    test('a wrong code verifier is rejected', async () => {
      const t = await setupWithUserAndOrganization();
      const { response } = await t.registerClient();
      const { client_id: clientId } = (await response.json()) as { client_id: string };
      const pkce = createPkcePair();
      const { location } = await t.authorize({
        clientId,
        challenge: pkce.challenge,
        cookie: t.cookie,
      });
      const { response: decision } = await t.decide({
        cookie: t.cookie,
        consentLocation: location as string,
        accept: true,
      });
      const code = getRedirectParams({ url: ((await decision.json()) as { url: string }).url }).get(
        'code',
      ) as string;

      const tokenResponse = await t.exchangeCode({
        clientId,
        code,
        verifier: createPkcePair().verifier,
      });

      expect(tokenResponse.status).to.eql(401);
      expect(await tokenResponse.text()).not.toContain('access_token');
    });

    test('a resource other than the mcp endpoint is refused', async () => {
      const t = await setupWithUserAndOrganization();

      const { tokenResponse } = await t.runFullFlow({
        cookie: t.cookie,
        resource: `${t.urls.resource}/other`,
      });

      expect(tokenResponse.status).to.eql(400);
    });
  });

  describe('verification of the access token on /mcp', () => {
    test('a token issued without a resource has no audience and is refused', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({ cookie: t.cookie, resource: null });

      const response = await callMcp({ t, token: tokens.access_token, body: toolsList });

      expect(response.status).to.eql(401);
    });

    test('an expired token is refused', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({ cookie: t.cookie });
      expect((await callMcp({ t, token: tokens.access_token, body: toolsList })).status).to.eql(
        200,
      );

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + (tokens.expires_in + 60) * 1000 });
      try {
        const response = await callMcp({ t, token: tokens.access_token, body: toolsList });

        expect(response.status).to.eql(401);
        expect(response.headers.get('www-authenticate')).to.include('error="invalid_token"');
      } finally {
        vi.useRealTimers();
      }
    });

    test('a token of a user that was deleted afterwards is refused', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({ cookie: t.cookie });

      await t.db.run(sql`DELETE FROM users WHERE id = ${t.userId}`);

      const response = await callMcp({ t, token: tokens.access_token, body: toolsList });
      expect(response.status).to.eql(401);
    });

    test('a user removed from the organization loses access to it on the next call', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({ cookie: t.cookie });

      await t.db.run(sql`DELETE FROM organization_members WHERE user_id = ${t.userId}`);

      const response = await callMcp({
        t,
        token: tokens.access_token,
        body: callTool('list_organizations'),
      });
      expect(await readOrganizations(response)).to.eql([]);
    });

    test('an oauth access token is not accepted on the REST api', async () => {
      const t = await setupWithUserAndOrganization();
      const { tokens } = await t.runFullFlow({
        cookie: t.cookie,
        scope: 'organizations:read',
      });

      const anonymous = await t.app.request('/api/organizations');
      const withToken = await t.app.request('/api/organizations', {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });

      expect(anonymous.status).to.eql(401);
      expect(withToken.status).to.eql(401);
      expect(await withToken.json()).to.eql(await anonymous.json());
    });

    test('api keys keep working next to oauth tokens', async () => {
      const t = await setupWithUserAndOrganization();
      const token = `ppapi_${'q'.repeat(64)}`;
      await t.db.insert(apiKeysTable).values({
        name: 'key',
        userId: t.userId,
        prefix: token.slice(0, 11),
        keyHash: getApiKeyHash({ token }).keyHash,
        permissions: ['organizations:read'],
      });

      const response = await callMcp({ t, token, body: callTool('list_organizations') });

      expect(response.status).to.eql(200);
      expect(await readOrganizations(response)).toHaveLength(1);
    });
  });

  describe('refresh and revocation', () => {
    test('refreshing returns a working access token and rotates the refresh token', async () => {
      const t = await setupWithUserAndOrganization();
      const { clientId, tokens } = await t.runFullFlow({ cookie: t.cookie });

      const refreshed = await t.refresh({ clientId, refreshToken: tokens.refresh_token as string });

      expect(refreshed.status).to.eql(200);
      const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
      expect(next.refresh_token).not.to.eql(tokens.refresh_token);
      expect((await callMcp({ t, token: next.access_token, body: toolsList })).status).to.eql(200);

      const replay = await t.refresh({ clientId, refreshToken: tokens.refresh_token as string });
      expect(replay.status).to.eql(400);
    });

    test('a refresh cannot widen the scopes', async () => {
      const t = await setupWithUserAndOrganization();
      const { clientId, tokens } = await t.runFullFlow({
        cookie: t.cookie,
        scope: 'organizations:read offline_access',
      });

      const widened = await t.refresh({
        clientId,
        refreshToken: tokens.refresh_token as string,
        scope: 'organizations:read tags:delete',
      });

      expect(widened.status).to.eql(400);
    });

    test('a revoked refresh token can no longer be used to refresh', async () => {
      const t = await setupWithUserAndOrganization();
      const { clientId, tokens } = await t.runFullFlow({ cookie: t.cookie });

      const revoked = await t.app.request('/api/auth/oauth2/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          token: tokens.refresh_token as string,
          token_type_hint: 'refresh_token',
        }).toString(),
      });
      expect(revoked.status).to.eql(200);

      const refreshed = await t.refresh({ clientId, refreshToken: tokens.refresh_token as string });
      expect(refreshed.status).to.eql(400);
      expect(((await refreshed.json()) as { error: string }).error).to.eql('invalid_grant');
    });
  });

  describe('client registration', () => {
    test('redirect uris that are not https or loopback http are refused', async () => {
      const t = await setupWithUserAndOrganization();

      for (const uri of [
        'javascript:alert(1)',
        'http://evil.example/callback',
        'https://client.example/callback#fragment',
        'https://*.example/callback',
        'data:text/html,hi',
      ]) {
        const { response } = await t.registerClient({ redirect_uris: [uri] });

        expect(response.status, uri).to.eql(400);
      }
    });

    test('field sizes are capped', async () => {
      const t = await setupWithUserAndOrganization();

      const longName = await t.registerClient({ client_name: 'A'.repeat(101) });
      expect(longName.response.status).to.eql(400);

      const manyUris = await t.registerClient({
        redirect_uris: Array.from({ length: 11 }, (_, index) => `https://c.example/${index}`),
      });
      expect(manyUris.response.status).to.eql(400);

      const longUri = await t.registerClient({
        redirect_uris: [`https://c.example/${'a'.repeat(2100)}`],
      });
      expect(longUri.response.status).to.eql(400);
    });

    test('a client cannot register for the client credentials grant, ask for a secret or skip consent', async () => {
      const t = await setupWithUserAndOrganization();

      const credentials = await t.registerClient({ grant_types: ['client_credentials'] });
      expect(credentials.response.status).to.eql(400);

      const confidential = await t.registerClient({
        token_endpoint_auth_method: 'client_secret_basic',
      });
      expect(confidential.response.status).to.eql(400);

      const skipConsent = await t.registerClient({ skip_consent: true });
      expect(skipConsent.response.status).to.eql(400);
    });

    test('registration is rate limited per address', async () => {
      const t = await setupWithUserAndOrganization();
      const statuses: number[] = [];

      for (let index = 0; index < 12; index += 1) {
        const { response } = await t.registerClient();
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 10).every((status) => status < 300)).to.eql(true);
      expect(statuses.slice(10)).to.eql([429, 429]);
    });
  });

  describe('with the mcp server disabled', () => {
    test('the whole oauth surface is gone', async () => {
      const { db } = await createInMemoryDatabase();
      const { app } = createServer(
        createTestServerDependencies({ db, config: overrideConfig({ mcp: { enabled: false } }) }),
      );

      for (const [path, method] of [
        ['/api/auth/oauth2/register', 'POST'],
        ['/api/auth/oauth2/token', 'POST'],
        ['/api/auth/oauth2/authorize?client_id=x', 'GET'],
        ['/api/auth/jwks', 'GET'],
        ['/.well-known/oauth-authorization-server', 'GET'],
        ['/.well-known/oauth-protected-resource/mcp', 'GET'],
        ['/mcp', 'POST'],
      ] as const) {
        const response = await app.request(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
        });

        expect(response.status, path).to.eql(404);
      }
    });
  });
});
