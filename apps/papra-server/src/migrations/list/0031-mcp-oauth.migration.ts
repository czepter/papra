import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

// Tables of better-auth's oauth-provider and jwt plugins (MCP OAuth). The tables are created even when the
// MCP server is disabled, so that enabling it later needs no migration.
export const mcpOauthMigration = {
  name: 'mcp-oauth',

  up: async ({ db }) => {
    await db.batch([
      db.run(sql`CREATE TABLE IF NOT EXISTS "auth_jwks" (
        "id" text PRIMARY KEY NOT NULL,
        "public_key" text NOT NULL,
        "private_key" text NOT NULL,
        "created_at" integer NOT NULL,
        "expires_at" integer
      )`),

      db.run(sql`CREATE TABLE IF NOT EXISTS "auth_oauth_clients" (
        "id" text PRIMARY KEY NOT NULL,
        "created_at" integer NOT NULL,
        "updated_at" integer NOT NULL,
        "client_id" text NOT NULL,
        "client_secret" text,
        "disabled" integer DEFAULT false,
        "skip_consent" integer,
        "enable_end_session" integer,
        "subject_type" text,
        "scopes" text,
        "user_id" text,
        "name" text,
        "uri" text,
        "icon" text,
        "contacts" text,
        "tos" text,
        "policy" text,
        "software_id" text,
        "software_version" text,
        "software_statement" text,
        "redirect_uris" text NOT NULL,
        "post_logout_redirect_uris" text,
        "token_endpoint_auth_method" text,
        "grant_types" text,
        "response_types" text,
        "public" integer,
        "type" text,
        "require_pkce" integer,
        "reference_id" text,
        "metadata" text,
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade
      )`),
      db.run(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_clients_client_id_unique" ON "auth_oauth_clients" ("client_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_clients_user_id_index" ON "auth_oauth_clients" ("user_id")`,
      ),

      db.run(sql`CREATE TABLE IF NOT EXISTS "auth_oauth_refresh_tokens" (
        "id" text PRIMARY KEY NOT NULL,
        "token" text NOT NULL,
        "client_id" text NOT NULL,
        "session_id" text,
        "user_id" text NOT NULL,
        "reference_id" text,
        "expires_at" integer,
        "created_at" integer,
        "revoked" integer,
        "auth_time" integer,
        "scopes" text NOT NULL,
        FOREIGN KEY ("client_id") REFERENCES "auth_oauth_clients"("client_id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE cascade ON DELETE set null,
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade
      )`),
      db.run(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_token_unique" ON "auth_oauth_refresh_tokens" ("token")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_client_id_index" ON "auth_oauth_refresh_tokens" ("client_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_session_id_index" ON "auth_oauth_refresh_tokens" ("session_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_user_id_index" ON "auth_oauth_refresh_tokens" ("user_id")`,
      ),

      db.run(sql`CREATE TABLE IF NOT EXISTS "auth_oauth_access_tokens" (
        "id" text PRIMARY KEY NOT NULL,
        "token" text,
        "client_id" text NOT NULL,
        "session_id" text,
        "user_id" text,
        "reference_id" text,
        "refresh_id" text,
        "expires_at" integer,
        "created_at" integer,
        "scopes" text NOT NULL,
        FOREIGN KEY ("client_id") REFERENCES "auth_oauth_clients"("client_id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE cascade ON DELETE set null,
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("refresh_id") REFERENCES "auth_oauth_refresh_tokens"("id") ON UPDATE cascade ON DELETE cascade
      )`),
      db.run(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_access_tokens_token_unique" ON "auth_oauth_access_tokens" ("token")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_client_id_index" ON "auth_oauth_access_tokens" ("client_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_session_id_index" ON "auth_oauth_access_tokens" ("session_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_user_id_index" ON "auth_oauth_access_tokens" ("user_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_refresh_id_index" ON "auth_oauth_access_tokens" ("refresh_id")`,
      ),

      db.run(sql`CREATE TABLE IF NOT EXISTS "auth_oauth_consents" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "user_id" text,
        "reference_id" text,
        "scopes" text NOT NULL,
        "created_at" integer,
        "updated_at" integer,
        FOREIGN KEY ("client_id") REFERENCES "auth_oauth_clients"("client_id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade
      )`),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_consents_client_id_index" ON "auth_oauth_consents" ("client_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "auth_oauth_consents_user_id_index" ON "auth_oauth_consents" ("user_id")`,
      ),
    ]);
  },

  // Reverse dependency order: children before the tables they reference
  down: async ({ db }) => {
    await db.batch([
      db.run(sql`DROP TABLE IF EXISTS "auth_oauth_consents"`),
      db.run(sql`DROP TABLE IF EXISTS "auth_oauth_access_tokens"`),
      db.run(sql`DROP TABLE IF EXISTS "auth_oauth_refresh_tokens"`),
      db.run(sql`DROP TABLE IF EXISTS "auth_oauth_clients"`),
      db.run(sql`DROP TABLE IF EXISTS "auth_jwks"`),
    ]);
  },
} satisfies Migration;
