import type { JWTPayload } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { oauthClientsTable, oauthConsentsTable } from '../app/auth/auth.oauth.tables';
import { overrideConfig } from '../config/config.test-utils';
import { buildVerifyOauthAccessToken } from './mcp.oauth';
import { getMcpOauthUrls } from './mcp.oauth.models';

const config = overrideConfig();
const { issuer, resource } = getMcpOauthUrls({ config });

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let signingKey: KeyPair;
let otherKey: KeyPair;
let auth: unknown;

beforeAll(async () => {
  signingKey = await generateKeyPair('EdDSA', { extractable: true });
  otherKey = await generateKeyPair('EdDSA', { extractable: true });
  const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: 'key-1', alg: 'EdDSA' };

  auth = { api: { getJwks: async () => ({ keys: [publicJwk] }) } };
});

async function sign({
  payload = {},
  key = signingKey,
  alg = 'EdDSA',
  kid = 'key-1',
  expiresIn = '10m',
  omit = [],
}: {
  payload?: JWTPayload;
  key?: KeyPair;
  alg?: string;
  kid?: string;
  expiresIn?: string | number;
  omit?: string[];
} = {}) {
  const claims: JWTPayload = {
    sub: 'usr_alice',
    azp: 'client-1',
    scope: 'organizations:read documents:read offline_access tags:delete',
    iss: issuer,
    aud: resource,
    ...payload,
  };
  for (const claim of omit) {
    delete claims[claim];
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg, kid })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key.privateKey);
}

async function setup() {
  const { db } = await createInMemoryDatabase({
    users: [{ id: 'usr_alice', email: 'alice@example.com' }],
  });
  await db.insert(oauthClientsTable).values({ clientId: 'client-1', redirectUris: '[]' });
  await db.insert(oauthConsentsTable).values({
    clientId: 'client-1',
    userId: 'usr_alice',
    scopes: '[]',
  });

  return { db, verify: buildVerifyOauthAccessToken({ auth, db, config }) };
}

describe('mcp oauth access token verification', () => {
  test('a valid token gives the user, the client and only the scopes that are api key permissions', async () => {
    const { verify } = await setup();

    const { authInfo } = await verify({ token: await sign() });

    expect(authInfo).to.eql({
      token: '',
      clientId: 'client-1',
      scopes: ['organizations:read', 'documents:read', 'tags:delete'],
      extra: { userId: 'usr_alice', authType: 'oauth' },
    });
  });

  test('unknown scopes are dropped', async () => {
    const { verify } = await setup();

    const { authInfo } = await verify({
      token: await sign({ payload: { scope: 'organizations:read admin:all openid' } }),
    });

    expect(authInfo?.scopes).to.eql(['organizations:read']);
  });

  test.each([
    ['a token for another audience', { payload: { aud: 'http://localhost:1221/other' } }],
    ['a token for the issuer itself as audience', { payload: { aud: issuer } }],
    ['a token with several audiences', { payload: { aud: [resource, 'http://localhost:1221/other'] } }],
    ['a token without audience', { omit: ['aud'] }],
    ['a token from another issuer', { payload: { iss: 'https://evil.example/api/auth' } }],
    ['a token without issuer', { omit: ['iss'] }],
    ['an expired token', { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
    ['a token signed with another key', { key: 'other' }],
    ['a token with an unknown key id', { kid: 'unknown' }],
    ['a token without subject', { omit: ['sub'] }],
    ['a token without client (azp)', { omit: ['azp'] }],
    ['a token without scope', { omit: ['scope'] }],
    ['an id token, whose audience is the client', { payload: { aud: 'client-1' } }],
  ] as const)('%s is refused', async (_name, options) => {
    const { verify } = await setup();
    const { key, ...rest } = options as { key?: string } & Record<string, unknown>;

    const token = await sign({ ...rest, ...(key === 'other' ? { key: otherKey } : {}) });

    expect((await verify({ token })).authInfo).to.eql(undefined);
  });

  test('an unsigned token (alg none) is refused', async () => {
    const { verify } = await setup();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: 'none', kid: 'key-1' })}.${encode({
      sub: 'usr_alice',
      azp: 'client-1',
      scope: 'organizations:read',
      iss: issuer,
      aud: resource,
      exp: now + 600,
    })}.`;

    expect((await verify({ token })).authInfo).to.eql(undefined);
  });

  test('a token that picks an algorithm other than EdDSA is refused', async () => {
    const { verify } = await setup();
    const hmacToken = await new SignJWT({
      sub: 'usr_alice',
      azp: 'client-1',
      scope: 'organizations:read',
      iss: issuer,
      aud: resource,
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'key-1' })
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));

    expect((await verify({ token: hmacToken })).authInfo).to.eql(undefined);
  });

  test('opaque tokens and garbage are refused without a key lookup', async () => {
    const { verify } = await setup();

    for (const token of ['opaque-access-token', 'a.b', 'a.b.c', '', 'ppapi_short']) {
      expect((await verify({ token })).authInfo, token).to.eql(undefined);
    }
  });

  test('a token whose user, client or consent no longer exists is refused', async () => {
    const { verify, db } = await setup();
    const token = await sign();
    expect((await verify({ token })).authInfo).not.to.eql(undefined);

    await db.delete(oauthConsentsTable);
    expect((await verify({ token })).authInfo).to.eql(undefined);
  });

  test('a disabled client is refused', async () => {
    const { verify, db } = await setup();
    const token = await sign();

    await db.update(oauthClientsTable).set({ disabled: true });

    expect((await verify({ token })).authInfo).to.eql(undefined);
  });
});
