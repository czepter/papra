import type { Database } from '../app/database/database.types';
import type {
  DbInsertableDocumentPreview,
  DocumentPreview,
  DocumentPreviewVariant,
} from './document-previews.types';
import { injectArguments } from '@corentinth/chisels';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DOCUMENT_PREVIEW_STATUSES } from './document-previews.constants';
import { documentPreviewsTable } from './document-previews.table';

export type DocumentPreviewsRepository = ReturnType<typeof createDocumentPreviewsRepository>;

export function createDocumentPreviewsRepository({ db }: { db: Database }) {
  return injectArguments(
    {
      getDocumentPreviews,
      getDocumentPreview,
      getDocumentsPreviews,
      markDocumentPreviewsAsPending,
      saveReadyDocumentPreview,
      markDocumentPreviewsAsFailed,
    },
    { db },
  );
}

async function getDocumentPreviews({ documentId, db }: { documentId: string; db: Database }) {
  const previews = await db
    .select()
    .from(documentPreviewsTable)
    .where(eq(documentPreviewsTable.documentId, documentId));

  return { previews };
}

async function getDocumentPreview({
  documentId,
  variant,
  db,
}: {
  documentId: string;
  variant: DocumentPreviewVariant;
  db: Database;
}) {
  const [preview] = await db
    .select()
    .from(documentPreviewsTable)
    .where(
      and(
        eq(documentPreviewsTable.documentId, documentId),
        eq(documentPreviewsTable.variant, variant),
      ),
    );

  return { preview };
}

async function getDocumentsPreviews({
  documentIds,
  db,
}: {
  documentIds: string[];
  db: Database;
}): Promise<{ previewsByDocumentId: Record<string, DocumentPreview[]> }> {
  if (documentIds.length === 0) {
    return { previewsByDocumentId: {} };
  }

  const previews = await db
    .select()
    .from(documentPreviewsTable)
    .where(inArray(documentPreviewsTable.documentId, documentIds));

  const previewsByDocumentId: Record<string, DocumentPreview[]> = {};

  for (const preview of previews) {
    (previewsByDocumentId[preview.documentId] ??= []).push(preview);
  }

  return { previewsByDocumentId };
}

// Creates the pending previews of a document or flags failed ones as pending again (keeping their failed attempts count), ready previews are left untouched
async function markDocumentPreviewsAsPending({
  documentId,
  variants,
  now = new Date(),
  db,
}: {
  documentId: string;
  variants: readonly DocumentPreviewVariant[];
  now?: Date;
  db: Database;
}) {
  await db
    .insert(documentPreviewsTable)
    .values(
      variants.map((variant) => ({
        documentId,
        variant,
        status: DOCUMENT_PREVIEW_STATUSES.PENDING,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [documentPreviewsTable.documentId, documentPreviewsTable.variant],
      set: { status: DOCUMENT_PREVIEW_STATUSES.PENDING, updatedAt: now },
      setWhere: ne(documentPreviewsTable.status, DOCUMENT_PREVIEW_STATUSES.READY),
    });
}

async function saveReadyDocumentPreview({
  documentId,
  variant,
  storageKey,
  mimeType,
  size,
  width,
  height,
  fileEncryptionKeyWrapped,
  fileEncryptionKekVersion,
  fileEncryptionAlgorithm,
  db,
}: {
  documentId: string;
  variant: DocumentPreviewVariant;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  fileEncryptionKeyWrapped?: string | null;
  fileEncryptionKekVersion?: string | null;
  fileEncryptionAlgorithm?: string | null;
  db: Database;
}) {
  const values = {
    status: DOCUMENT_PREVIEW_STATUSES.READY,
    failedAttemptsCount: 0,
    storageKey,
    mimeType,
    size,
    width,
    height,
    fileEncryptionKeyWrapped: fileEncryptionKeyWrapped ?? null,
    fileEncryptionKekVersion: fileEncryptionKekVersion ?? null,
    fileEncryptionAlgorithm: fileEncryptionAlgorithm ?? null,
  } satisfies Partial<DbInsertableDocumentPreview>;

  const [preview] = await db
    .insert(documentPreviewsTable)
    .values({ documentId, variant, ...values })
    .onConflictDoUpdate({
      target: [documentPreviewsTable.documentId, documentPreviewsTable.variant],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return { preview };
}

async function markDocumentPreviewsAsFailed({
  documentId,
  variants,
  db,
}: {
  documentId: string;
  variants: readonly DocumentPreviewVariant[];
  db: Database;
}) {
  await db
    .insert(documentPreviewsTable)
    .values(
      variants.map((variant) => ({
        documentId,
        variant,
        status: DOCUMENT_PREVIEW_STATUSES.FAILED,
        failedAttemptsCount: 1,
      })),
    )
    .onConflictDoUpdate({
      target: [documentPreviewsTable.documentId, documentPreviewsTable.variant],
      set: {
        status: DOCUMENT_PREVIEW_STATUSES.FAILED,
        failedAttemptsCount: sql`${documentPreviewsTable.failedAttemptsCount} + 1`,
        updatedAt: new Date(),
      },
    });
}
