import type { Database } from '../app/database/database.types';
import type {
  DbInsertableDocumentPreview,
  DocumentPreview,
  DocumentPreviewVariant,
} from './document-previews.types';
import { injectArguments } from '@corentinth/chisels';
import { and, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import {
  DOCUMENT_PREVIEW_STATUSES,
  MAX_PREVIEW_GENERATION_ATTEMPTS,
} from './document-previews.constants';
import { documentPreviewsTable } from './document-previews.table';

export type DocumentPreviewsRepository = ReturnType<typeof createDocumentPreviewsRepository>;

export function createDocumentPreviewsRepository({ db }: { db: Database }) {
  return injectArguments(
    {
      getDocumentPreviews,
      getDocumentPreview,
      getDocumentsPreviews,
      claimDocumentPreviewsGeneration,
      refreshPendingDocumentPreviews,
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

// Atomically claims the generation of the previews of a document: missing variants are created as pending, failed ones that can still be retried
// and pending ones that have been waiting since before `staleBefore` are flagged as pending again (keeping their failed attempts count).
// Ready variants and fresh pending ones are left untouched. Returns the claimed variants, when empty someone else already owns the generation.
async function claimDocumentPreviewsGeneration({
  documentId,
  variants,
  now = new Date(),
  staleBefore,
  db,
}: {
  documentId: string;
  variants: readonly DocumentPreviewVariant[];
  now?: Date;
  staleBefore: Date;
  db: Database;
}) {
  const claimedPreviews = await db
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
      setWhere: or(
        and(
          eq(documentPreviewsTable.status, DOCUMENT_PREVIEW_STATUSES.FAILED),
          lt(documentPreviewsTable.failedAttemptsCount, MAX_PREVIEW_GENERATION_ATTEMPTS),
        ),
        and(
          eq(documentPreviewsTable.status, DOCUMENT_PREVIEW_STATUSES.PENDING),
          lt(documentPreviewsTable.updatedAt, staleBefore),
        ),
      ),
    })
    .returning({ variant: documentPreviewsTable.variant });

  return { claimedVariants: claimedPreviews.map(({ variant }) => variant) };
}

// Called when a generation job starts so that the pending previews it owns are not considered stale while it is running
async function refreshPendingDocumentPreviews({
  documentId,
  now = new Date(),
  db,
}: {
  documentId: string;
  now?: Date;
  db: Database;
}) {
  await db
    .update(documentPreviewsTable)
    .set({ updatedAt: now })
    .where(
      and(
        eq(documentPreviewsTable.documentId, documentId),
        eq(documentPreviewsTable.status, DOCUMENT_PREVIEW_STATUSES.PENDING),
      ),
    );
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

// Only flags the variants that are not ready yet as failed
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
      // Variants that are already ready (e.g. saved by a concurrent job) are not downgraded
      setWhere: ne(documentPreviewsTable.status, DOCUMENT_PREVIEW_STATUSES.READY),
    });
}
