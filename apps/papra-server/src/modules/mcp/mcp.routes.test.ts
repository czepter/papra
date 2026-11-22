import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getApiKeyHash } from '../api-keys/api-keys.models';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createServer } from '../app/server';
import { createTestServerDependencies } from '../app/server.test-utils';
import { overrideConfig } from '../config/config.test-utils';

const tokenOf = (letter: string) => `ppapi_${letter.repeat(64)}`;

const RESOURCE_METADATA_URL = 'http://localhost:1221/.well-known/oauth-protected-resource/mcp';

const tokens = {
  aliceWithRead: tokenOf('a'),
  aliceWithoutRead: tokenOf('b'),
  bobWithRead: tokenOf('c'),
  unknown: tokenOf('z'),
};

async function setup({ config = {} }: { config?: Parameters<typeof overrideConfig>[0] } = {}) {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: 'usr_alice', email: 'alice@example.com' },
      { id: 'usr_bob', email: 'bob@example.com' },
    ],
    organizations: [
      { id: 'org_alice', name: 'Alice org' },
      { id: 'org_bob', name: 'Bob org' },
      { id: 'org_shared', name: 'Shared org' },
    ],
    organizationMembers: [
      { id: 'om_1', organizationId: 'org_alice', userId: 'usr_alice', role: 'owner' },
      { id: 'om_2', organizationId: 'org_bob', userId: 'usr_bob', role: 'owner' },
      { id: 'om_3', organizationId: 'org_shared', userId: 'usr_alice', role: 'owner' },
      { id: 'om_4', organizationId: 'org_shared', userId: 'usr_bob', role: 'member' },
    ],
    apiKeys: [
      {
        id: 'ak_1',
        name: 'alice read',
        userId: 'usr_alice',
        prefix: 'ppapi_aaaaa',
        keyHash: getApiKeyHash({ token: tokens.aliceWithRead }).keyHash,
        permissions: ['organizations:read'],
      },
      {
        id: 'ak_2',
        name: 'alice no read',
        userId: 'usr_alice',
        prefix: 'ppapi_bbbbb',
        keyHash: getApiKeyHash({ token: tokens.aliceWithoutRead }).keyHash,
        permissions: ['documents:read'],
      },
      {
        id: 'ak_3',
        name: 'bob read',
        userId: 'usr_bob',
        prefix: 'ppapi_ccccc',
        keyHash: getApiKeyHash({ token: tokens.bobWithRead }).keyHash,
        permissions: ['organizations:read'],
      },
    ],
  });

  const { app } = createServer(
    createTestServerDependencies({ db, config: overrideConfig(config) }),
  );

  return { app };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function callMcp({
  app,
  token,
  body,
  headers = {},
}: {
  app: App;
  token?: string;
  body: unknown;
  headers?: Record<string, string>;
}) {
  return app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// The stateless transport answers with a server-sent event stream carrying one JSON-RPC message
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

function parseOrganizations({ result }: { result: { content: { text: string }[] } }) {
  return (
    JSON.parse(result.content[0]?.text ?? 'null') as {
      organizations: { id: string; name: string }[];
    }
  ).organizations;
}

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

const callTool = (name: string) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name, arguments: {} },
});

describe('mcp routes', () => {
  describe('authentication', () => {
    test('a request without credentials gets a 401 with a bearer challenge pointing at the protected resource metadata', async () => {
      const { app } = await setup();

      const response = await callMcp({ app, body: initializeBody });

      expect(response.status).to.eql(401);
      expect(response.headers.get('www-authenticate')).to.eql(
        `Bearer realm="papra", resource_metadata="${RESOURCE_METADATA_URL}"`,
      );
      expect(await response.json()).to.eql({
        error: { message: 'Unauthorized', code: 'auth.unauthorized' },
      });
    });

    test('a malformed or unknown api key gets a 401', async () => {
      const { app } = await setup();

      for (const token of ['not-an-api-key', 'ppapi_short', tokens.unknown]) {
        const response = await callMcp({ app, token, body: initializeBody });

        expect(response.status, token).to.eql(401);
        expect(response.headers.get('www-authenticate')).to.eql(
          `Bearer realm="papra", error="invalid_token", resource_metadata="${RESOURCE_METADATA_URL}"`,
        );
      }
    });

    test('a non-bearer authorization scheme gets a 401', async () => {
      const { app } = await setup();

      const response = await callMcp({
        app,
        body: initializeBody,
        headers: { authorization: `Basic ${btoa('a:b')}` },
      });

      expect(response.status).to.eql(401);
    });

    test('a session cookie alone does not authenticate the mcp endpoint', async () => {
      const { app } = await setup();

      const response = await callMcp({
        app,
        body: initializeBody,
        headers: { cookie: 'better-auth.session_token=whatever.signature' },
      });

      expect(response.status).to.eql(401);
    });

    test('an api key passed in the query string is not accepted', async () => {
      const { app } = await setup();

      const response = await app.request(`/mcp?token=${tokens.aliceWithRead}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(initializeBody),
      });

      expect(response.status).to.eql(401);
    });

    test('a valid api key can initialize the session', async () => {
      const { app } = await setup();

      const response = await callMcp({ app, token: tokens.aliceWithRead, body: initializeBody });

      expect(response.status).to.eql(200);
      const { result } = await readRpcResult(response);
      expect(result.serverInfo.name).to.eql('papra');
    });

    test('the standalone event stream is not offered in stateless mode, it answers 405 instead of hanging', async () => {
      const { app } = await setup();

      const response = await app.request('/mcp', {
        method: 'GET',
        headers: { authorization: `Bearer ${tokens.aliceWithRead}`, accept: 'text/event-stream' },
      });

      expect(response.status).to.eql(405);
      expect(response.headers.get('allow')).to.eql('POST');
    });

    test('the unauthenticated GET gets a 401 before anything else', async () => {
      const { app } = await setup();

      const response = await app.request('/mcp', { method: 'GET' });

      expect(response.status).to.eql(401);
    });
  });

  describe('tools', () => {
    test('tools/list returns described tools with an object input schema and annotations', async () => {
      const { app } = await setup();

      const response = await callMcp({
        app,
        token: tokens.aliceWithRead,
        body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      });
      const { result } = await readRpcResult(response);
      const names = result.tools.map(({ name }: { name: string }) => name);

      // The full catalogue is pinned in mcp.tools.test.ts
      expect(names).to.include.members(['ping', 'list_organizations']);

      for (const tool of result.tools) {
        expect(tool.description).to.be.a('string').and.not.to.eql('');
        expect(tool.inputSchema.type).to.eql('object');
        expect(tool.annotations).to.be.an('object');
      }

      for (const name of ['ping', 'list_organizations']) {
        const tool = result.tools.find((candidate: { name: string }) => candidate.name === name);

        expect(tool.annotations.readOnlyHint).to.eql(true);
        // These two take no arguments, in particular no user id
        expect(tool.inputSchema.properties ?? {}).to.eql({});
      }
    });

    test('ping works with any valid api key and returns nothing user-specific', async () => {
      const { app } = await setup();

      const { result } = await readRpcResult(
        await callMcp({ app, token: tokens.aliceWithoutRead, body: callTool('ping') }),
      );

      expect(result.isError).to.not.eql(true);
      expect(result.content).to.eql([{ type: 'text', text: 'pong' }]);
    });

    test('list_organizations returns only the organizations of the api key owner', async () => {
      const { app } = await setup();

      const { result } = await readRpcResult(
        await callMcp({ app, token: tokens.aliceWithRead, body: callTool('list_organizations') }),
      );

      expect(result.isError).to.not.eql(true);
      const organizations = parseOrganizations({ result });
      expect(organizations).to.eql([
        { id: 'org_alice', name: 'Alice org' },
        { id: 'org_shared', name: 'Shared org' },
      ]);
    });

    test('list_organizations ignores a user id passed as argument', async () => {
      const { app } = await setup();

      const { result } = await readRpcResult(
        await callMcp({
          app,
          token: tokens.aliceWithRead,
          body: {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'list_organizations', arguments: { userId: 'usr_bob' } },
          },
        }),
      );

      const organizations = parseOrganizations({ result });
      expect(organizations.map(({ id }: { id: string }) => id)).to.eql(['org_alice', 'org_shared']);
    });

    test('list_organizations without the organizations:read permission returns a tool error and no data', async () => {
      const { app } = await setup();

      const { result } = await readRpcResult(
        await callMcp({
          app,
          token: tokens.aliceWithoutRead,
          body: callTool('list_organizations'),
        }),
      );

      expect(result.isError).to.eql(true);
      expect(result.content[0].text).to.include('organizations:read');
      expect(JSON.stringify(result)).not.to.include('org_');
    });

    test('concurrent calls from different users never see each other organizations', async () => {
      const { app } = await setup();

      const calls = Array.from({ length: 10 }, async (_, index) => {
        const owner = index % 2 === 0 ? 'alice' : 'bob';
        const token = owner === 'alice' ? tokens.aliceWithRead : tokens.bobWithRead;
        const response = await callMcp({ app, token, body: callTool('list_organizations') });
        const organizations = parseOrganizations({
          result: (await readRpcResult(response)).result,
        });

        return { owner, ids: organizations.map(({ id }) => id) };
      });

      for (const { owner, ids } of await Promise.all(calls)) {
        expect(ids).to.eql(
          owner === 'alice' ? ['org_alice', 'org_shared'] : ['org_bob', 'org_shared'],
        );
      }
    });
  });

  describe('logging', () => {
    test('api key tokens never end up in the logs', async () => {
      const { app } = await setup();
      const written: string[] = [];
      const originalEnv = process.env.NODE_ENV;
      // Logs are discarded in the test env, enable them to capture what would be written
      process.env.NODE_ENV = 'production';
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        written.push(args.map(String).join(' '));
      });

      try {
        await callMcp({ app, token: tokens.unknown, body: initializeBody });
        await callMcp({ app, token: tokens.aliceWithRead, body: initializeBody });
        await callMcp({ app, token: tokens.aliceWithRead, body: callTool('list_organizations') });
      } finally {
        stdoutSpy.mockRestore();
        consoleSpy.mockRestore();
        process.env.NODE_ENV = originalEnv;
      }

      // Sanity check: something was logged, so the assertions below are meaningful
      expect(written.length).to.be.greaterThan(0);

      const logs = written.join('\n');
      for (const token of Object.values(tokens)) {
        expect(logs).not.to.include(token);
        expect(logs).not.to.include(getApiKeyHash({ token }).keyHash);
      }
    });
  });

  describe('when the mcp server is disabled', () => {
    test('/mcp is not registered and answers with the regular 404', async () => {
      const { app } = await setup({ config: { mcp: { enabled: false } } });

      const response = await callMcp({ app, token: tokens.aliceWithRead, body: initializeBody });

      expect(response.status).to.eql(404);
      expect(await response.json()).to.eql({
        error: { message: 'API route not found', code: 'api.not-found' },
      });
    });
  });

  describe('with the client assets served by the server', () => {
    const originalCwd = process.cwd();
    let workingDirectory: string;

    beforeAll(async () => {
      workingDirectory = await mkdtemp(join(tmpdir(), 'papra-mcp-test-'));
      await mkdir(join(workingDirectory, 'public'));
      await writeFile(join(workingDirectory, 'public', 'index.html'), '<html>spa</html>');
      process.chdir(workingDirectory);
    });

    afterAll(async () => {
      process.chdir(originalCwd);
      await rm(workingDirectory, { recursive: true, force: true });
    });

    test('/mcp is not swallowed by the SPA fallback and answers 401 without html', async () => {
      const { app } = await setup({ config: { server: { servePublicDir: true } } });

      for (const method of ['GET', 'POST']) {
        const response = await app.request('/mcp', { method });

        expect(response.status).to.eql(401);
        expect(response.headers.get('www-authenticate')).to.include('Bearer');
        expect(response.headers.get('www-authenticate')).to.include('resource_metadata');
        expect(await response.text()).not.to.include('<html');
      }
    });

    test('the oauth consent page cannot be framed', async () => {
      const { app } = await setup({ config: { server: { servePublicDir: true } } });

      const response = await app.request('/oauth/consent?client_id=x');

      expect(response.status).to.eql(200);
      expect(response.headers.get('x-frame-options')).to.eql('DENY');
      expect(response.headers.get('content-security-policy')).to.eql("frame-ancestors 'none'");
    });

    test('the oauth consent page cannot be framed under path variants either', async () => {
      const { app } = await setup({ config: { server: { servePublicDir: true } } });

      for (const path of [
        '/oauth/consent/',
        '/oauth/consent/index.html',
        '/oauth/consent/x?client_id=x',
      ]) {
        const response = await app.request(path);

        expect(response.headers.get('x-frame-options'), path).to.eql('DENY');
        expect(response.headers.get('content-security-policy'), path).to.eql(
          "frame-ancestors 'none'",
        );
      }
    });

    test('/.well-known paths are not swallowed by the SPA fallback: metadata is json, unknown paths are a plain 404', async () => {
      const { app } = await setup({ config: { server: { servePublicDir: true } } });

      const metadata = await app.request('/.well-known/oauth-protected-resource/mcp');
      expect(metadata.status).to.eql(200);
      expect(metadata.headers.get('content-type')).to.include('application/json');

      const unknown = await app.request('/.well-known/unknown');
      expect(unknown.status).to.eql(404);
      expect(await unknown.text()).not.to.include('<html');
    });

    test('when the mcp server is disabled, /mcp answers 404 and not the SPA page', async () => {
      const { app } = await setup({
        config: { server: { servePublicDir: true }, mcp: { enabled: false } },
      });

      const response = await app.request('/mcp', { method: 'POST' });

      expect(response.status).to.eql(404);
      expect(await response.text()).not.to.include('<html');
    });

    test('client routes starting with mcp still get the SPA', async () => {
      const { app } = await setup({ config: { server: { servePublicDir: true } } });

      const response = await app.request('/mcp-settings');

      expect(response.status).to.eql(200);
      expect(await response.text()).to.include('<html>spa</html>');
    });
  });
});
