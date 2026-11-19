import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { documentsTable } from '../documents/documents.table';
import { createDocumentPreviewsRepository } from './document-previews.repository';
import { documentPreviewsTable } from './document-previews.table';

const documentFields = {
  organizationId: 'organization-1',
  mimeType: 'application/pdf',
  originalName: 'file.pdf',
  name: 'file.pdf',
  originalSha256Hash: 'hash',
};

async function createTestDatabase() {
  return createInMemoryDatabase({
    organizations: [{ id: 'organization-1', name: 'Organization 1' }],
    documents: [
      { id: 'doc-1', originalStorageKey: 'doc-1.pdf', ...documentFields },
      {
        id: 'doc-2',
        originalStorageKey: 'doc-2.pdf',
        ...documentFields,
        originalSha256Hash: 'hash-2',
      },
    ],
  });
}

const readyPreview = {
  documentId: 'doc-1',
  mimeType: 'image/webp',
  size: 1234,
  width: 400,
  height: 566,
} as const;

describe('document previews repository', () => {
  describe('saveReadyDocumentPreview', () => {
    test('a ready preview is saved with its encryption metadata and saving it again updates the existing record', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      const { preview } = await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'card',
        storageKey: 'organization-1/previews/doc-1/card.webp',
        fileEncryptionKeyWrapped: 'wrapped-key',
        fileEncryptionKekVersion: 'v1',
        fileEncryptionAlgorithm: 'aes-256-gcm',
      });

      expect(preview).to.include({
        documentId: 'doc-1',
        variant: 'card',
        status: 'ready',
        failedAttemptsCount: 0,
        storageKey: 'organization-1/previews/doc-1/card.webp',
        mimeType: 'image/webp',
        size: 1234,
        width: 400,
        height: 566,
        fileEncryptionKeyWrapped: 'wrapped-key',
        fileEncryptionKekVersion: 'v1',
        fileEncryptionAlgorithm: 'aes-256-gcm',
      });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'card',
        storageKey: 'organization-1/previews/doc-1/card.webp',
        size: 999,
      });

      const records = await db.select().from(documentPreviewsTable);

      expect(records).to.have.length(1);
      expect(records[0]).to.include({
        size: 999,
        fileEncryptionKeyWrapped: null,
        fileEncryptionKekVersion: null,
        fileEncryptionAlgorithm: null,
      });
    });
  });

  describe('getDocumentPreview and getDocumentPreviews', () => {
    test('previews are retrieved by document and by variant', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'thumb',
        storageKey: 'thumb-1',
      });
      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'card',
        storageKey: 'card-1',
      });
      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        documentId: 'doc-2',
        variant: 'thumb',
        storageKey: 'thumb-2',
      });

      const { previews } = await documentPreviewsRepository.getDocumentPreviews({
        documentId: 'doc-1',
      });
      expect(
        previews
          .map(({ storageKey }) => storageKey)
          .toSorted((a, b) => (a ?? '').localeCompare(b ?? '')),
      ).to.eql(['card-1', 'thumb-1']);

      const { preview } = await documentPreviewsRepository.getDocumentPreview({
        documentId: 'doc-1',
        variant: 'card',
      });
      expect(preview?.storageKey).to.eql('card-1');

      expect(
        (
          await documentPreviewsRepository.getDocumentPreview({
            documentId: 'doc-1',
            variant: 'preview',
          })
        ).preview,
      ).to.eql(undefined);
    });

    test('previews of several documents are grouped by document id', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'thumb',
        storageKey: 'thumb-1',
      });
      await documentPreviewsRepository.claimDocumentPreviewsGeneration({
        staleBefore: new Date(0),
        documentId: 'doc-2',
        variants: ['thumb'],
      });

      const { previewsByDocumentId } = await documentPreviewsRepository.getDocumentsPreviews({
        documentIds: ['doc-1', 'doc-2', 'doc-3'],
      });

      expect(Object.keys(previewsByDocumentId).toSorted((a, b) => a.localeCompare(b))).to.eql([
        'doc-1',
        'doc-2',
      ]);
      expect(previewsByDocumentId['doc-1']?.map(({ status }) => status)).to.eql(['ready']);
      expect(previewsByDocumentId['doc-2']?.map(({ status }) => status)).to.eql(['pending']);
      expect(await documentPreviewsRepository.getDocumentsPreviews({ documentIds: [] })).to.eql({
        previewsByDocumentId: {},
      });
    });
  });

  describe('claimDocumentPreviewsGeneration', () => {
    test('missing variants are claimed as pending, ready ones are left untouched and retryable failed ones are pending again with their attempts count kept', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'thumb',
        storageKey: 'thumb-1',
      });
      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants: ['card'],
      });

      const { claimedVariants } = await documentPreviewsRepository.claimDocumentPreviewsGeneration({
        documentId: 'doc-1',
        variants: ['thumb', 'card', 'preview'],
        staleBefore: new Date(0),
      });

      expect(claimedVariants.toSorted()).to.eql(['card', 'preview']);

      const { previews } = await documentPreviewsRepository.getDocumentPreviews({
        documentId: 'doc-1',
      });
      const byVariant = Object.fromEntries(previews.map((preview) => [preview.variant, preview]));

      expect(byVariant.thumb).to.include({ status: 'ready', storageKey: 'thumb-1' });
      expect(byVariant.card).to.include({ status: 'pending', failedAttemptsCount: 1 });
      expect(byVariant.preview).to.include({ status: 'pending', failedAttemptsCount: 0 });
    });

    test('a generation that is already claimed can not be claimed again until the pending previews are stale', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });
      const now = new Date('2025-01-01T00:00:00Z');
      const variants = ['thumb', 'card'] as const;
      const staleDelayMs = 5 * 60 * 1000;
      const claim = async (at: Date) =>
        documentPreviewsRepository.claimDocumentPreviewsGeneration({
          documentId: 'doc-1',
          variants,
          now: at,
          staleBefore: new Date(at.getTime() - staleDelayMs),
        });

      expect((await claim(now)).claimedVariants).to.have.length(2);
      expect((await claim(new Date(now.getTime() + 1000))).claimedVariants).to.eql([]);

      // A running job refreshes its pending previews, they are not stale anymore
      await documentPreviewsRepository.refreshPendingDocumentPreviews({
        documentId: 'doc-1',
        now: new Date(now.getTime() + staleDelayMs),
      });
      expect((await claim(new Date(now.getTime() + staleDelayMs + 1000))).claimedVariants).to.eql(
        [],
      );

      expect(
        (await claim(new Date(now.getTime() + 2 * staleDelayMs + 2000))).claimedVariants,
      ).to.have.length(2);
    });

    test('permanently failed previews can not be claimed', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });
      const variants = ['thumb'] as const;

      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants,
      });
      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants,
      });

      expect(
        await documentPreviewsRepository.claimDocumentPreviewsGeneration({
          documentId: 'doc-1',
          variants,
          staleBefore: new Date(0),
        }),
      ).to.eql({ claimedVariants: [] });
    });
  });

  describe('markDocumentPreviewsAsFailed', () => {
    test('each failure increments the failed attempts count of the variants', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });
      const variants = ['thumb', 'card', 'preview'] as const;

      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants,
      });
      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants,
      });

      const { previews } = await documentPreviewsRepository.getDocumentPreviews({
        documentId: 'doc-1',
      });

      expect(previews).to.have.length(3);
      expect(
        previews.map(({ status, failedAttemptsCount }) => [status, failedAttemptsCount]),
      ).to.eql([
        ['failed', 2],
        ['failed', 2],
        ['failed', 2],
      ]);
    });
  });

  describe('markDocumentPreviewsAsFailed with ready previews', () => {
    test('variants that are ready are not flagged as failed', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'thumb',
        storageKey: 'thumb-1',
      });

      await documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants: ['thumb', 'card'],
      });

      const { previews } = await documentPreviewsRepository.getDocumentPreviews({
        documentId: 'doc-1',
      });
      const byVariant = Object.fromEntries(previews.map((preview) => [preview.variant, preview]));

      expect(byVariant.thumb).to.include({
        status: 'ready',
        storageKey: 'thumb-1',
        failedAttemptsCount: 0,
      });
      expect(byVariant.card).to.include({ status: 'failed', failedAttemptsCount: 1 });
    });
  });

  describe('cascade deletion', () => {
    test('previews are deleted with their document', async () => {
      const { db } = await createTestDatabase();
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        variant: 'thumb',
        storageKey: 'thumb-1',
      });
      await documentPreviewsRepository.saveReadyDocumentPreview({
        ...readyPreview,
        documentId: 'doc-2',
        variant: 'thumb',
        storageKey: 'thumb-2',
      });

      await db.delete(documentsTable).where(eq(documentsTable.id, 'doc-1'));

      expect(
        (await db.select().from(documentPreviewsTable)).map(({ storageKey }) => storageKey),
      ).to.eql(['thumb-2']);
    });
  });
});
