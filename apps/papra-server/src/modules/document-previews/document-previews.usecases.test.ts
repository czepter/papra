import type { generatePreviewImages } from '@papra/lecture';
import { Buffer } from 'node:buffer';
import { createNoopLogger } from '@crowlog/logger';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createDocumentsRepository } from '../documents/documents.repository';
import { documentsTable } from '../documents/documents.table';
import {
  collectReadableStreamToBuffer,
  createReadableStream,
} from '../shared/streams/readable-stream';
import { inMemoryStorageDriverFactory } from '../storage/drivers/memory/memory.storage-driver';
import { createStorageServiceFromDriver } from '../storage/storage.services';
import { createInMemoryStorageService } from '../storage/storage.test-utils';
import { createInMemoryTaskServices } from '../tasks/tasks.test-utils';
import { PREVIEW_VARIANTS } from './document-previews.constants';
import { createDocumentPreviewsRepository } from './document-previews.repository';
import { documentPreviewsTable } from './document-previews.table';
import {
  deleteDocumentPreviewFiles,
  generateDocumentPreviews,
  getDocumentPreviewOrScheduleGeneration,
  getDocumentsPreviewApiStatuses,
  requestDocumentPreviewsGeneration,
} from './document-previews.usecases';

type GeneratePreviews = typeof generatePreviewImages;

const previewsContent = {
  thumb: Buffer.from('thumb-webp'),
  card: Buffer.from('card-webp'),
  preview: Buffer.from('preview-webp'),
};

function createFakeGeneratePreviews() {
  return vi.fn<GeneratePreviews>().mockImplementation(async () => ({
    previews: [
      {
        variant: 'thumb',
        buffer: previewsContent.thumb,
        mimeType: 'image/webp',
        width: 68,
        height: 96,
      },
      {
        variant: 'card',
        buffer: previewsContent.card,
        mimeType: 'image/webp',
        width: 400,
        height: 566,
      },
      {
        variant: 'preview',
        buffer: previewsContent.preview,
        mimeType: 'image/webp',
        width: 1200,
        height: 1697,
      },
    ],
  }));
}

async function createTestDeps({
  mimeType = 'application/pdf',
  documentsStorageService = createInMemoryStorageService(),
}: {
  mimeType?: string;
  documentsStorageService?: ReturnType<typeof createInMemoryStorageService>;
} = {}) {
  // Stored first, as its encryption metadata (when the storage encrypts files) is recorded on the document
  const originalEncryptionMetadata = await documentsStorageService.saveFile({
    storageKey: 'organization-1/originals/doc-1',
    fileStream: createReadableStream({ content: 'original content' }),
    fileName: 'file',
    mimeType,
  });

  const { db } = await createInMemoryDatabase({
    organizations: [{ id: 'organization-1', name: 'Organization 1' }],
    documents: [
      {
        id: 'doc-1',
        organizationId: 'organization-1',
        name: 'file',
        originalName: 'file',
        originalStorageKey: 'organization-1/originals/doc-1',
        originalSha256Hash: 'hash-1',
        mimeType,
        ...originalEncryptionMetadata,
      },
    ],
  });

  return {
    db,
    documentsStorageService,
    documentsRepository: createDocumentsRepository({ db }),
    documentPreviewsRepository: createDocumentPreviewsRepository({ db }),
    taskServices: createInMemoryTaskServices(),
    generatePreviews: createFakeGeneratePreviews(),
  };
}

describe('document previews usecases', () => {
  describe('generateDocumentPreviews', () => {
    test('the three variants are rendered from the original file, stored under the document previews keys and recorded as ready', async () => {
      const deps = await createTestDeps();

      const { status } = await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        ...deps,
      });

      expect(status).to.eql('generated');
      expect(deps.generatePreviews).toHaveBeenCalledTimes(1);

      const [{ arrayBuffer, mimeType }] = deps.generatePreviews.mock.calls[0]!;
      expect(Buffer.from(arrayBuffer).toString()).to.eql('original content');
      expect(mimeType).to.eql('application/pdf');

      expect([...deps.documentsStorageService._getStorage().keys()].toSorted()).to.eql([
        'organization-1/originals/doc-1',
        'organization-1/previews/doc-1/card.webp',
        'organization-1/previews/doc-1/preview.webp',
        'organization-1/previews/doc-1/thumb.webp',
      ]);

      const { previews } = await deps.documentPreviewsRepository.getDocumentPreviews({
        documentId: 'doc-1',
      });
      const byVariant = Object.fromEntries(previews.map((preview) => [preview.variant, preview]));

      expect(byVariant.thumb).to.include({
        status: 'ready',
        storageKey: 'organization-1/previews/doc-1/thumb.webp',
        mimeType: 'image/webp',
        size: previewsContent.thumb.byteLength,
        width: 68,
        height: 96,
        fileEncryptionKeyWrapped: null,
      });
      expect(byVariant.card).to.include({ status: 'ready', width: 400, height: 566 });
      expect(byVariant.preview).to.include({ status: 'ready', width: 1200, height: 1697 });
    });

    test('when files are encrypted at rest, the previews are encrypted like the original file and their encryption metadata is stored', async () => {
      const storageDriver = inMemoryStorageDriverFactory();
      const documentsStorageService = Object.assign(
        createStorageServiceFromDriver({
          storageDriver,
          encryptionOptions: {
            isEncryptionEnabled: true,
            keyEncryptionKeys: [{ version: 'v1', key: Buffer.alloc(32, 7) }],
          },
        }),
        { _getStorage: storageDriver._getStorage },
      );
      const deps = await createTestDeps({ documentsStorageService });

      await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        ...deps,
      });

      // The original file has been decrypted to be rendered
      expect(Buffer.from(deps.generatePreviews.mock.calls[0]![0].arrayBuffer).toString()).to.eql(
        'original content',
      );

      const { preview } = await deps.documentPreviewsRepository.getDocumentPreview({
        documentId: 'doc-1',
        variant: 'card',
      });

      expect(preview).to.include({
        fileEncryptionKekVersion: 'v1',
        fileEncryptionAlgorithm: 'aes-256-gcm',
      });
      expect(preview?.fileEncryptionKeyWrapped).to.be.a('string');

      // The stored bytes are not the plain webp
      const rawContent = storageDriver._getStorage().get(preview!.storageKey!)!.content;
      expect(rawContent).not.to.eql(previewsContent.card);

      // And are readable with the stored encryption metadata
      const { fileStream } = await documentsStorageService.getFileStream({
        storageKey: preview!.storageKey!,
        fileEncryptionAlgorithm: preview!.fileEncryptionAlgorithm,
        fileEncryptionKekVersion: preview!.fileEncryptionKekVersion,
        fileEncryptionKeyWrapped: preview!.fileEncryptionKeyWrapped,
      });
      expect(await collectReadableStreamToBuffer({ stream: fileStream })).to.eql(
        previewsContent.card,
      );
    });

    test('the generation is idempotent, previews that are already ready are not generated again', async () => {
      const deps = await createTestDeps();
      const args = { documentId: 'doc-1', organizationId: 'organization-1', ...deps };

      expect((await generateDocumentPreviews(args)).status).to.eql('generated');
      expect((await generateDocumentPreviews(args)).status).to.eql('already-generated');

      expect(deps.generatePreviews).toHaveBeenCalledTimes(1);
      expect(await deps.db.select().from(documentPreviewsTable)).to.have.length(3);
    });

    test('files left in the storage by an interrupted run are replaced', async () => {
      const deps = await createTestDeps();
      await deps.documentsStorageService.saveFile({
        storageKey: 'organization-1/previews/doc-1/thumb.webp',
        fileStream: createReadableStream({
          content: 'leftover',
        }),
        fileName: 'thumb.webp',
        mimeType: 'image/webp',
      });

      const { status } = await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        ...deps,
      });

      expect(status).to.eql('generated');
      expect(
        deps.documentsStorageService._getStorage().get('organization-1/previews/doc-1/thumb.webp')
          ?.content,
      ).to.eql(previewsContent.thumb);
    });

    test('documents types that have no preview are not rendered', async () => {
      const deps = await createTestDeps({ mimeType: 'text/plain' });

      const { status } = await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        ...deps,
      });

      expect(status).to.eql('unsupported');
      expect(deps.generatePreviews).not.toHaveBeenCalled();
      expect(await deps.db.select().from(documentPreviewsTable)).to.eql([]);
    });

    test('a document that does not exist anymore is skipped', async () => {
      const deps = await createTestDeps();

      const { status } = await generateDocumentPreviews({
        documentId: 'doc-unknown',
        organizationId: 'organization-1',
        ...deps,
      });

      expect(status).to.eql('skipped');
      expect(deps.generatePreviews).not.toHaveBeenCalled();
    });

    test('a failing generation is remembered, retried once, then abandoned', async () => {
      const deps = await createTestDeps();
      deps.generatePreviews.mockRejectedValue(new Error('Corrupted file'));
      const args = {
        documentId: 'doc-1',
        organizationId: 'organization-1',
        logger: createNoopLogger(),
        ...deps,
      };

      expect((await generateDocumentPreviews(args)).status).to.eql('failed');
      expect(
        (await deps.db.select().from(documentPreviewsTable)).map(
          ({ status, failedAttemptsCount }) => [status, failedAttemptsCount],
        ),
      ).to.eql([
        ['failed', 1],
        ['failed', 1],
        ['failed', 1],
      ]);

      expect((await generateDocumentPreviews(args)).status).to.eql('failed');
      expect(deps.generatePreviews).toHaveBeenCalledTimes(2);

      // Permanently failed, no more attempt
      expect((await generateDocumentPreviews(args)).status).to.eql('failed');
      expect(deps.generatePreviews).toHaveBeenCalledTimes(2);
    });

    test('a failure does not overwrite the variants that are already ready', async () => {
      const deps = await createTestDeps();
      await deps.documentPreviewsRepository.saveReadyDocumentPreview({
        documentId: 'doc-1',
        variant: 'thumb',
        storageKey: 'organization-1/previews/doc-1/thumb.webp',
        mimeType: 'image/webp',
        size: 10,
        width: 68,
        height: 96,
      });
      deps.generatePreviews.mockRejectedValue(new Error('Corrupted file'));

      expect(
        (
          await generateDocumentPreviews({
            documentId: 'doc-1',
            organizationId: 'organization-1',
            logger: createNoopLogger(),
            ...deps,
          })
        ).status,
      ).to.eql('failed');

      expect(
        (await deps.db.select().from(documentPreviewsTable))
          .map(
            ({ variant, status, failedAttemptsCount }) =>
              `${variant}:${status}:${failedAttemptsCount}`,
          )
          .toSorted(),
      ).to.eql(['card:failed:1', 'preview:failed:1', 'thumb:ready:0']);
    });

    test('a running job refreshes its pending previews so they are not considered stale', async () => {
      const deps = await createTestDeps();
      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      await deps.db.insert(documentPreviewsTable).values(
        PREVIEW_VARIANTS.map((variant) => ({
          documentId: 'doc-1',
          variant,
          status: 'pending' as const,
          createdAt: longAgo,
          updatedAt: longAgo,
        })),
      );

      let updatedAtDuringGeneration: Date[] = [];
      deps.generatePreviews.mockImplementationOnce(async () => {
        updatedAtDuringGeneration = (await deps.db.select().from(documentPreviewsTable)).map(
          ({ updatedAt }) => updatedAt,
        );
        throw new Error('stop');
      });

      await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        logger: createNoopLogger(),
        ...deps,
      });

      expect(updatedAtDuringGeneration).to.have.length(3);
      expect(
        updatedAtDuringGeneration.every((date) => date.getTime() > longAgo.getTime() + 1000),
      ).to.eql(true);
    });

    test('when the document is hard deleted while the job is running, the files written are deleted and nothing is recorded', async () => {
      const deps = await createTestDeps();
      const originalGenerate = deps.generatePreviews.getMockImplementation()!;
      deps.generatePreviews.mockImplementation(async (args) => {
        const result = await originalGenerate(args);
        await deps.db.delete(documentsTable).where(eq(documentsTable.id, 'doc-1'));
        return result;
      });

      const { status } = await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        logger: createNoopLogger(),
        ...deps,
      });

      expect(status).to.eql('skipped');
      expect([...deps.documentsStorageService._getStorage().keys()]).to.eql([
        'organization-1/originals/doc-1',
      ]);
      expect(await deps.db.select().from(documentPreviewsTable)).to.eql([]);
    });

    test('a previously failed generation that succeeds on retry resets the failure', async () => {
      const deps = await createTestDeps();
      deps.generatePreviews.mockRejectedValueOnce(new Error('Temporary failure'));
      const args = {
        documentId: 'doc-1',
        organizationId: 'organization-1',
        logger: createNoopLogger(),
        ...deps,
      };

      expect((await generateDocumentPreviews(args)).status).to.eql('failed');
      expect((await generateDocumentPreviews(args)).status).to.eql('generated');

      expect(
        (await deps.db.select().from(documentPreviewsTable)).map(
          ({ status, failedAttemptsCount }) => [status, failedAttemptsCount],
        ),
      ).to.eql([
        ['ready', 0],
        ['ready', 0],
        ['ready', 0],
      ]);
    });
  });

  describe('getDocumentPreviewOrScheduleGeneration', () => {
    const document = { id: 'doc-1', organizationId: 'organization-1', mimeType: 'application/pdf' };

    test('when no preview exists yet (document created before the feature), the generation is scheduled once and the preview is reported as not ready', async () => {
      const deps = await createTestDeps();
      const getPreview = async (now = new Date()) =>
        getDocumentPreviewOrScheduleGeneration({
          document,
          variant: 'thumb',
          arePreviewsEnabled: true,
          documentPreviewsRepository: deps.documentPreviewsRepository,
          taskServices: deps.taskServices,
          now,
        });

      expect(await getPreview()).to.eql({ status: 'not-ready' });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });

      const { job } = await deps.taskServices.getDriver().getNextJobAndMarkAsProcessing({
        abortSignal: AbortSignal.timeout(1000),
      });
      expect(job).toMatchObject({
        taskName: 'generate-document-previews',
        data: { documentId: 'doc-1', organizationId: 'organization-1' },
      });

      // Polling while the job is pending does not stack jobs
      expect(await getPreview()).to.eql({ status: 'not-ready' });
      expect(await getPreview()).to.eql({ status: 'not-ready' });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });

      // A pending preview that has been waiting for too long is scheduled again
      expect(await getPreview(new Date(Date.now() + 10 * 60 * 1000))).to.eql({
        status: 'not-ready',
      });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 2 });
    });

    test('a ready preview is returned with its storage and encryption context', async () => {
      const deps = await createTestDeps();
      await deps.documentPreviewsRepository.saveReadyDocumentPreview({
        documentId: 'doc-1',
        variant: 'card',
        storageKey: 'card-key',
        mimeType: 'image/webp',
        size: 10,
        width: 400,
        height: 566,
        fileEncryptionKeyWrapped: 'wrapped',
        fileEncryptionKekVersion: 'v1',
        fileEncryptionAlgorithm: 'aes-256-gcm',
      });

      const result = await getDocumentPreviewOrScheduleGeneration({
        document,
        variant: 'card',
        arePreviewsEnabled: true,
        documentPreviewsRepository: deps.documentPreviewsRepository,
        taskServices: deps.taskServices,
      });

      expect(result).toMatchObject({
        status: 'ready',
        preview: {
          storageKey: 'card-key',
          mimeType: 'image/webp',
          fileEncryptionKeyWrapped: 'wrapped',
          fileEncryptionKekVersion: 'v1',
          fileEncryptionAlgorithm: 'aes-256-gcm',
        },
      });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 0 });
    });

    test('unsupported document types and disabled previews are reported as unsupported without scheduling anything', async () => {
      const deps = await createTestDeps();
      const getPreview = async ({
        mimeType,
        arePreviewsEnabled,
      }: {
        mimeType: string;
        arePreviewsEnabled: boolean;
      }) =>
        getDocumentPreviewOrScheduleGeneration({
          document: { ...document, mimeType },
          variant: 'thumb',
          arePreviewsEnabled,
          documentPreviewsRepository: deps.documentPreviewsRepository,
          taskServices: deps.taskServices,
        });

      expect(await getPreview({ mimeType: 'text/plain', arePreviewsEnabled: true })).to.eql({
        status: 'unsupported',
      });
      expect(await getPreview({ mimeType: 'application/pdf', arePreviewsEnabled: false })).to.eql({
        status: 'unsupported',
      });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 0 });
      expect(await deps.db.select().from(documentPreviewsTable)).to.eql([]);
    });

    test('a failed generation is retried once on request, then reported as failed', async () => {
      const deps = await createTestDeps();
      const getPreview = async () =>
        getDocumentPreviewOrScheduleGeneration({
          document,
          variant: 'thumb',
          arePreviewsEnabled: true,
          documentPreviewsRepository: deps.documentPreviewsRepository,
          taskServices: deps.taskServices,
        });

      await deps.documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants: ['thumb', 'card', 'preview'],
      });

      expect(await getPreview()).to.eql({ status: 'not-ready' });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });

      await deps.documentPreviewsRepository.markDocumentPreviewsAsFailed({
        documentId: 'doc-1',
        variants: ['thumb', 'card', 'preview'],
      });

      expect(await getPreview()).to.eql({ status: 'failed' });
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });
    });
  });

  describe('requestDocumentPreviewsGeneration', () => {
    test('concurrent requests for a document without previews schedule exactly one job', async () => {
      const deps = await createTestDeps();

      const results = await Promise.all(
        Array.from({ length: 5 }, async () =>
          requestDocumentPreviewsGeneration({
            documentId: 'doc-1',
            organizationId: 'organization-1',
            documentPreviewsRepository: deps.documentPreviewsRepository,
            taskServices: deps.taskServices,
          }),
        ),
      );

      expect(results.filter(({ isScheduled }) => isScheduled)).to.have.length(1);
      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });
    });

    test('pending records are created and a job is scheduled', async () => {
      const deps = await createTestDeps();

      await requestDocumentPreviewsGeneration({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        documentPreviewsRepository: deps.documentPreviewsRepository,
        taskServices: deps.taskServices,
      });

      expect(await deps.taskServices.getJobCount()).to.eql({ count: 1 });
      expect(
        (await deps.db.select().from(documentPreviewsTable))
          .map(({ variant, status }) => `${variant}:${status}`)
          .toSorted(),
      ).to.eql(['card:pending', 'preview:pending', 'thumb:pending']);
    });
  });

  describe('getDocumentsPreviewApiStatuses', () => {
    test('the status of each document is derived from its type, the configuration and its stored previews', async () => {
      const deps = await createTestDeps();
      await deps.documentPreviewsRepository.claimDocumentPreviewsGeneration({
        documentId: 'doc-1',
        variants: ['thumb', 'card', 'preview'],
        staleBefore: new Date(0),
      });
      const getStatuses = async ({ arePreviewsEnabled = true } = {}) =>
        (
          await getDocumentsPreviewApiStatuses({
            documents: [
              { id: 'doc-1', mimeType: 'application/pdf' },
              { id: 'doc-2', mimeType: 'image/png' },
              { id: 'doc-3', mimeType: 'text/plain' },
            ],
            arePreviewsEnabled,
            documentPreviewsRepository: deps.documentPreviewsRepository,
          })
        ).previewStatusByDocumentId;

      expect(await getStatuses()).to.eql({
        'doc-1': 'pending',
        'doc-2': 'pending',
        'doc-3': 'unsupported',
      });

      for (const variant of ['thumb', 'card', 'preview'] as const) {
        await deps.documentPreviewsRepository.saveReadyDocumentPreview({
          documentId: 'doc-1',
          variant,
          storageKey: variant,
          mimeType: 'image/webp',
          size: 1,
          width: 1,
          height: 1,
        });
      }

      expect((await getStatuses())['doc-1']).to.eql('ready');
      expect((await getStatuses({ arePreviewsEnabled: false }))['doc-1']).to.eql('unsupported');
    });
  });

  describe('deleteDocumentPreviewFiles', () => {
    test('all the preview files of a document are deleted from the storage, a failing deletion does not throw', async () => {
      const deps = await createTestDeps();
      await generateDocumentPreviews({
        documentId: 'doc-1',
        organizationId: 'organization-1',
        ...deps,
      });

      await deleteDocumentPreviewFiles({
        documentId: 'doc-1',
        documentPreviewsRepository: deps.documentPreviewsRepository,
        documentsStorageService: deps.documentsStorageService,
      });

      expect([...deps.documentsStorageService._getStorage().keys()]).to.eql([
        'organization-1/originals/doc-1',
      ]);

      await expect(
        deleteDocumentPreviewFiles({
          documentId: 'doc-1',
          documentPreviewsRepository: deps.documentPreviewsRepository,
          documentsStorageService: {
            deleteFile: async () => {
              throw new Error('Storage unavailable');
            },
          },
          logger: createNoopLogger(),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
