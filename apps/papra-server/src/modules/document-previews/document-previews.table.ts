import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { documentsTable } from '../documents/documents.table';
import { createPrimaryKeyField, createTimestampColumns } from '../shared/db/columns.helpers';
import { DOCUMENT_PREVIEW_STATUS_LIST, PREVIEW_VARIANTS } from './document-previews.constants';

export const documentPreviewsTable = sqliteTable(
  'document_previews',
  {
    ...createPrimaryKeyField({ prefix: 'doc_prv' }),
    ...createTimestampColumns(),

    documentId: text('document_id')
      .notNull()
      .references(() => documentsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    variant: text('variant', { enum: PREVIEW_VARIANTS }).notNull(),
    status: text('status', { enum: DOCUMENT_PREVIEW_STATUS_LIST }).notNull(),
    // Number of failed generation attempts, used to not retry failing documents forever
    failedAttemptsCount: integer('failed_attempts_count').notNull().default(0),

    // The following columns are only set when the preview is ready
    storageKey: text('storage_key'),
    mimeType: text('mime_type'),
    size: integer('size'),
    width: integer('width'),
    height: integer('height'),

    fileEncryptionKeyWrapped: text('file_encryption_key_wrapped'),
    fileEncryptionKekVersion: text('file_encryption_kek_version'),
    fileEncryptionAlgorithm: text('file_encryption_algorithm'),
  },
  (table) => [
    uniqueIndex('document_previews_document_id_variant_unique').on(table.documentId, table.variant),
  ],
);
