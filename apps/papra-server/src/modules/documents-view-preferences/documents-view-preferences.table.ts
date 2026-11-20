import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizationsTable } from '../organizations/organizations.table';
import { createTimestampColumns } from '../shared/db/columns.helpers';
import { usersTable } from '../users/users.table';
import type { DocumentsViewPreferences } from './documents-view-preferences.types';

// One row per user and organization
export const documentsViewPreferencesTable = sqliteTable(
  'documents_view_preferences',
  {
    ...createTimestampColumns(),

    userId: text('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    preferences: text('preferences', { mode: 'json' }).$type<DocumentsViewPreferences>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
);
