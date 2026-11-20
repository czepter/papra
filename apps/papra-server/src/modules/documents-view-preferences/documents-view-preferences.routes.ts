import type { RouteDefinitionContext } from '../app/server.types';
import * as v from 'valibot';
import { requireAuthentication } from '../app/auth/auth.middleware';
import { getUser } from '../app/auth/auth.models';
import { organizationIdSchema } from '../organizations/organization.schemas';
import { createOrganizationsRepository } from '../organizations/organizations.repository';
import { ensureUserIsInOrganization } from '../organizations/organizations.usecases';
import { validateJsonBody, validateParams } from '../shared/validation/validation';
import { createDocumentsViewPreferencesRepository } from './documents-view-preferences.repository';
import { documentsViewPreferencesSchema } from './documents-view-preferences.schemas';

// Must be registered before the documents routes, otherwise `view-preferences` is captured by the `:documentId` routes
export function registerDocumentsViewPreferencesRoutes(context: RouteDefinitionContext) {
  setupGetDocumentsViewPreferencesRoute(context);
  setupSaveDocumentsViewPreferencesRoute(context);
}

// Not available to API keys, the preferences are personal to the logged-in user
function setupGetDocumentsViewPreferencesRoute({ app, db }: RouteDefinitionContext) {
  app.get(
    '/api/organizations/:organizationId/documents/view-preferences',
    requireAuthentication(),
    validateParams(v.strictObject({ organizationId: organizationIdSchema })),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId } = context.req.valid('param');

      const organizationsRepository = createOrganizationsRepository({ db });
      const documentsViewPreferencesRepository = createDocumentsViewPreferencesRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { preferences } = await documentsViewPreferencesRepository.getDocumentsViewPreferences({
        userId,
        organizationId,
      });

      return context.json({ preferences });
    },
  );
}

function setupSaveDocumentsViewPreferencesRoute({ app, db }: RouteDefinitionContext) {
  app.put(
    '/api/organizations/:organizationId/documents/view-preferences',
    requireAuthentication(),
    validateParams(v.strictObject({ organizationId: organizationIdSchema })),
    validateJsonBody(v.strictObject({ preferences: documentsViewPreferencesSchema })),
    async (context) => {
      const { userId } = getUser({ context });
      const { organizationId } = context.req.valid('param');
      const { preferences: preferencesToSave } = context.req.valid('json');

      const organizationsRepository = createOrganizationsRepository({ db });
      const documentsViewPreferencesRepository = createDocumentsViewPreferencesRepository({ db });

      await ensureUserIsInOrganization({ userId, organizationId, organizationsRepository });

      const { preferences } = await documentsViewPreferencesRepository.saveDocumentsViewPreferences(
        {
          userId,
          organizationId,
          preferences: preferencesToSave,
        },
      );

      return context.json({ preferences });
    },
  );
}
