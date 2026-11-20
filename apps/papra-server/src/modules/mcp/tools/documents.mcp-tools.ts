import type { JsonSchema } from '@valibot/to-json-schema';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import * as v from 'valibot';
import { createCustomPropertiesRepository } from '../../custom-properties/custom-properties.repository';
import { DEFAULT_DOCUMENT_SEARCH_SORT } from '../../documents/document-search/document-search.constants';
import { searchOrganizationDocuments } from '../../documents/document-search/document-search.usecase';
import { createDocumentPreviewsRepository } from '../../document-previews/document-previews.repository';
import { createDocumentSizeTooLargeError } from '../../documents/documents.errors';
import { formatDocumentForApi, isDocumentSizeLimitEnabled } from '../../documents/documents.models';
import { createDocumentsRepository } from '../../documents/documents.repository';
import {
  documentIdSchema,
  documentSearchSortFieldSchema,
  documentSearchSortOrderSchema,
  hasAnyDocumentUpdate,
  searchDocumentsQuerySchema,
  UPDATE_DOCUMENT_BODY_EMPTY_MESSAGE,
  updateDocumentBodyEntries,
} from '../../documents/documents.schemas';
import {
  createDocumentCreationUsecase,
  enrichAndFormatDocumentForApi,
  enrichAndFormatDocumentsForApi,
  ensureDocumentExists,
  getDocumentOrThrow,
  updateDocument,
} from '../../documents/documents.usecases';
import { organizationIdSchema } from '../../organizations/organization.schemas';
import { createPlanEntitlementsRepository } from '../../plan-entitlements/plan-entitlements.repository';
import { createPlansRepository } from '../../plans/plans.repository';
import { getOrganizationPlan } from '../../plans/plans.usecases';
import { createSubscriptionsRepository } from '../../subscriptions/subscriptions.repository';
import { createTagsRepository } from '../../tags/tags.repository';
import {
  MCP_READ_CONTENT_DEFAULT_LIMIT,
  MCP_READ_CONTENT_MAX_LIMIT,
  MCP_SEARCH_DEFAULT_PAGE_SIZE,
  MCP_SEARCH_MAX_PAGE_SIZE,
  MCP_UPLOAD_FILE_NAME_MAX_LENGTH,
  MCP_UPLOAD_MAX_ENCODED_SIZE,
} from '../mcp.constants';
import { createMcpInvalidBase64Error } from '../mcp.errors';
import {
  ADDITIVE_ANNOTATIONS,
  defineMcpTool,
  IDEMPOTENT_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../mcp.tools.types';

// Same values as the documentDate of updateDocumentBodySchema: any string new Date() accepts, or null
export const DOCUMENT_DATE_JSON_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: 'string',
      description: 'ISO 8601 date or date-time, for example 2024-01-31 or 2024-01-31T10:00:00Z',
    },
    { type: 'null', description: 'Clears the date' },
  ],
};

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

// The full text of a document can be huge, it is only returned by read_document_content
function withContentLength<T extends { content?: string }>(document: T) {
  const { content, ...rest } = document;

  return content === undefined ? rest : { ...rest, contentLength: content.length };
}

// Strict on purpose: Buffer.from(..., 'base64') silently skips invalid characters
function decodeBase64({ contentBase64 }: { contentBase64: string }) {
  if (contentBase64.length % 4 !== 0 || !BASE64_REGEX.test(contentBase64)) {
    throw createMcpInvalidBase64Error();
  }

  const padding = contentBase64.endsWith('==') ? 2 : contentBase64.endsWith('=') ? 1 : 0;

  return { decodedSize: (contentBase64.length / 4) * 3 - padding };
}

const documentInput = { organizationId: organizationIdSchema, documentId: documentIdSchema };

export const searchDocumentsTool = defineMcpTool({
  name: 'search_documents',
  description:
    'Search and list the documents of an organization. searchQuery matches the name and the extracted text; leave it empty to list. Returns one page of documents with their tags and custom properties, without the full text (use read_document_content), plus the total count.',
  input: v.strictObject({
    organizationId: organizationIdSchema,
    searchQuery: v.optional(searchDocumentsQuerySchema, ''),
    sortField: v.optional(documentSearchSortFieldSchema, DEFAULT_DOCUMENT_SEARCH_SORT.field),
    sortOrder: v.optional(documentSearchSortOrderSchema, DEFAULT_DOCUMENT_SEARCH_SORT.order),
    pageIndex: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0)), 0),
    pageSize: v.optional(
      v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MCP_SEARCH_MAX_PAGE_SIZE)),
      MCP_SEARCH_DEFAULT_PAGE_SIZE,
    ),
  }),
  permissions: ['documents:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({
    input: { organizationId, searchQuery, sortField, sortOrder, pageIndex, pageSize },
    deps,
  }) => {
    const { documents, documentsCount } = await searchOrganizationDocuments({
      organizationId,
      searchQuery,
      pageIndex,
      pageSize,
      sort: { field: sortField, order: sortOrder },
      documentSearchServices: deps.documentSearchServices,
    });
    const { enrichedDocuments } = await enrichAndFormatDocumentsForApi({
      documents,
      tagsRepository: createTagsRepository({ db: deps.db }),
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
      documentPreviewsRepository: createDocumentPreviewsRepository({ db: deps.db }),
      arePreviewsEnabled: deps.config.documents.previews.isEnabled,
    });

    return {
      documents: enrichedDocuments,
      documentsCount,
    };
  },
});

export const getDocumentTool = defineMcpTool({
  name: 'get_document',
  description:
    'Get one document with its metadata, tags and custom properties. The extracted text is not included, only its length in contentLength: use read_document_content for the text.',
  input: v.strictObject(documentInput),
  permissions: ['documents:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId }, deps }) => {
    const { document } = await getDocumentOrThrow({
      documentId,
      organizationId,
      documentsRepository: createDocumentsRepository({ db: deps.db }),
    });
    const { enrichedDocument } = await enrichAndFormatDocumentForApi({
      document,
      tagsRepository: createTagsRepository({ db: deps.db }),
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
      documentPreviewsRepository: createDocumentPreviewsRepository({ db: deps.db }),
      arePreviewsEnabled: deps.config.documents.previews.isEnabled,
    });

    return { document: withContentLength(enrichedDocument) };
  },
});

export const readDocumentContentTool = defineMcpTool({
  name: 'read_document_content',
  description: `Read the extracted text of a document as a slice of characters. Use offset and limit to read long documents in pieces: hasMore tells whether text follows. Default limit ${MCP_READ_CONTENT_DEFAULT_LIMIT}, maximum ${MCP_READ_CONTENT_MAX_LIMIT}.`,
  input: v.strictObject({
    ...documentInput,
    offset: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0)), 0),
    limit: v.optional(
      v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MCP_READ_CONTENT_MAX_LIMIT)),
      MCP_READ_CONTENT_DEFAULT_LIMIT,
    ),
  }),
  permissions: ['documents:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, offset, limit }, deps }) => {
    const { document } = await getDocumentOrThrow({
      documentId,
      organizationId,
      documentsRepository: createDocumentsRepository({ db: deps.db }),
    });

    return {
      documentId,
      content: document.content.slice(offset, offset + limit),
      offset,
      limit,
      totalLength: document.content.length,
      hasMore: offset + limit < document.content.length,
    };
  },
});

export const updateDocumentTool = defineMcpTool({
  name: 'update_document',
  description:
    'Update the name, the extracted text (content), the date (documentDate, an ISO 8601 string, or null to clear it) or the notes of a document. At least one of them is required; only the given fields change.',
  input: v.pipe(
    v.strictObject({ ...documentInput, ...updateDocumentBodyEntries }),
    v.check((data) => hasAnyDocumentUpdate(data), UPDATE_DOCUMENT_BODY_EMPTY_MESSAGE),
  ),
  // The converter drops toDate, leaving a bare string
  jsonSchemaOverride: { documentDate: DOCUMENT_DATE_JSON_SCHEMA },
  permissions: ['documents:update'],
  annotations: IDEMPOTENT_ANNOTATIONS,
  handler: async ({
    input: { organizationId, documentId, content, documentDate, name, notes },
    userId,
    deps,
  }) => {
    const documentsRepository = createDocumentsRepository({ db: deps.db });

    await ensureDocumentExists({ documentId, organizationId, documentsRepository });

    const { document } = await updateDocument({
      documentId,
      organizationId,
      userId,
      documentsRepository,
      eventServices: deps.eventServices,
      changes: { content, documentDate, name, notes },
    });

    return { document: withContentLength(formatDocumentForApi({ document })) };
  },
});

export const uploadDocumentTool = defineMcpTool({
  name: 'upload_document',
  description: `Upload a new document from base64 encoded file content. The encoded content is limited to ${MCP_UPLOAD_MAX_ENCODED_SIZE / 1024 / 1024} MB and the file to the size limit of the organization plan. The text of the file is extracted in the background, so it may not be searchable right away.`,
  input: v.strictObject({
    organizationId: organizationIdSchema,
    fileName: v.pipe(v.string(), v.minLength(1), v.maxLength(MCP_UPLOAD_FILE_NAME_MAX_LENGTH)),
    mimeType: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
    contentBase64: v.pipe(v.string(), v.minLength(1), v.maxLength(MCP_UPLOAD_MAX_ENCODED_SIZE)),
  }),
  permissions: ['documents:create'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({
    input: { organizationId, fileName, mimeType, contentBase64 },
    userId,
    deps,
  }) => {
    const { organizationPlan } = await getOrganizationPlan({
      organizationId,
      plansRepository: createPlansRepository({ config: deps.config }),
      subscriptionsRepository: createSubscriptionsRepository({ db: deps.db }),
      planEntitlementsRepository: createPlanEntitlementsRepository({ db: deps.db }),
      planEntitlementDefinitionRegistry: deps.planEntitlementDefinitionRegistry,
    });
    const { maxFileSize } = organizationPlan.limits;

    const { decodedSize } = decodeBase64({ contentBase64 });

    // Checked on the computed size so an oversized file is never decoded
    if (isDocumentSizeLimitEnabled({ maxUploadSize: maxFileSize }) && decodedSize > maxFileSize) {
      throw createDocumentSizeTooLargeError();
    }

    const createDocument = createDocumentCreationUsecase({
      db: deps.db,
      config: deps.config,
      taskServices: deps.taskServices,
      documentsStorageService: deps.documentsStorageService,
      eventServices: deps.eventServices,
      planEntitlementDefinitionRegistry: deps.planEntitlementDefinitionRegistry,
    });

    const { document } = await createDocument({
      fileStream: Readable.from(Buffer.from(contentBase64, 'base64')),
      fileName,
      mimeType,
      userId,
      organizationId,
    });

    return { document: withContentLength(formatDocumentForApi({ document })) };
  },
});
