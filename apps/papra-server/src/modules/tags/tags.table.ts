import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { documentsTable } from '../documents/documents.table';
import { organizationsTable } from '../organizations/organizations.table';
import {
  createCreatedAtField,
  createPrimaryKeyField,
  createTimestampColumns,
} from '../shared/db/columns.helpers';
import { usersTable } from '../users/users.table';
import { tagIdPrefix } from './tags.constants';

export const tagsTable = sqliteTable('tags', {
  ...createPrimaryKeyField({ prefix: tagIdPrefix }),
  ...createTimestampColumns(),

  organizationId: text('organization_id')
    .notNull()
    .references(() => organizationsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name'),
  color: text('color').notNull(),
  description: text('description'),
});

export const documentsTagsTable = sqliteTable(
  'documents_tags',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documentsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tagsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  },
  (table) => [
    primaryKey({
      name: 'documents_tags_pkey',
      columns: [table.documentId, table.tagId],
    }),
  ],
);

export const userPinnedTagsTable = sqliteTable(
  'user_pinned_tags',
  {
    ...createCreatedAtField(),

    userId: text('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tagsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'user_pinned_tags_pkey',
      columns: [table.userId, table.tagId],
    }),
  ],
);
