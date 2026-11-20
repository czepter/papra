import type { RouteDefinitionContext } from '../app/server.types';
import * as v from 'valibot';
import { requireAuthentication } from '../app/auth/auth.middleware';
import { getUser } from '../app/auth/auth.models';
import { createDocumentPreviewsRepository } from '../document-previews/document-previews.repository';
import { createCustomPropertiesRepository } from '../custom-properties/custom-properties.repository';
import { createDocumentNotFoundError } from '../documents/documents.errors';
import { createDocumentsRepository } from '../documents/documents.repository';
import { documentIdSchema } from '../documents/documents.schemas';
import { enrichAndFormatDocumentsForApi } from '../documents/documents.usecases';
import { createOrganizationSettingsRepository } from '../organizations/organization-settings/organization-settings.repository';
import { organizationIdSchema } from '../organizations/organization.schemas';
import { createOrganizationsRepository } from '../organizations/organizations.repository';
import { ensureUserIsInOrganization } from '../organizations/organizations.usecases';
import { createQueryPaginationSchemaKeys } from '../shared/schemas/pagination.schemas';
import { validateJsonBody, validateParams, validateQuery } from '../shared/validation/validation';
import { createTagsRepository } from '../tags/tags.repository';
import { createDocumentInboxRepository } from './document-inbox.repository';
import { markDocumentsAsReviewedBodySchema } from './document-inbox.schemas';
import { getOrganizationInboxMode, markDocumentsAsReviewed } from './document-inbox.usecases';

// Must be registered before the documents routes, otherwise `inbox` and `reviews` are captured by the `:documentId` routes
export function registerDocumentInboxRoutes(context: RouteDefinitionContext) {
  setupGetInboxDocumentsRoute(context);
  setupGetInboxCountRoute(context);
  setupMarkDocumentsAsReviewedRoute(context);
  setupMoveDocumentBackToInboxRoute(context);
}

function setupGetInboxDocumentsRoute({ app, db, config }: RouteDefinitionContext) {
  app.get(
    '/api/organizations/:organizationId/documents/inbox',
    requireAuthentication({ apiKeyPermissions: ['documents:read'] }),
    validateParams(v.strictObject({ organizationId: organizationIdSchema })),
    validateQuery(
      v.strictObject({
        ...createQueryPaginationSchemaKeys({ maxPageSize: 100, defaultPageSize: 100 }),
      }),
    ),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId } = context.req.valid('param');
      const { pageIndex, pageSize } = context.req.valid('query');

      const organizationsRepository = createOrganizationsRepository({ db });
      const organizationSettingsRepository = createOrganizationSettingsRepository({ db });
      const documentInboxRepository = createDocumentInboxRepository({ db });
      const customPropertiesRepository = createCustomPropertiesRepository({ db });
      const tagsRepository = createTagsRepository({ db });
      const documentPreviewsRepository = createDocumentPreviewsRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { mode } = await getOrganizationInboxMode({
        organizationId,
        organizationSettingsRepository,
        config,
      });

      const { documents, documentsCount } = await documentInboxRepository.getInboxDocuments({
        organizationId,
        userId,
        mode,
        pageIndex,
        pageSize,
      });

      const { enrichedDocuments } = await enrichAndFormatDocumentsForApi({
        documents,
        tagsRepository,
        customPropertiesRepository,
        documentPreviewsRepository,
        arePreviewsEnabled: config.documents.previews.isEnabled,
      });

      return context.json({ documents: enrichedDocuments, documentsCount });
    },
  );
}

function setupGetInboxCountRoute({ app, db, config }: RouteDefinitionContext) {
  app.get(
    '/api/organizations/:organizationId/documents/inbox/count',
    requireAuthentication({ apiKeyPermissions: ['documents:read'] }),
    validateParams(v.strictObject({ organizationId: organizationIdSchema })),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId } = context.req.valid('param');

      const organizationsRepository = createOrganizationsRepository({ db });
      const organizationSettingsRepository = createOrganizationSettingsRepository({ db });
      const documentInboxRepository = createDocumentInboxRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { mode } = await getOrganizationInboxMode({
        organizationId,
        organizationSettingsRepository,
        config,
      });

      const { documentsCount } = await documentInboxRepository.getInboxCount({
        organizationId,
        userId,
        mode,
      });

      return context.json({ count: documentsCount });
    },
  );
}

function setupMarkDocumentsAsReviewedRoute({ app, db }: RouteDefinitionContext) {
  app.post(
    '/api/organizations/:organizationId/documents/reviews',
    requireAuthentication({ apiKeyPermissions: ['documents:update'] }),
    validateParams(v.strictObject({ organizationId: organizationIdSchema })),
    validateJsonBody(markDocumentsAsReviewedBodySchema),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId } = context.req.valid('param');
      const { documentIds } = context.req.valid('json');

      const organizationsRepository = createOrganizationsRepository({ db });
      const documentsRepository = createDocumentsRepository({ db });
      const documentInboxRepository = createDocumentInboxRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      await markDocumentsAsReviewed({
        organizationId,
        documentIds,
        userId,
        documentsRepository,
        documentInboxRepository,
      });

      return context.body(null, 204);
    },
  );
}

function setupMoveDocumentBackToInboxRoute({ app, db, config }: RouteDefinitionContext) {
  app.delete(
    '/api/organizations/:organizationId/documents/:documentId/review',
    requireAuthentication({ apiKeyPermissions: ['documents:update'] }),
    validateParams(
      v.strictObject({
        organizationId: organizationIdSchema,
        documentId: documentIdSchema,
      }),
    ),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId, documentId } = context.req.valid('param');

      const organizationsRepository = createOrganizationsRepository({ db });
      const organizationSettingsRepository = createOrganizationSettingsRepository({ db });
      const documentsRepository = createDocumentsRepository({ db });
      const documentInboxRepository = createDocumentInboxRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { document } = await documentsRepository.getDocumentById({
        documentId,
        organizationId,
      });

      if (!document) {
        throw createDocumentNotFoundError();
      }

      const { mode } = await getOrganizationInboxMode({
        organizationId,
        organizationSettingsRepository,
        config,
      });

      await documentInboxRepository.moveDocumentsBackToInbox({
        organizationId,
        documentIds: [documentId],
        userId,
        mode,
      });

      return context.body(null, 204);
    },
  );
}
