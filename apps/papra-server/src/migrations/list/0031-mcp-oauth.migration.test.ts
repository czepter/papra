import { createNoopLogger } from '@crowlog/logger';
import { sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { setupDatabase } from '../../modules/app/database/database';
import { seedDatabase } from '../../modules/app/database/database.test-utils';
import { migrations } from '../migrations.registry';
import { runMigrations } from '../migrations.usecases';
import { mcpOauthMigration } from './0031-mcp-oauth.migration';

const OAUTH_TABLES = [
  'auth_jwks',
  'auth_oauth_access_tokens',
  'auth_oauth_clients',
  'auth_oauth_consents',
  'auth_oauth_refresh_tokens',
];

async function listOauthTables({ db }: { db: ReturnType<typeof setupDatabase>['db'] }) {
  const { rows } = await db.run(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'auth_oauth_%' OR name = 'auth_jwks') ORDER BY name`,
  );

  return rows.map((row) => row.name);
}

async function setupDbBeforeMigration() {
  const { db } = setupDatabase({ url: ':memory:' });
  await runMigrations({
    db,
    migrations: migrations.slice(0, migrations.indexOf(mcpOauthMigration)),
    logger: createNoopLogger(),
  });

  return { db };
}

describe('mcp oauth migration', () => {
  test('creates the oauth provider and jwks tables, and running it twice is harmless', async () => {
    const { db } = await setupDbBeforeMigration();
    expect(await listOauthTables({ db })).toEqual([]);

    await mcpOauthMigration.up({ db });
    await mcpOauthMigration.up({ db });

    expect(await listOauthTables({ db })).toEqual(OAUTH_TABLES);
  });

  test('deleting a user cascades to the clients, consents and tokens it owns', async () => {
    const { db } = await setupDbBeforeMigration();
    await mcpOauthMigration.up({ db });
    await db.run(sql`PRAGMA foreign_keys = ON`);
    await seedDatabase({ db, users: [{ id: 'usr_1', email: 'one@example.com' }] });

    await db.run(
      sql`INSERT INTO auth_oauth_clients (id, created_at, updated_at, client_id, redirect_uris, user_id) VALUES ('c1', 1, 1, 'client-1', '[]', 'usr_1')`,
    );
    await db.run(
      sql`INSERT INTO auth_oauth_consents (id, client_id, user_id, scopes) VALUES ('co1', 'client-1', 'usr_1', '[]')`,
    );
    await db.run(
      sql`INSERT INTO auth_oauth_refresh_tokens (id, token, client_id, user_id, scopes) VALUES ('r1', 'rt', 'client-1', 'usr_1', '[]')`,
    );
    await db.run(
      sql`INSERT INTO auth_oauth_access_tokens (id, token, client_id, user_id, refresh_id, scopes) VALUES ('a1', 'at', 'client-1', 'usr_1', 'r1', '[]')`,
    );

    await db.run(sql`DELETE FROM users WHERE id = 'usr_1'`);

    for (const table of [
      'auth_oauth_clients',
      'auth_oauth_consents',
      'auth_oauth_refresh_tokens',
      'auth_oauth_access_tokens',
    ]) {
      const { rows } = await db.run(sql.raw(`SELECT COUNT(*) AS count FROM ${table}`));
      expect(rows[0]?.count, table).toBe(0);
    }
  });

  test('rollback drops every table it created and leaves the existing auth tables alone', async () => {
    const { db } = await setupDbBeforeMigration();
    await mcpOauthMigration.up({ db });

    await mcpOauthMigration.down({ db });

    expect(await listOauthTables({ db })).toEqual([]);
    const { rows } = await db.run(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_sessions', 'auth_accounts', 'users')`,
    );
    expect(rows).toHaveLength(3);
  });
});
