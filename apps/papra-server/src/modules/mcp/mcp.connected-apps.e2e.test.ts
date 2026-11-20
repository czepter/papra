import { afterEach, describe, expect, test, vi } from 'vitest';
import { getApiKeyHash } from '../api-keys/api-keys.models';
import { apiKeysTable } from '../api-keys/api-keys.tables';
import { createPkcePair, setupOauthTest } from './mcp.oauth.test-utils';

type Setup = Awaited<ReturnType<typeof setupOauthTest>>;
type Tokens = { access_token: string; refresh_token?: string };

async function setupWithTwoUsers() {
  const t = await setupOauthTest();
  const { userId: userId1 } = await t.signUp({ email: 'alice@example.com' });
  const { userId: userId2 } = await t.signUp({ email: 'bob@example.com' });
  const { cookie: cookie1 } = await t.signIn({ email: 'alice@example.com' });
  const { cookie: cookie2 } = await t.signIn({ email: 'bob@example.com' });

  return { ...t, userId1, userId2, cookie1, cookie2 };
}

// Approves an already registered client for the signed-in user and returns the tokens
async function approve({ t, cookie, clientId }: { t: Setup; cookie: string; clientId: string }) {
  const { verifier, challenge } = createPkcePair();
  const { location } = await t.authorize({ cookie, clientId, challenge });
  const { response: decision } = await t.decide({
    cookie,
    consentLocation: location as string,
    accept: true,
  });
  const { url } = (await decision.json()) as { url: string };
  const code = new URL(url).searchParams.get('code') as string;
  const tokenResponse = await t.exchangeCode({ clientId, code, verifier });

  return (await tokenResponse.json()) as Tokens;
}

async function callMcp({ t, token }: { t: Setup; token: string }) {
  return t.app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_organizations', arguments: {} },
    }),
  });
}

async function listConnectedApps({ t, cookie }: { t: Setup; cookie: string }) {
  const response = await t.app.request('/api/users/me/connected-apps', { headers: { cookie } });

  return {
    response,
    body: (await response.json()) as {
      connectedApps: {
        clientId: string;
        clientName: string | null;
        scopes: string[];
        redirectHosts: string[];
        lastActiveAt: string | null;
      }[];
    },
  };
}

async function revokeConnectedApp({
  t,
  cookie,
  clientId,
}: {
  t: Setup;
  cookie: string;
  clientId: string;
}) {
  return t.app.request(`/api/users/me/connected-apps/${clientId}`, {
    method: 'DELETE',
    headers: { cookie },
  });
}

describe('mcp connected apps e2e', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a user revokes an app: their tokens stop working at once, the other user of the same app is unaffected', async () => {
    const t = await setupWithTwoUsers();
    const { response: registerResponse } = await t.registerClient();
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };

    const tokens1 = await approve({ t, cookie: t.cookie1, clientId });
    const tokens2 = await approve({ t, cookie: t.cookie2, clientId });
    expect((await callMcp({ t, token: tokens1.access_token })).status).to.eql(200);
    expect((await callMcp({ t, token: tokens2.access_token })).status).to.eql(200);

    const revoked = await revokeConnectedApp({ t, cookie: t.cookie1, clientId });
    expect(revoked.status).to.eql(204);

    // The access token is refused, the refresh token cannot mint a new one
    expect((await callMcp({ t, token: tokens1.access_token })).status).to.eql(401);
    const refreshed = await t.refresh({ clientId, refreshToken: tokens1.refresh_token as string });
    expect(refreshed.status).toBeGreaterThanOrEqual(400);
    expect(refreshed.status).toBeLessThan(500);
    expect(((await refreshed.json()) as Record<string, unknown>).access_token).toBeUndefined();

    // A new authorization request shows the consent page again instead of auto-approving
    const { challenge } = createPkcePair();
    const { response: authorizeResponse, location } = await t.authorize({
      cookie: t.cookie1,
      clientId,
      challenge,
    });
    expect(authorizeResponse.status).to.eql(302);
    expect(location).to.match(new RegExp(`^${t.urls.consentPageUrl}\\?`));
    expect(new URL(location as string).searchParams.get('code')).to.eql(null);

    // The other user keeps working access and refresh
    expect((await callMcp({ t, token: tokens2.access_token })).status).to.eql(200);
    const refreshed2 = await t.refresh({ clientId, refreshToken: tokens2.refresh_token as string });
    expect(refreshed2.status).to.eql(200);

    const { body: list1 } = await listConnectedApps({ t, cookie: t.cookie1 });
    const { body: list2 } = await listConnectedApps({ t, cookie: t.cookie2 });
    expect(list1.connectedApps).to.eql([]);
    expect(list2.connectedApps.map(({ clientId }) => clientId)).to.eql([clientId]);
  });

  test('re-approving after a revoke does not revive the old refresh token', async () => {
    const t = await setupWithTwoUsers();
    const { response: registerResponse } = await t.registerClient();
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
    const oldTokens = await approve({ t, cookie: t.cookie1, clientId });

    await revokeConnectedApp({ t, cookie: t.cookie1, clientId });
    await approve({ t, cookie: t.cookie1, clientId });

    const refreshed = await t.refresh({
      clientId,
      refreshToken: oldTokens.refresh_token as string,
    });
    expect(refreshed.status).toBeGreaterThanOrEqual(400);
  });

  test('an access token issued before a revoke stays rejected after the user approves the app again, a new one works', async () => {
    const t = await setupWithTwoUsers();
    const { response: registerResponse } = await t.registerClient();
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
    const oldTokens = await approve({ t, cookie: t.cookie1, clientId });
    expect((await callMcp({ t, token: oldTokens.access_token })).status).to.eql(200);

    await revokeConnectedApp({ t, cookie: t.cookie1, clientId });

    // Token and consent timestamps have a one second resolution: approve again in a later second, well within the token lifetime
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5000 });
    const newTokens = await approve({ t, cookie: t.cookie1, clientId });

    expect((await callMcp({ t, token: oldTokens.access_token })).status).to.eql(401);
    expect((await callMcp({ t, token: newTokens.access_token })).status).to.eql(200);
  });

  test('the list shows display fields only, for the signed-in user only', async () => {
    const t = await setupWithTwoUsers();
    const { response: registerResponse } = await t.registerClient({ client_name: 'Shared Client' });
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
    const { response: otherRegisterResponse } = await t.registerClient({ client_name: 'Only Bob' });
    const { client_id: otherClientId } = (await otherRegisterResponse.json()) as {
      client_id: string;
    };

    const tokens1 = await approve({ t, cookie: t.cookie1, clientId });
    const tokens2 = await approve({ t, cookie: t.cookie2, clientId });
    await approve({ t, cookie: t.cookie2, clientId: otherClientId });

    const { response, body } = await listConnectedApps({ t, cookie: t.cookie1 });
    expect(response.status).to.eql(200);
    expect(body.connectedApps).toHaveLength(1);
    expect(body.connectedApps[0]).toMatchObject({
      clientId,
      clientName: 'Shared Client',
      redirectHosts: ['127.0.0.1:33418'],
      scopes: ['organizations:read', 'documents:read', 'offline_access'],
    });
    expect(body.connectedApps[0]?.lastActiveAt).toEqual(expect.any(String));

    const raw = JSON.stringify(body);
    expect(raw).not.toContain(otherClientId);
    expect(raw).not.toContain('Only Bob');
    for (const secret of [
      tokens1.access_token,
      tokens1.refresh_token,
      tokens2.access_token,
      tokens2.refresh_token,
    ]) {
      expect(raw).not.toContain(secret as string);
    }
    expect(raw).not.toMatch(/clientSecret|client_secret|refreshToken|accessToken/);
    expect(Object.keys(body.connectedApps[0] as object).sort()).to.eql([
      'authorizedAt',
      'clientId',
      'clientName',
      'lastActiveAt',
      'redirectHosts',
      'scopes',
      'updatedAt',
    ]);
  });

  test('revoking an app another user approved, an unknown app, or an app twice answers 404 and changes nothing', async () => {
    const t = await setupWithTwoUsers();
    const { response: registerResponse } = await t.registerClient();
    const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
    const tokens2 = await approve({ t, cookie: t.cookie2, clientId });

    const foreign = await revokeConnectedApp({ t, cookie: t.cookie1, clientId });
    expect(foreign.status).to.eql(404);
    expect(await foreign.json()).to.eql({
      error: { code: 'mcp.connected_app_not_found', message: 'Connected app not found' },
    });
    const unknown = await revokeConnectedApp({ t, cookie: t.cookie1, clientId: 'does-not-exist' });
    expect(unknown.status).to.eql(404);
    expect(await unknown.json()).to.eql({
      error: { code: 'mcp.connected_app_not_found', message: 'Connected app not found' },
    });

    expect((await callMcp({ t, token: tokens2.access_token })).status).to.eql(200);
    const { body } = await listConnectedApps({ t, cookie: t.cookie2 });
    expect(body.connectedApps).toHaveLength(1);

    expect((await revokeConnectedApp({ t, cookie: t.cookie2, clientId })).status).to.eql(204);
    expect((await revokeConnectedApp({ t, cookie: t.cookie2, clientId })).status).to.eql(404);
  });

  test('an empty list for a user without grants', async () => {
    const t = await setupWithTwoUsers();

    const { response, body } = await listConnectedApps({ t, cookie: t.cookie1 });

    expect(response.status).to.eql(200);
    expect(body).to.eql({ connectedApps: [] });
  });

  test('the jwt plugin token endpoint is disabled, the jwks endpoint keeps working', async () => {
    const t = await setupWithTwoUsers();

    const token = await t.app.request('/api/auth/token', { headers: { cookie: t.cookie1 } });
    const jwks = await t.app.request('/api/auth/jwks');

    expect(token.status).to.eql(404);
    expect(jwks.status).to.eql(200);
    expect(((await jwks.json()) as { keys: unknown[] }).keys.length).toBeGreaterThan(0);
  });

  describe('authentication', () => {
    test('without a session both routes answer 401', async () => {
      const t = await setupWithTwoUsers();

      expect((await t.app.request('/api/users/me/connected-apps')).status).to.eql(401);
      expect(
        (await t.app.request('/api/users/me/connected-apps/abc', { method: 'DELETE' })).status,
      ).to.eql(401);
    });

    test('an api key is refused, whatever its permissions', async () => {
      const t = await setupWithTwoUsers();
      const token = `ppapi_${'k'.repeat(64)}`;
      await t.db.insert(apiKeysTable).values({
        name: 'key',
        userId: t.userId1,
        prefix: token.slice(0, 11),
        keyHash: getApiKeyHash({ token }).keyHash,
        permissions: ['organizations:read', 'documents:read', 'tags:read'],
      });
      const headers = { authorization: `Bearer ${token}` };

      expect((await t.app.request('/api/users/me/connected-apps', { headers })).status).to.eql(401);
      expect(
        (await t.app.request('/api/users/me/connected-apps/abc', { method: 'DELETE', headers }))
          .status,
      ).to.eql(401);
    });

    test('an oauth access token is refused', async () => {
      const t = await setupWithTwoUsers();
      const { response: registerResponse } = await t.registerClient();
      const { client_id: clientId } = (await registerResponse.json()) as { client_id: string };
      const tokens = await approve({ t, cookie: t.cookie1, clientId });
      const headers = { authorization: `Bearer ${tokens.access_token}` };

      expect((await t.app.request('/api/users/me/connected-apps', { headers })).status).to.eql(401);
      expect(
        (
          await t.app.request(`/api/users/me/connected-apps/${clientId}`, {
            method: 'DELETE',
            headers,
          })
        ).status,
      ).to.eql(401);
      expect((await callMcp({ t, token: tokens.access_token })).status).to.eql(200);
    });

    test('when the mcp server is disabled the routes do not exist', async () => {
      const t = await setupOauthTest({ config: { mcp: { enabled: false } } });
      await t.signUp();
      const { cookie } = await t.signIn();

      const list = await t.app.request('/api/users/me/connected-apps', { headers: { cookie } });
      const revoke = await t.app.request('/api/users/me/connected-apps/abc', {
        method: 'DELETE',
        headers: { cookie },
      });

      expect(list.status).to.eql(404);
      expect(revoke.status).to.eql(404);
    });
  });
});
