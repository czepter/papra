import type { Database } from '../app/database/database.types';
import type { InboxMode } from './document-inbox.types';
import { injectArguments } from '@corentinth/chisels';
import type { SQL } from 'drizzle-orm';
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from 'drizzle-orm';
import { DOCUMENT_CONTENT_EXCERPT_LENGTH } from '../documents/documents.constants';
import { documentsTable } from '../documents/documents.table';
import { organizationMembersTable } from '../organizations/organizations.table';
import { chunkArray } from '../shared/arrays/arrays.utils';
import { omit } from '../shared/objects';
import { INBOX_MODES } from './document-inbox.constants';
import { documentReviewsTable } from './document-inbox.table';

export type DocumentInboxRepository = ReturnType<typeof createDocumentInboxRepository>;

// Keeps the number of bound parameters of a single insert/delete statement low
const REVIEWS_CHUNK_SIZE = 100;

export function createDocumentInboxRepository({ db }: { db: Database }) {
  return injectArguments(
    {
      getInboxDocuments,
      getInboxCount,
      markDocumentsAsReviewed,
      moveDocumentsBackToInbox,
    },
    { db },
  );
}

// A document is in the inbox of a user when it is not deleted, not reviewed by the system and
// - shared mode: nobody reviewed it
// - per_user mode: the user did not review it, and it was imported after the user joined the organization
function buildInboxWhereClause({
  organizationId,
  userId,
  mode,
  db,
}: {
  organizationId: string;
  userId: string;
  mode: InboxMode;
  db: Database;
}) {
  const noReviewMatching = (condition?: SQL) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(documentReviewsTable)
        .where(and(eq(documentReviewsTable.documentId, documentsTable.id), condition)),
    );

  const baseConditions = [
    eq(documentsTable.organizationId, organizationId),
    eq(documentsTable.isDeleted, false),
    // System review (null user), applies to both modes
    noReviewMatching(isNull(documentReviewsTable.userId)),
  ];

  if (mode === INBOX_MODES.SHARED) {
    return and(...baseConditions, noReviewMatching());
  }

  return and(
    ...baseConditions,
    noReviewMatching(eq(documentReviewsTable.userId, userId)),
    // New members don't get the whole history in their inbox. Without membership the comparison is NULL, so nothing matches
    sql`${documentsTable.createdAt} >= (
      SELECT ${organizationMembersTable.createdAt}
      FROM ${organizationMembersTable}
      WHERE ${organizationMembersTable.organizationId} = ${organizationId}
        AND ${organizationMembersTable.userId} = ${userId}
    )`,
  );
}

async function getInboxDocuments({
  organizationId,
  userId,
  mode,
  pageIndex,
  pageSize,
  db,
}: {
  organizationId: string;
  userId: string;
  mode: InboxMode;
  pageIndex: number;
  pageSize: number;
  db: Database;
}) {
  const where = buildInboxWhereClause({ organizationId, userId, mode, db });

  const [documents, { documentsCount }] = await Promise.all([
    db
      .select({
        ...omit(getTableColumns(documentsTable), ['content']),
        // The full content is not loaded in lists, only its first characters
        contentExcerpt:
          sql<string>`substr(${documentsTable.content}, 1, ${DOCUMENT_CONTENT_EXCERPT_LENGTH})`.as(
            'content_excerpt',
          ),
      })
      .from(documentsTable)
      .where(where)
      .orderBy(desc(documentsTable.createdAt), desc(documentsTable.id))
      .limit(pageSize)
      .offset(pageIndex * pageSize),
    getInboxCount({ organizationId, userId, mode, db }),
  ]);

  return { documents, documentsCount };
}

async function getInboxCount({
  organizationId,
  userId,
  mode,
  db,
}: {
  organizationId: string;
  userId: string;
  mode: InboxMode;
  db: Database;
}) {
  const [row] = await db
    .select({ documentsCount: count() })
    .from(documentsTable)
    .where(buildInboxWhereClause({ organizationId, userId, mode, db }));

  return { documentsCount: row?.documentsCount ?? 0 };
}

// Idempotent, reviewing a document twice keeps a single row
async function markDocumentsAsReviewed({
  organizationId,
  documentIds,
  userId,
  db,
  now = new Date(),
}: {
  organizationId: string;
  documentIds: string[];
  userId: string;
  db: Database;
  now?: Date;
}) {
  for (const chunk of chunkArray([...new Set(documentIds)], REVIEWS_CHUNK_SIZE)) {
    await db
      .insert(documentReviewsTable)
      .values(
        chunk.map((documentId) => ({
          organizationId,
          documentId,
          userId,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [documentReviewsTable.documentId, documentReviewsTable.userId],
      });
  }
}

// Shared: removes every member review so the documents are back in everyone's inbox
// Per user: removes the review of the user only
// System reviews are never removed
async function moveDocumentsBackToInbox({
  organizationId,
  documentIds,
  userId,
  mode,
  db,
}: {
  organizationId: string;
  documentIds: string[];
  userId: string;
  mode: InboxMode;
  db: Database;
}) {
  for (const chunk of chunkArray([...new Set(documentIds)], REVIEWS_CHUNK_SIZE)) {
    await db
      .delete(documentReviewsTable)
      .where(
        and(
          eq(documentReviewsTable.organizationId, organizationId),
          inArray(documentReviewsTable.documentId, chunk),
          mode === INBOX_MODES.SHARED
            ? isNotNull(documentReviewsTable.userId)
            : eq(documentReviewsTable.userId, userId),
        ),
      );
  }
}
