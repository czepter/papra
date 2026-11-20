import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { documentsTable } from '../documents/documents.table';
import { organizationsTable } from '../organizations/organizations.table';
import { createPrimaryKeyField, createTimestampColumns } from '../shared/db/columns.helpers';
import { usersTable } from '../users/users.table';
import { DOCUMENT_REVIEW_ID_PREFIX } from './document-inbox.constants';

// A document is in the inbox until it has been reviewed.
// A null user_id is a "system" review, it hides the document from every inbox (used to backfill documents that existed before the inbox).
// SQLite treats NULLs as distinct in unique indexes, so system reviews are only inserted by the migration backfill.
export const documentReviewsTable = sqliteTable(
  'document_reviews',
  {
    ...createPrimaryKeyField({ prefix: DOCUMENT_REVIEW_ID_PREFIX }),
    ...createTimestampColumns(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documentsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text('user_id').references(() => usersTable.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
  },
  (table) => [
    uniqueIndex('document_reviews_document_id_user_id_unique').on(table.documentId, table.userId),
    index('document_reviews_organization_id_document_id_index').on(
      table.organizationId,
      table.documentId,
    ),
  ],
);
