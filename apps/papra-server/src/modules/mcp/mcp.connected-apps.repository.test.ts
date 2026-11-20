import { describe, expect, test } from 'vitest';
import {
  oauthAccessTokensTable,
  oauthClientsTable,
  oauthConsentsTable,
  oauthRefreshTokensTable,
} from '../app/auth/auth.oauth.tables';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createMcpConnectedAppsRepository } from './mcp.connected-apps.repository';
import { revokeConnectedApp } from './mcp.connected-apps.usecases';

async function setupDatabase() {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: 'user_a', email: 'a@example.com' },
      { id: 'user_b', email: 'b@example.com' },
    ],
  });

  await db.insert(oauthClientsTable).values([
    {
      id: 'client_x',
      clientId: 'client_x',
      name: 'Client X',
      redirectUris: JSON.stringify(['http://127.0.0.1:33418/callback']),
    },
    {
      id: 'client_y',
      clientId: 'client_y',
      name: 'Client Y',
      redirectUris: JSON.stringify(['https://y.example.com/cb']),
    },
  ]);

  await db.insert(oauthConsentsTable).values([
    {
      id: 'consent_ax',
      clientId: 'client_x',
      userId: 'user_a',
      scopes: JSON.stringify(['documents:read', 'offline_access']),
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-02'),
    },
    {
      id: 'consent_ay',
      clientId: 'client_y',
      userId: 'user_a',
      scopes: JSON.stringify(['tags:read']),
      createdAt: new Date('2025-02-01'),
      updatedAt: new Date('2025-02-01'),
    },
    {
      id: 'consent_bx',
      clientId: 'client_x',
      userId: 'user_b',
      scopes: JSON.stringify(['documents:read']),
      createdAt: new Date('2025-01-05'),
      updatedAt: new Date('2025-01-05'),
    },
  ]);

  await db.insert(oauthRefreshTokensTable).values([
    {
      id: 'refresh_ax_old',
      token: 'rt-ax-old',
      clientId: 'client_x',
      userId: 'user_a',
      scopes: '[]',
      createdAt: new Date('2025-03-01'),
    },
    {
      id: 'refresh_ax_new',
      token: 'rt-ax-new',
      clientId: 'client_x',
      userId: 'user_a',
      scopes: '[]',
      createdAt: new Date('2025-04-01'),
    },
    {
      id: 'refresh_bx',
      token: 'rt-bx',
      clientId: 'client_x',
      userId: 'user_b',
      scopes: '[]',
      createdAt: new Date('2025-05-01'),
    },
    {
      id: 'refresh_ay',
      token: 'rt-ay',
      clientId: 'client_y',
      userId: 'user_a',
      scopes: '[]',
      createdAt: new Date('2025-02-15'),
    },
  ]);

  await db.insert(oauthAccessTokensTable).values([
    {
      id: 'access_ax',
      token: 'at-ax',
      clientId: 'client_x',
      userId: 'user_a',
      refreshId: 'refresh_ax_new',
      scopes: '[]',
    },
    {
      id: 'access_bx',
      token: 'at-bx',
      clientId: 'client_x',
      userId: 'user_b',
      refreshId: 'refresh_bx',
      scopes: '[]',
    },
    { id: 'access_ay', token: 'at-ay', clientId: 'client_y', userId: 'user_a', scopes: '[]' },
  ]);

  return { db };
}

async function readIds({ db }: { db: Awaited<ReturnType<typeof setupDatabase>>['db'] }) {
  const ids = async (
    table:
      | typeof oauthConsentsTable
      | typeof oauthRefreshTokensTable
      | typeof oauthAccessTokensTable
      | typeof oauthClientsTable,
  ) => (await db.select({ id: table.id }).from(table)).map(({ id }) => id).sort();

  return {
    consents: await ids(oauthConsentsTable),
    refreshTokens: await ids(oauthRefreshTokensTable),
    accessTokens: await ids(oauthAccessTokensTable),
    clients: await ids(oauthClientsTable),
  };
}

describe('mcp connected apps repository', () => {
  describe('getUserConnectedApps', () => {
    test('a user only gets the apps they approved, newest activity first, with the last active date from the newest refresh token', async () => {
      const { db } = await setupDatabase();
      const repository = createMcpConnectedAppsRepository({ db });

      const { connectedApps } = await repository.getUserConnectedApps({ userId: 'user_a' });

      expect(connectedApps).to.eql([
        {
          clientId: 'client_x',
          clientName: 'Client X',
          redirectHosts: ['127.0.0.1:33418'],
          scopes: ['documents:read', 'offline_access'],
          authorizedAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-02'),
          lastActiveAt: new Date('2025-04-01'),
        },
        {
          clientId: 'client_y',
          clientName: 'Client Y',
          redirectHosts: ['y.example.com'],
          scopes: ['tags:read'],
          authorizedAt: new Date('2025-02-01'),
          updatedAt: new Date('2025-02-01'),
          lastActiveAt: new Date('2025-02-15'),
        },
      ]);

      const { connectedApps: appsOfB } = await repository.getUserConnectedApps({
        userId: 'user_b',
      });
      expect(appsOfB.map(({ clientId }) => clientId)).to.eql(['client_x']);
      expect(appsOfB[0]?.scopes).to.eql(['documents:read']);
      expect(appsOfB[0]?.lastActiveAt).to.eql(new Date('2025-05-01'));
    });

    test('an app without refresh token has no last active date and sorts by its authorization date', async () => {
      const { db } = await setupDatabase();
      await db.delete(oauthRefreshTokensTable);
      const repository = createMcpConnectedAppsRepository({ db });

      const { connectedApps } = await repository.getUserConnectedApps({ userId: 'user_a' });

      expect(
        connectedApps.map(({ clientId, lastActiveAt }) => ({ clientId, lastActiveAt })),
      ).to.eql([
        { clientId: 'client_y', lastActiveAt: undefined },
        { clientId: 'client_x', lastActiveAt: undefined },
      ]);
    });

    test('a user without consent gets an empty list', async () => {
      const { db } = await setupDatabase();
      const { connectedApps } = await createMcpConnectedAppsRepository({ db }).getUserConnectedApps(
        { userId: 'nobody' },
      );

      expect(connectedApps).to.eql([]);
    });

    test('malformed stored values do not throw: scopes and redirect hosts fall back to empty', async () => {
      const { db } = await createInMemoryDatabase({
        users: [{ id: 'user_a', email: 'a@example.com' }],
      });
      await db
        .insert(oauthClientsTable)
        .values({ clientId: 'client_bad', name: '', redirectUris: '{broken' });
      await db
        .insert(oauthConsentsTable)
        .values({ clientId: 'client_bad', userId: 'user_a', scopes: 'nope' });

      const { connectedApps } = await createMcpConnectedAppsRepository({ db }).getUserConnectedApps(
        { userId: 'user_a' },
      );

      expect(connectedApps).to.have.length(1);
      expect(connectedApps[0]).toMatchObject({ clientName: null, redirectHosts: [], scopes: [] });
    });
  });

  describe('revokeUserConnectedApp', () => {
    test('it deletes the consent, refresh tokens and access tokens of the pair only, and keeps the client and other users untouched', async () => {
      const { db } = await setupDatabase();
      const repository = createMcpConnectedAppsRepository({ db });

      const { hasRevoked } = await repository.revokeUserConnectedApp({
        userId: 'user_a',
        clientId: 'client_x',
      });

      expect(hasRevoked).to.eql(true);
      expect(await readIds({ db })).to.eql({
        consents: ['consent_ay', 'consent_bx'],
        refreshTokens: ['refresh_ay', 'refresh_bx'],
        accessTokens: ['access_ay', 'access_bx'],
        clients: ['client_x', 'client_y'],
      });
    });

    test('revoking an app the user never approved changes nothing, even if another user approved it', async () => {
      const { db } = await setupDatabase();
      const before = await readIds({ db });
      const repository = createMcpConnectedAppsRepository({ db });

      expect(
        await repository.revokeUserConnectedApp({ userId: 'user_b', clientId: 'client_y' }),
      ).to.eql({ hasRevoked: false });
      expect(
        await repository.revokeUserConnectedApp({ userId: 'user_a', clientId: 'unknown' }),
      ).to.eql({ hasRevoked: false });
      expect(await readIds({ db })).to.eql(before);
    });
  });

  describe('revokeConnectedApp', () => {
    test('revoking twice answers not found the second time', async () => {
      const { db } = await setupDatabase();
      const mcpConnectedAppsRepository = createMcpConnectedAppsRepository({ db });

      await revokeConnectedApp({
        userId: 'user_a',
        clientId: 'client_x',
        mcpConnectedAppsRepository,
      });

      await expect(
        revokeConnectedApp({ userId: 'user_a', clientId: 'client_x', mcpConnectedAppsRepository }),
      ).rejects.toMatchObject({ code: 'mcp.connected_app_not_found', statusCode: 404 });
    });
  });
});
