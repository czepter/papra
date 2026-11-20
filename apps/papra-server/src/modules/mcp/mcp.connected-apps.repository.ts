import type { Database } from '../app/database/database.types';
import { injectArguments } from '@corentinth/chisels';
import { and, eq, max } from 'drizzle-orm';
import {
  oauthAccessTokensTable,
  oauthClientsTable,
  oauthConsentsTable,
  oauthRefreshTokensTable,
} from '../app/auth/auth.oauth.tables';
import { isNil } from '../shared/utils';
import { getRedirectHosts, parseJsonStringArray } from './mcp.connected-apps.models';

export type McpConnectedAppsRepository = ReturnType<typeof createMcpConnectedAppsRepository>;

export function createMcpConnectedAppsRepository({ db }: { db: Database }) {
  return injectArguments({ getUserConnectedApps, revokeUserConnectedApp }, { db });
}

async function getUserConnectedApps({ db, userId }: { db: Database; userId: string }) {
  const consents = await db
    .select({
      clientId: oauthConsentsTable.clientId,
      scopes: oauthConsentsTable.scopes,
      createdAt: oauthConsentsTable.createdAt,
      updatedAt: oauthConsentsTable.updatedAt,
      clientName: oauthClientsTable.name,
      redirectUris: oauthClientsTable.redirectUris,
    })
    .from(oauthConsentsTable)
    .leftJoin(oauthClientsTable, eq(oauthClientsTable.clientId, oauthConsentsTable.clientId))
    .where(eq(oauthConsentsTable.userId, userId));

  // Refresh tokens are written on every token renewal, so the newest one is the last time the app was active
  const lastActivity = await db
    .select({
      clientId: oauthRefreshTokensTable.clientId,
      lastActiveAt: max(oauthRefreshTokensTable.createdAt).mapWith(oauthRefreshTokensTable.createdAt),
    })
    .from(oauthRefreshTokensTable)
    .where(eq(oauthRefreshTokensTable.userId, userId))
    .groupBy(oauthRefreshTokensTable.clientId);

  const lastActiveByClientId = new Map(
    lastActivity.map(({ clientId, lastActiveAt }) => [clientId, lastActiveAt ?? undefined]),
  );

  // Normally one consent row per (client, user): merge defensively if there are several
  const connectedAppsByClientId = new Map<
    string,
    {
      clientId: string;
      clientName: string | null;
      redirectHosts: string[];
      scopes: string[];
      authorizedAt: Date;
      updatedAt: Date;
      lastActiveAt: Date | undefined;
    }
  >();

  for (const consent of consents) {
    const scopes = parseJsonStringArray({ value: consent.scopes });
    const authorizedAt = consent.createdAt ?? new Date(0);
    const updatedAt = consent.updatedAt ?? authorizedAt;
    const existing = connectedAppsByClientId.get(consent.clientId);

    if (existing) {
      existing.scopes = [...new Set([...existing.scopes, ...scopes])];
      existing.authorizedAt = authorizedAt < existing.authorizedAt ? authorizedAt : existing.authorizedAt;
      existing.updatedAt = updatedAt > existing.updatedAt ? updatedAt : existing.updatedAt;
      continue;
    }

    connectedAppsByClientId.set(consent.clientId, {
      clientId: consent.clientId,
      clientName: isNil(consent.clientName) || consent.clientName === '' ? null : consent.clientName,
      redirectHosts: getRedirectHosts({ redirectUris: consent.redirectUris }),
      scopes,
      authorizedAt,
      updatedAt,
      lastActiveAt: lastActiveByClientId.get(consent.clientId),
    });
  }

  const connectedApps = [...connectedAppsByClientId.values()].sort(
    (a, b) =>
      (b.lastActiveAt ?? b.authorizedAt).getTime() - (a.lastActiveAt ?? a.authorizedAt).getTime(),
  );

  return { connectedApps };
}

// Deletes everything the (client, user) pair holds, in one transaction. Each delete is keyed by the pair and not by
// ids read beforehand, so a concurrent refresh cannot leave a live row behind. The client row stays: a dynamically
// registered client is shared by every user who approved it.
async function revokeUserConnectedApp({
  db,
  userId,
  clientId,
}: {
  db: Database;
  userId: string;
  clientId: string;
}) {
  // db.batch runs the statements in one transaction on a single connection (and, unlike db.transaction,
  // works with the in-memory test database)
  const [, , deletedConsents] = await db.batch([
    db
      .delete(oauthAccessTokensTable)
      .where(
        and(eq(oauthAccessTokensTable.clientId, clientId), eq(oauthAccessTokensTable.userId, userId)),
      ),
    db
      .delete(oauthRefreshTokensTable)
      .where(
        and(eq(oauthRefreshTokensTable.clientId, clientId), eq(oauthRefreshTokensTable.userId, userId)),
      ),
    db
      .delete(oauthConsentsTable)
      .where(and(eq(oauthConsentsTable.clientId, clientId), eq(oauthConsentsTable.userId, userId)))
      .returning({ id: oauthConsentsTable.id }),
  ]);

  return { hasRevoked: deletedConsents.length > 0 };
}
