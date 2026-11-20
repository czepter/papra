import type { generatePreviewImages as generatePreviewImagesImpl } from '@papra/lecture';
import type { Logger } from '../shared/logger/logger';
import type { DocumentsRepository } from '../documents/documents.repository';
import type { StorageService } from '../storage/storage.services';
import type { TaskServices } from '../tasks/tasks.services';
import type { DocumentPreviewsRepository } from './document-previews.repository';
import type { DocumentPreviewApiStatus, DocumentPreviewVariant } from './document-previews.types';
import { Readable } from 'node:stream';
import { generatePreviewImages, isPreviewSupportedMimeType } from '@papra/lecture';
import { safely } from '@corentinth/chisels';
import { createLogger } from '../shared/logger/logger';
import { collectStreamToFile } from '../shared/streams/stream.convertion';
import {
  DOCUMENT_PREVIEW_API_STATUSES,
  DOCUMENT_PREVIEW_STATUSES,
  GENERATE_DOCUMENT_PREVIEWS_TASK_NAME,
  PENDING_PREVIEW_STALE_DELAY_MS,
  PREVIEW_VARIANTS,
} from './document-previews.constants';
import {
  areAllPreviewVariantsReady,
  buildDocumentPreviewStorageKey,
  getDocumentPreviewApiStatus,
  isDocumentPreviewSupported,
  isPreviewGenerationRequired,
  isPreviewPermanentlyFailed,
} from './document-previews.models';

// Claiming the previews and scheduling the job are tied together: a job is only scheduled by the call that actually claimed the generation,
// so concurrent requests (or polling) for the same document never stack jobs
export async function requestDocumentPreviewsGeneration({
  documentId,
  organizationId,
  documentPreviewsRepository,
  taskServices,
  now = new Date(),
}: {
  documentId: string;
  organizationId: string;
  documentPreviewsRepository: Pick<DocumentPreviewsRepository, 'claimDocumentPreviewsGeneration'>;
  taskServices: Pick<TaskServices, 'scheduleJob'>;
  now?: Date;
}) {
  const { claimedVariants } = await documentPreviewsRepository.claimDocumentPreviewsGeneration({
    documentId,
    variants: PREVIEW_VARIANTS,
    now,
    staleBefore: new Date(now.getTime() - PENDING_PREVIEW_STALE_DELAY_MS),
  });

  if (claimedVariants.length === 0) {
    return { isScheduled: false };
  }

  await taskServices.scheduleJob({
    taskName: GENERATE_DOCUMENT_PREVIEWS_TASK_NAME,
    data: { documentId, organizationId },
  });

  return { isScheduled: true };
}

export async function generateDocumentPreviews({
  documentId,
  organizationId,
  documentsRepository,
  documentPreviewsRepository,
  documentsStorageService,
  generatePreviews = generatePreviewImages,
  logger = createLogger({ namespace: 'document-previews:usecases' }),
}: {
  documentId: string;
  organizationId: string;
  documentsRepository: Pick<DocumentsRepository, 'getDocumentById'>;
  documentPreviewsRepository: Pick<
    DocumentPreviewsRepository,
    | 'getDocumentPreviews'
    | 'saveReadyDocumentPreview'
    | 'markDocumentPreviewsAsFailed'
    | 'refreshPendingDocumentPreviews'
  >;
  documentsStorageService: Pick<
    StorageService,
    'getFileStream' | 'saveFile' | 'deleteFile' | 'fileExists'
  >;
  generatePreviews?: typeof generatePreviewImagesImpl;
  logger?: Logger;
}): Promise<{ status: 'generated' | 'already-generated' | 'unsupported' | 'failed' | 'skipped' }> {
  const { document } = await documentsRepository.getDocumentById({ documentId, organizationId });

  if (!document) {
    // The document may have been hard deleted since the job was scheduled
    logger.warn({ documentId, organizationId }, 'Document not found, skipping preview generation');
    return { status: 'skipped' };
  }

  // Documents of an unsupported type have no preview (the job may have been scheduled before the type support changed)
  if (!isPreviewSupportedMimeType({ mimeType: document.mimeType })) {
    return { status: 'unsupported' };
  }

  const { previews: existingPreviews } = await documentPreviewsRepository.getDocumentPreviews({
    documentId,
  });

  if (areAllPreviewVariantsReady({ previews: existingPreviews })) {
    return { status: 'already-generated' };
  }

  if (existingPreviews.some(isPreviewPermanentlyFailed)) {
    return { status: 'failed' };
  }

  // The job owns the pending previews while it runs, they must not be considered stale (and rescheduled) in the meantime
  await documentPreviewsRepository.refreshPendingDocumentPreviews({ documentId });

  const writtenStorageKeys: string[] = [];

  const [, error] = await safely(
    (async () => {
      const { fileStream } = await documentsStorageService.getFileStream({
        storageKey: document.originalStorageKey,
        fileEncryptionAlgorithm: document.fileEncryptionAlgorithm,
        fileEncryptionKekVersion: document.fileEncryptionKekVersion,
        fileEncryptionKeyWrapped: document.fileEncryptionKeyWrapped,
      });

      const { file } = await collectStreamToFile({
        fileStream,
        fileName: document.name,
        mimeType: document.mimeType,
      });

      const { previews } = await generatePreviews({
        arrayBuffer: await file.arrayBuffer(),
        mimeType: document.mimeType,
      });

      for (const { variant, buffer, mimeType, width, height } of previews) {
        const { storageKey } = buildDocumentPreviewStorageKey({
          organizationId,
          documentId,
          variant,
        });

        writtenStorageKeys.push(storageKey);

        // Storage drivers refuse to overwrite files, a leftover of a previous interrupted run is removed first
        if (await documentsStorageService.fileExists({ storageKey })) {
          await documentsStorageService.deleteFile({ storageKey });
        }

        // The preview is stored like the original file: same storage service, same encryption layer
        const encryptionMetadata = await documentsStorageService.saveFile({
          fileStream: Readable.from(buffer),
          fileName: `${variant}.webp`,
          mimeType,
          storageKey,
        });

        await documentPreviewsRepository.saveReadyDocumentPreview({
          documentId,
          variant,
          storageKey,
          mimeType,
          size: buffer.byteLength,
          width,
          height,
          ...encryptionMetadata,
        });
      }
    })(),
  );

  // The document may have been hard deleted while the job was running, the files written since have no record to be cleaned up with
  const { isDocumentGone } = await deleteOrphanPreviewFiles({
    documentId,
    organizationId,
    writtenStorageKeys,
    documentsRepository,
    documentPreviewsRepository,
    documentsStorageService,
    logger,
  });

  if (isDocumentGone) {
    return { status: 'skipped' };
  }

  if (error) {
    logger.error({ error, documentId, organizationId }, 'Failed to generate document previews');
    await documentPreviewsRepository.markDocumentPreviewsAsFailed({
      documentId,
      variants: PREVIEW_VARIANTS,
    });

    return { status: 'failed' };
  }

  logger.info({ documentId, organizationId }, 'Document previews generated');

  return { status: 'generated' };
}

async function deleteOrphanPreviewFiles({
  documentId,
  organizationId,
  writtenStorageKeys,
  documentsRepository,
  documentPreviewsRepository,
  documentsStorageService,
  logger,
}: {
  documentId: string;
  organizationId: string;
  writtenStorageKeys: string[];
  documentsRepository: Pick<DocumentsRepository, 'getDocumentById'>;
  documentPreviewsRepository: Pick<DocumentPreviewsRepository, 'getDocumentPreviews'>;
  documentsStorageService: Pick<StorageService, 'deleteFile'>;
  logger: Logger;
}) {
  if (writtenStorageKeys.length === 0) {
    return { isDocumentGone: false };
  }

  const { document } = await documentsRepository.getDocumentById({ documentId, organizationId });
  const { previews } = document
    ? await documentPreviewsRepository.getDocumentPreviews({ documentId })
    : { previews: [] };
  const recordedStorageKeys = new Set(previews.map(({ storageKey }) => storageKey));

  const orphanStorageKeys = writtenStorageKeys.filter(
    (storageKey) => !document || !recordedStorageKeys.has(storageKey),
  );

  await Promise.all(
    orphanStorageKeys.map(async (storageKey) => {
      const [, error] = await safely(documentsStorageService.deleteFile({ storageKey }));

      if (error) {
        logger.error({ error, documentId, storageKey }, 'Failed to delete orphan preview file');
      }
    }),
  );

  return { isDocumentGone: !document };
}

export type GetDocumentPreviewResult =
  | { status: 'ready'; preview: ReadyPreview }
  | { status: 'not-ready' }
  | { status: 'unsupported' }
  | { status: 'failed' };

type ReadyPreview = {
  storageKey: string;
  mimeType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  fileEncryptionKeyWrapped: string | null;
  fileEncryptionKekVersion: string | null;
  fileEncryptionAlgorithm: string | null;
};

// Resolves the preview of a document, when it does not exist yet (documents uploaded before the feature) its generation is scheduled
export async function getDocumentPreviewOrScheduleGeneration({
  document,
  variant,
  arePreviewsEnabled,
  documentPreviewsRepository,
  taskServices,
  now = new Date(),
}: {
  document: { id: string; organizationId: string; mimeType: string };
  variant: DocumentPreviewVariant;
  arePreviewsEnabled: boolean;
  documentPreviewsRepository: Pick<
    DocumentPreviewsRepository,
    'getDocumentPreviews' | 'claimDocumentPreviewsGeneration'
  >;
  taskServices: Pick<TaskServices, 'scheduleJob'>;
  now?: Date;
}): Promise<GetDocumentPreviewResult> {
  if (!isDocumentPreviewSupported({ mimeType: document.mimeType, arePreviewsEnabled })) {
    return { status: 'unsupported' };
  }

  const { previews } = await documentPreviewsRepository.getDocumentPreviews({
    documentId: document.id,
  });

  const preview = previews.find((preview) => preview.variant === variant);

  if (
    preview?.status === DOCUMENT_PREVIEW_STATUSES.READY &&
    preview.storageKey &&
    preview.mimeType
  ) {
    return {
      status: 'ready',
      preview: { ...preview, storageKey: preview.storageKey, mimeType: preview.mimeType },
    };
  }

  const apiStatus = getDocumentPreviewApiStatus({
    mimeType: document.mimeType,
    previews,
    arePreviewsEnabled,
  });

  if (apiStatus === DOCUMENT_PREVIEW_API_STATUSES.FAILED) {
    return { status: 'failed' };
  }

  if (isPreviewGenerationRequired({ previews, now })) {
    await requestDocumentPreviewsGeneration({
      documentId: document.id,
      organizationId: document.organizationId,
      documentPreviewsRepository,
      taskServices,
      now,
    });
  }

  return { status: 'not-ready' };
}

export async function getDocumentsPreviewApiStatuses({
  documents,
  arePreviewsEnabled,
  documentPreviewsRepository,
}: {
  documents: { id: string; mimeType: string }[];
  arePreviewsEnabled: boolean;
  documentPreviewsRepository: Pick<DocumentPreviewsRepository, 'getDocumentsPreviews'>;
}) {
  const { previewsByDocumentId } = await documentPreviewsRepository.getDocumentsPreviews({
    documentIds: documents.map(({ id }) => id),
  });

  const previewStatusByDocumentId: Record<string, DocumentPreviewApiStatus> = Object.fromEntries(
    documents.map(({ id, mimeType }) => [
      id,
      getDocumentPreviewApiStatus({
        mimeType,
        previews: previewsByDocumentId[id] ?? [],
        arePreviewsEnabled,
      }),
    ]),
  );

  return { previewStatusByDocumentId };
}

// Best effort: a preview file that can't be deleted must not prevent the document from being deleted
export async function deleteDocumentPreviewFiles({
  documentId,
  documentPreviewsRepository,
  documentsStorageService,
  logger = createLogger({ namespace: 'document-previews:usecases' }),
}: {
  documentId: string;
  documentPreviewsRepository: Pick<DocumentPreviewsRepository, 'getDocumentPreviews'>;
  documentsStorageService: Pick<StorageService, 'deleteFile'>;
  logger?: Logger;
}) {
  const { previews } = await documentPreviewsRepository.getDocumentPreviews({ documentId });

  await Promise.all(
    previews.map(async ({ storageKey }) => {
      if (!storageKey) {
        return;
      }

      const [, error] = await safely(documentsStorageService.deleteFile({ storageKey }));

      if (error) {
        logger.error({ error, documentId, storageKey }, 'Failed to delete document preview file');
      }
    }),
  );
}
