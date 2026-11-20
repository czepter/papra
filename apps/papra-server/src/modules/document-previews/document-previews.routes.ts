import type { RouteDefinitionContext } from '../app/server.types';
import { Readable } from 'node:stream';
import * as v from 'valibot';
import { requireAuthentication } from '../app/auth/auth.middleware';
import { getUser } from '../app/auth/auth.models';
import { documentIdSchema } from '../documents/documents.schemas';
import { getDocumentOrThrow } from '../documents/documents.usecases';
import { createDocumentsRepository } from '../documents/documents.repository';
import { organizationIdSchema } from '../organizations/organization.schemas';
import { createOrganizationsRepository } from '../organizations/organizations.repository';
import { ensureUserIsInOrganization } from '../organizations/organizations.usecases';
import { formatPublicErrorPayload } from '../shared/errors/errors';
import { validateParams } from '../shared/validation/validation';
import {
  PREVIEW_CACHE_MAX_AGE_SECONDS,
  PREVIEW_NOT_READY_RETRY_AFTER_SECONDS,
} from './document-previews.constants';
import {
  createDocumentPreviewFailedError,
  createDocumentPreviewNotReadyError,
  createDocumentPreviewUnsupportedError,
} from './document-previews.errors';
import { buildPreviewEtag } from './document-previews.models';
import { createDocumentPreviewsRepository } from './document-previews.repository';
import { documentPreviewVariantSchema } from './document-previews.schemas';
import { getDocumentPreviewOrScheduleGeneration } from './document-previews.usecases';

export function registerDocumentPreviewsRoutes(context: RouteDefinitionContext) {
  setupGetDocumentPreviewRoute(context);
}

// Responses:
// - 200: the decrypted webp image, cached privately (ETag derived from the file hash, 304 on matching If-None-Match)
// - 503 `document.preview_not_ready` + Retry-After: the preview is not generated yet (generation has been scheduled), retry later
// - 404 `document.preview_unsupported`: previews are disabled or the document type has none, do not retry
// - 404 `document.preview_failed`: the generation failed permanently, do not retry
function setupGetDocumentPreviewRoute({
  app,
  db,
  config,
  taskServices,
  documentsStorageService,
}: RouteDefinitionContext) {
  app.get(
    '/api/organizations/:organizationId/documents/:documentId/previews/:variant',
    requireAuthentication({ apiKeyPermissions: ['documents:read'] }),
    validateParams(
      v.strictObject({
        organizationId: organizationIdSchema,
        documentId: documentIdSchema,
        variant: documentPreviewVariantSchema,
      }),
    ),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId, documentId, variant } = context.req.valid('param');

      const documentsRepository = createDocumentsRepository({ db });
      const organizationsRepository = createOrganizationsRepository({ db });
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { document } = await getDocumentOrThrow({
        documentId,
        organizationId,
        documentsRepository,
      });

      const result = await getDocumentPreviewOrScheduleGeneration({
        document,
        variant,
        arePreviewsEnabled: config.documents.previews.isEnabled,
        documentPreviewsRepository,
        taskServices,
      });

      if (result.status === 'unsupported') {
        throw createDocumentPreviewUnsupportedError();
      }

      if (result.status === 'failed') {
        throw createDocumentPreviewFailedError();
      }

      if (result.status === 'not-ready') {
        // Not thrown, as this is an expected state that would otherwise be logged as an error for every polling request
        const error = createDocumentPreviewNotReadyError();

        return context.json(formatPublicErrorPayload(error), error.statusCode, {
          'Retry-After': String(PREVIEW_NOT_READY_RETRY_AFTER_SECONDS),
          'Cache-Control': 'no-store',
        });
      }

      const { preview } = result;
      const etag = buildPreviewEtag({ originalSha256Hash: document.originalSha256Hash, variant });
      const cacheHeaders = {
        // Private as the preview is only available to authenticated members of the organization
        'Cache-Control': `private, max-age=${PREVIEW_CACHE_MAX_AGE_SECONDS}`,
        'ETag': etag,
        'X-Content-Type-Options': 'nosniff',
      };

      if (context.req.header('If-None-Match') === etag) {
        return context.body(null, 304, cacheHeaders);
      }

      const { fileStream } = await documentsStorageService.getFileStream({
        storageKey: preview.storageKey,
        fileEncryptionAlgorithm: preview.fileEncryptionAlgorithm,
        fileEncryptionKekVersion: preview.fileEncryptionKekVersion,
        fileEncryptionKeyWrapped: preview.fileEncryptionKeyWrapped,
      });

      return context.body(Readable.toWeb(fileStream), 200, {
        ...cacheHeaders,
        'Content-Type': preview.mimeType,
        ...(preview.size === null ? {} : { 'Content-Length': String(preview.size) }),
      });
    },
  );
}
