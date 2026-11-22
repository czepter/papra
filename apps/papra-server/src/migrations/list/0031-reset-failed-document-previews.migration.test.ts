import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../modules/app/database/database.test-utils';
import { documentPreviewsTable } from '../../modules/document-previews/document-previews.table';
import { isPreviewPermanentlyFailed } from '../../modules/document-previews/document-previews.models';
import { resetFailedDocumentPreviewsMigration } from './0031-reset-failed-document-previews.migration';

describe('reset failed document previews migration', () => {
  test('permanently failed previews can be generated again, other previews are left untouched', async () => {
    const { db } = await createInMemoryDatabase({
      organizations: [{ id: 'org_1', name: 'Org 1' }],
      documents: [
        {
          id: 'doc_scan',
          organizationId: 'org_1',
          name: 'scan.pdf',
          originalName: 'scan.pdf',
          mimeType: 'application/pdf',
          originalStorageKey: 'org_1/originals/doc_scan.pdf',
          originalSha256Hash: 'hash_scan',
        },
        {
          id: 'doc_ready',
          organizationId: 'org_1',
          name: 'ready.pdf',
          originalName: 'ready.pdf',
          mimeType: 'application/pdf',
          originalStorageKey: 'org_1/originals/doc_ready.pdf',
          originalSha256Hash: 'hash_ready',
        },
      ],
      documentPreviews: [
        { documentId: 'doc_scan', variant: 'thumb', status: 'failed', failedAttemptsCount: 2 },
        { documentId: 'doc_ready', variant: 'thumb', status: 'ready', failedAttemptsCount: 1 },
      ],
    });

    await resetFailedDocumentPreviewsMigration.up({ db });

    const previews = await db.select().from(documentPreviewsTable);

    expect(
      previews
        .map(({ documentId, status, failedAttemptsCount }) => ({
          documentId,
          status,
          failedAttemptsCount,
        }))
        .sort((a, b) => a.documentId.localeCompare(b.documentId)),
    ).to.eql([
      { documentId: 'doc_ready', status: 'ready', failedAttemptsCount: 1 },
      { documentId: 'doc_scan', status: 'failed', failedAttemptsCount: 0 },
    ]);
    expect(previews.some(isPreviewPermanentlyFailed)).to.eql(false);
  });
});
