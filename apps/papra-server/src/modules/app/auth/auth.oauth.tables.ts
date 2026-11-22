import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createPrimaryKeyField, createTimestampColumns } from '../../shared/db/columns.helpers';
import { usersTable } from '../../users/users.table';
import { sessionsTable } from './auth.tables';

// Tables of better-auth's oauth-provider and jwt plugins. Field names follow the plugins' schemas,
// list-valued fields (string[]) are stored as JSON text by the better-auth adapter.

export const oauthClientsTable = sqliteTable('auth_oauth_clients', {
  ...createPrimaryKeyField({ prefix: 'auth_oac' }),
  ...createTimestampColumns(),

  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  skipConsent: integer('skip_consent', { mode: 'boolean' }),
  enableEndSession: integer('enable_end_session', { mode: 'boolean' }),
  subjectType: text('subject_type'),
  scopes: text('scopes'),
  userId: text('user_id').references(() => usersTable.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: text('contacts'),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  redirectUris: text('redirect_uris').notNull(),
  postLogoutRedirectUris: text('post_logout_redirect_uris'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  grantTypes: text('grant_types'),
  responseTypes: text('response_types'),
  public: integer('public', { mode: 'boolean' }),
  type: text('type'),
  requirePkce: integer('require_pkce', { mode: 'boolean' }),
  referenceId: text('reference_id'),
  metadata: text('metadata'),
});

export const oauthRefreshTokensTable = sqliteTable('auth_oauth_refresh_tokens', {
  ...createPrimaryKeyField({ prefix: 'auth_oar' }),

  token: text('token').notNull().unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClientsTable.clientId, { onDelete: 'cascade', onUpdate: 'cascade' }),
  sessionId: text('session_id').references(() => sessionsTable.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  userId: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  referenceId: text('reference_id'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  revoked: integer('revoked', { mode: 'timestamp_ms' }),
  authTime: integer('auth_time', { mode: 'timestamp_ms' }),
  scopes: text('scopes').notNull(),
});

export const oauthAccessTokensTable = sqliteTable('auth_oauth_access_tokens', {
  ...createPrimaryKeyField({ prefix: 'auth_oat' }),

  token: text('token').unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClientsTable.clientId, { onDelete: 'cascade', onUpdate: 'cascade' }),
  sessionId: text('session_id').references(() => sessionsTable.id, {
    onDelete: 'set null',
    onUpdate: 'cascade',
  }),
  userId: text('user_id').references(() => usersTable.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  referenceId: text('reference_id'),
  refreshId: text('refresh_id').references(() => oauthRefreshTokensTable.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  scopes: text('scopes').notNull(),
});

export const oauthConsentsTable = sqliteTable('auth_oauth_consents', {
  ...createPrimaryKeyField({ prefix: 'auth_oaco' }),

  clientId: text('client_id')
    .notNull()
    .references(() => oauthClientsTable.clientId, { onDelete: 'cascade', onUpdate: 'cascade' }),
  userId: text('user_id').references(() => usersTable.id, {
    onDelete: 'cascade',
    onUpdate: 'cascade',
  }),
  referenceId: text('reference_id'),
  scopes: text('scopes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

export const jwksTable = sqliteTable('auth_jwks', {
  ...createPrimaryKeyField({ prefix: 'auth_jwk' }),

  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
});
