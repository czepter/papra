import * as v from 'valibot';
import { createTooManyRequestsError } from '../../app/rate-limit/rate-limit.errors';
import { createDocumentsRepository } from '../../documents/documents.repository';
import { documentIdSchema } from '../../documents/documents.schemas';
import { scheduleDocumentReprocessing } from '../../documents/documents.usecases';
import { organizationIdSchema } from '../../organizations/organization.schemas';
import { ADDITIVE_ANNOTATIONS, defineMcpTool } from '../mcp.tools.types';

export const reprocessDocumentTool = defineMcpTool({
  name: 'reprocess_document',
  description:
    'Schedule a new text extraction (OCR) for a document with the current instance configuration, for example after the OCR languages changed. It runs in the background and there is no status tool: call get_document a little later to see the new content. Existing content and tags stay in place until the job finishes. Reprocessing is rate limited per organization (100 requests per hour by default); when the limit is reached the result is an error with the number of seconds to wait before the next call.',
  input: v.strictObject({
    organizationId: organizationIdSchema,
    documentId: documentIdSchema,
  }),
  permissions: ['documents:update'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId }, deps }) => {
    const result = await scheduleDocumentReprocessing({
      documentId,
      organizationId,
      config: deps.config,
      documentsRepository: createDocumentsRepository({ db: deps.db }),
      kvStore: deps.kvStore,
      taskServices: deps.taskServices,
    });

    if (result.hasExceededLimit) {
      throw createTooManyRequestsError({
        message: `Reprocessing rate limit reached for this organization. Retry in ${result.retryAfter} seconds.`,
      });
    }

    return { scheduled: true };
  },
});
