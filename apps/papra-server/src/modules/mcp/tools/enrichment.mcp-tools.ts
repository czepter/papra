import * as v from 'valibot';
import { buildScheduleDocumentEnrichment } from '../../document-enrichment/document-enrichment.usecases';
import { enrichDocumentContract } from '../../document-enrichment/document-enrichment.api.contracts';
import { createDocumentsRepository } from '../../documents/documents.repository';
import { createOrganizationSettingsRepository } from '../../organizations/organization-settings/organization-settings.repository';
import { createResolveOrganizationSettingsUsecase } from '../../organizations/organization-settings/organization-settings.usecases';
import { ADDITIVE_ANNOTATIONS, defineMcpTool } from '../mcp.tools.types';

export const enrichDocumentTool = defineMcpTool({
  name: 'enrich_document',
  description:
    'Schedule the enrichment of a document from its extracted text. The only capability today is auto-tagging, which adds matching tags. It runs in the background and there is no status tool: call get_document a little later to see the tags. Returns the id of the scheduled task.',
  input: v.strictObject({
    ...enrichDocumentContract.request.params.entries,
    ...enrichDocumentContract.request.body['application/json'].entries,
  }),
  permissions: ['documents:update'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, capabilities }, deps }) => {
    const scheduleDocumentEnrichment = buildScheduleDocumentEnrichment({
      config: deps.config,
      taskServices: deps.taskServices,
      documentsRepository: createDocumentsRepository({ db: deps.db }),
      resolveOrganizationSettings: createResolveOrganizationSettingsUsecase({
        config: deps.config,
        organizationSettingsRepository: createOrganizationSettingsRepository({ db: deps.db }),
      }),
    });

    const { taskId } = await scheduleDocumentEnrichment({
      organizationId,
      documentId,
      capabilities,
    });

    return { taskId };
  },
});
