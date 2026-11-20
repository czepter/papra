import * as v from 'valibot';
import { createDocumentActivityRepository } from '../../documents/document-activity/document-activity.repository';
import { deferRegisterDocumentActivityLog } from '../../documents/document-activity/document-activity.usecases';
import { createDocumentNotFoundError } from '../../documents/documents.errors';
import { createDocumentsRepository } from '../../documents/documents.repository';
import {
  addOrganizationDocumentTagContract,
  createOrganizationTagContract,
  deleteOrganizationTagContract,
  getOrganizationTagsContract,
  removeOrganizationDocumentTagContract,
  updateOrganizationTagContract,
} from '../../tags/tags.api.contracts';
import { createTagCreationFailedError, createTagNotFoundError } from '../../tags/tags.errors';
import { createTagsRepository } from '../../tags/tags.repository';
import { addTagToDocument, createTag } from '../../tags/tags.usecases';
import {
  ADDITIVE_ANNOTATIONS,
  defineMcpTool,
  DESTRUCTIVE_ANNOTATIONS,
  IDEMPOTENT_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../mcp.tools.types';

// The input of a tool is the params and the JSON body of the matching contract in one flat object
const createTagInput = v.strictObject({
  ...createOrganizationTagContract.request.params.entries,
  ...createOrganizationTagContract.request.body['application/json'].entries,
});
const updateTagInput = v.strictObject({
  ...updateOrganizationTagContract.request.params.entries,
  ...updateOrganizationTagContract.request.body['application/json'].entries,
});
const addDocumentTagInput = v.strictObject({
  ...addOrganizationDocumentTagContract.request.params.entries,
  ...addOrganizationDocumentTagContract.request.body['application/json'].entries,
});

export const listTagsTool = defineMcpTool({
  name: 'list_tags',
  description:
    'List the tags of an organization with their ids, colors and the number of documents using them.',
  input: v.strictObject(getOrganizationTagsContract.request.params.entries),
  permissions: ['tags:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId }, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });
    const { tags } = await tagsRepository.getOrganizationTags({ organizationId });

    return { tags };
  },
});

export const createTagTool = defineMcpTool({
  name: 'create_tag',
  description: 'Create a tag in an organization. The color is a hex color code like #00ff00.',
  input: createTagInput,
  permissions: ['tags:create'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, name, color, description }, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });

    const { tag } = await createTag({
      organizationId,
      name,
      color,
      description,
      config: deps.config,
      tagsRepository,
    });

    if (!tag) {
      throw createTagCreationFailedError();
    }

    return { tag };
  },
});

export const updateTagTool = defineMcpTool({
  name: 'update_tag',
  description: 'Rename or recolor a tag, or change its description. Only the given fields change.',
  input: updateTagInput,
  permissions: ['tags:update'],
  annotations: IDEMPOTENT_ANNOTATIONS,
  handler: async ({ input: { organizationId, tagId, name, color, description }, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });

    const { tag } = await tagsRepository.updateTag({
      tagId,
      organizationId,
      name,
      color,
      description,
    });

    if (!tag) {
      throw createTagNotFoundError();
    }

    return { tag };
  },
});

export const deleteTagTool = defineMcpTool({
  name: 'delete_tag',
  description:
    'Delete a tag. It is removed from every document that has it. This cannot be undone.',
  input: v.strictObject(deleteOrganizationTagContract.request.params.entries),
  permissions: ['tags:delete'],
  annotations: DESTRUCTIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, tagId }, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });

    // Scoped by organization: a tag of another organization is reported as not found
    await tagsRepository.deleteTag({ tagId, organizationId });

    return { deleted: true };
  },
});

export const addDocumentTagTool = defineMcpTool({
  name: 'add_document_tag',
  description:
    'Attach a tag to a document. Use list_tags for tag ids and search_documents for document ids.',
  input: addDocumentTagInput,
  permissions: ['documents:update', 'tags:read'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, tagId }, userId, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });
    const documentsRepository = createDocumentsRepository({ db: deps.db });
    const documentActivityRepository = createDocumentActivityRepository({ db: deps.db });

    const [{ document }, { tag }] = await Promise.all([
      documentsRepository.getDocumentById({ organizationId, documentId }),
      tagsRepository.getTagById({ tagId, organizationId }),
    ]);

    if (!document) {
      throw createDocumentNotFoundError();
    }

    if (!tag) {
      throw createTagNotFoundError();
    }

    await addTagToDocument({
      tagId,
      documentId,
      organizationId,
      userId,
      tag,
      tagsRepository,
      webhookTriggerServices: deps.webhookTriggerServices,
      documentActivityRepository,
    });

    return { added: true };
  },
});

export const removeDocumentTagTool = defineMcpTool({
  name: 'remove_document_tag',
  description: 'Detach a tag from a document. The tag itself is kept.',
  input: v.strictObject(removeOrganizationDocumentTagContract.request.params.entries),
  permissions: ['documents:update', 'tags:read'],
  annotations: DESTRUCTIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, tagId }, userId, deps }) => {
    const tagsRepository = createTagsRepository({ db: deps.db });
    const documentsRepository = createDocumentsRepository({ db: deps.db });
    const documentActivityRepository = createDocumentActivityRepository({ db: deps.db });

    const [{ document }, { tag }] = await Promise.all([
      documentsRepository.getDocumentById({ organizationId, documentId }),
      tagsRepository.getTagById({ tagId, organizationId }),
    ]);

    if (!document) {
      throw createDocumentNotFoundError();
    }

    if (!tag) {
      throw createTagNotFoundError();
    }

    await tagsRepository.removeTagFromDocument({ tagId, documentId });

    deps.webhookTriggerServices.deferTriggerWebhooks({
      organizationId,
      event: 'document:tag:removed',
      payloads: [{ documentId, organizationId, tagId, tagName: tag.name }],
    });

    deferRegisterDocumentActivityLog({
      documentId,
      event: 'untagged',
      userId,
      documentActivityRepository,
      tagId,
    });

    return { removed: true };
  },
});
