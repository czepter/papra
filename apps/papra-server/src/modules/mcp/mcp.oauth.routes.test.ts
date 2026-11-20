import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createServer } from '../app/server';
import { createTestServerDependencies } from '../app/server.test-utils';
import { overrideConfig } from '../config/config.test-utils';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';

async function setup({ config = {} }: { config?: Parameters<typeof overrideConfig>[0] } = {}) {
  const { db } = await createInMemoryDatabase();
  const { app } = createServer(
    createTestServerDependencies({ db, config: overrideConfig(config) }),
  );

  return { app };
}

const BASE = 'http://localhost:1221';
const spoofedHeaders = { 'host': 'evil.example', 'x-forwarded-host': 'evil.example' };

describe('mcp oauth metadata routes', () => {
  test('the protected resource metadata is served at the bare and the resource specific path, built from the configuration', async () => {
    const { app } = await setup();

    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const response = await app.request(path);

      expect(response.status, path).to.eql(200);
      expect(response.headers.get('content-type')).to.include('application/json');
      expect(await response.json()).to.eql({
        resource: `${BASE}/mcp`,
        authorization_servers: [`${BASE}/api/auth`],
        scopes_supported: API_KEY_PERMISSIONS_VALUES,
        bearer_methods_supported: ['header'],
        resource_name: 'Papra',
      });
    }
  });

  test('the authorization server metadata is the same document at every probed location, with absolute urls from the configuration', async () => {
    const { app } = await setup();
    const bodies = [];

    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/api/auth',
      '/api/auth/.well-known/oauth-authorization-server',
    ]) {
      const response = await app.request(path);

      expect(response.status, path).to.eql(200);
      bodies.push(await response.json());
    }

    expect(bodies[1]).to.eql(bodies[0]);
    expect(bodies[2]).to.eql(bodies[0]);
    expect(bodies[0]).toMatchObject({
      issuer: `${BASE}/api/auth`,
      authorization_endpoint: `${BASE}/api/auth/oauth2/authorize`,
      token_endpoint: `${BASE}/api/auth/oauth2/token`,
      registration_endpoint: `${BASE}/api/auth/oauth2/register`,
      revocation_endpoint: `${BASE}/api/auth/oauth2/revoke`,
      jwks_uri: `${BASE}/api/auth/jwks`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
    expect((bodies[0] as { scopes_supported: string[] }).scopes_supported).to.eql([
      ...API_KEY_PERMISSIONS_VALUES,
      'offline_access',
    ]);
  });

  test('a spoofed Host or X-Forwarded-Host changes nothing in the metadata nor in the challenge', async () => {
    const { app } = await setup();

    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
    ]) {
      const body = await (await app.request(path, { headers: spoofedHeaders })).text();

      expect(body, path).not.to.include('evil.example');
      expect(body, path).to.include(BASE);
    }

    const challenge = (
      await app.request('/mcp', { method: 'POST', headers: spoofedHeaders })
    ).headers.get('www-authenticate');
    expect(challenge).not.to.include('evil.example');
  });

  test('the urls follow the configured base url', async () => {
    const { app } = await setup({ config: { appBaseUrl: 'https://papra.example.com' } });

    const metadata = await (await app.request('/.well-known/oauth-protected-resource/mcp')).json();
    const challenge = (await app.request('/mcp', { method: 'POST' })).headers.get(
      'www-authenticate',
    );

    expect(metadata).toMatchObject({
      resource: 'https://papra.example.com/mcp',
      authorization_servers: ['https://papra.example.com/api/auth'],
    });
    expect(challenge).to.eql(
      'Bearer realm="papra", resource_metadata="https://papra.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test('the oauth endpoints answer cross-origin calls for any origin, without credentials', async () => {
    const { app } = await setup();

    for (const path of [
      '/api/auth/oauth2/register',
      '/api/auth/oauth2/token',
      '/.well-known/oauth-authorization-server',
    ]) {
      const response = await app.request(path, {
        method: 'OPTIONS',
        headers: {
          'origin': 'https://claude.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });

      expect(response.headers.get('access-control-allow-origin'), path).to.eql('*');
      expect(response.headers.get('access-control-allow-credentials'), path).to.eql(null);
    }
  });

  test('other endpoints keep the configured cors rules, the consent endpoint is not opened cross-origin', async () => {
    const { app } = await setup({ config: { server: { corsOrigins: ['https://app.example'] } } });

    for (const path of ['/api/auth/oauth2/consent', '/api/organizations', '/mcp']) {
      const response = await app.request(path, {
        method: 'OPTIONS',
        headers: { 'origin': 'https://claude.example', 'access-control-request-method': 'POST' },
      });

      expect(response.headers.get('access-control-allow-origin'), path).to.eql(null);
    }
  });

  test('with the mcp server disabled the metadata routes answer 404', async () => {
    const { app } = await setup({ config: { mcp: { enabled: false } } });

    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/api/auth',
    ]) {
      expect((await app.request(path)).status, path).to.eql(404);
    }
  });
});
