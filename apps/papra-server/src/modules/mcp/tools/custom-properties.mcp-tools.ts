import * as v from 'valibot';
import { createDocumentNotFoundError } from '../../documents/documents.errors';
import { createDocumentsRepository } from '../../documents/documents.repository';
import { documentIdSchema } from '../../documents/documents.schemas';
import { organizationIdSchema } from '../../organizations/organization.schemas';
import { createOrganizationsRepository } from '../../organizations/organizations.repository';
import { isErrorWithCode } from '../../shared/errors/errors';
import type { CustomPropertyType } from '../../custom-properties/custom-properties.constants';
import { createCustomPropertyValueInvalidError } from '../../custom-properties/custom-properties.errors';
import { aggregateDocumentCustomPropertyValues } from '../../custom-properties/custom-properties.models';
import { createCustomPropertiesRepository } from '../../custom-properties/custom-properties.repository';
import { customPropertyDefinitionIdSchema } from '../../custom-properties/custom-properties.schemas';
import {
  createPropertyDefinition,
  deleteDocumentCustomPropertyValue,
  deletePropertyDefinition,
  ensurePropertyDefinitionExists,
  setDocumentCustomPropertyValue,
  updatePropertyDefinition,
} from '../../custom-properties/custom-properties.usecases';
import { createPropertyDefinitionBodySchema } from '../../custom-properties/definitions/custom-property-definition.registry';
import { createCustomPropertiesOptionsRepository } from '../../custom-properties/options/custom-properties-options.repository';
import {
  ADDITIVE_ANNOTATIONS,
  defineMcpTool,
  DESTRUCTIVE_ANNOTATIONS,
  IDEMPOTENT_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../mcp.tools.types';

// What the caller sends as value for each property type, from the value inputSchema of the type definitions
const VALUE_SHAPE_BY_TYPE: Record<CustomPropertyType, string> = {
  text: 'a string of at most 10,000 characters',
  number: 'a finite number',
  date: 'an ISO 8601 date string like 2024-01-31 or 2024-01-31T10:00:00Z',
  boolean: 'true or false',
  select: 'one option id (not the option name)',
  multi_select: 'an array of option ids (not the option names)',
  user_relation: 'an array of user ids, all members of the organization',
  document_relation: 'an array of document ids, all in the organization',
};

const CUSTOM_PROPERTY_VALUE_INVALID_CODE = createCustomPropertyValueInvalidError().code;

const organizationInput = { organizationId: organizationIdSchema };
const propertyDefinitionInput = {
  ...organizationInput,
  propertyDefinitionId: customPropertyDefinitionIdSchema,
};
const documentPropertyInput = { ...propertyDefinitionInput, documentId: documentIdSchema };

async function ensureDocumentInOrganization({
  documentId,
  organizationId,
  db,
}: {
  documentId: string;
  organizationId: string;
  db: Parameters<typeof createDocumentsRepository>[0]['db'];
}) {
  const documentsRepository = createDocumentsRepository({ db });
  // The value queries take the document id alone, this check is their only organization guard
  const { document } = await documentsRepository.getDocumentById({ documentId, organizationId });

  if (!document) {
    throw createDocumentNotFoundError();
  }

  return { documentsRepository };
}

export const listCustomPropertiesTool = defineMcpTool({
  name: 'list_custom_properties',
  description:
    'List the custom property definitions of an organization with their type and, for select and multi_select, their options (id and name).',
  input: v.strictObject(organizationInput),
  permissions: ['custom-properties:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId }, deps }) => {
    const customPropertiesRepository = createCustomPropertiesRepository({ db: deps.db });

    const { propertyDefinitions } =
      await customPropertiesRepository.getOrganizationPropertyDefinitions({ organizationId });

    return { propertyDefinitions };
  },
});

export const getCustomPropertyTool = defineMcpTool({
  name: 'get_custom_property',
  description:
    'Get one custom property definition with its type and, for select and multi_select, its options (id and name).',
  input: v.strictObject(propertyDefinitionInput),
  permissions: ['custom-properties:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId, propertyDefinitionId }, deps }) => {
    const customPropertiesRepository = createCustomPropertiesRepository({ db: deps.db });

    const { definition } = await ensurePropertyDefinitionExists({
      propertyDefinitionId,
      organizationId,
      customPropertiesRepository,
    });

    return { definition };
  },
});

export const getDocumentCustomPropertiesTool = defineMcpTool({
  name: 'get_document_custom_properties',
  description: 'Get the custom property values set on a document.',
  input: v.strictObject({ ...organizationInput, documentId: documentIdSchema }),
  permissions: ['documents:read', 'custom-properties:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId }, deps }) => {
    const customPropertiesRepository = createCustomPropertiesRepository({ db: deps.db });

    await ensureDocumentInOrganization({ documentId, organizationId, db: deps.db });

    const { values } = await customPropertiesRepository.getDocumentCustomPropertyValues({
      documentId,
    });

    return { customProperties: aggregateDocumentCustomPropertyValues({ rawValues: values }) };
  },
});

export const createCustomPropertyTool = defineMcpTool({
  name: 'create_custom_property',
  description:
    'Create a custom property definition. definition.type is one of text, number, date, boolean, select, multi_select, user_relation and document_relation; select and multi_select also need definition.options, a list of { name }.',
  input: v.strictObject({ ...organizationInput, definition: createPropertyDefinitionBodySchema }),
  permissions: ['custom-properties:create'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, definition }, deps }) => {
    const { propertyDefinition } = await createPropertyDefinition({
      organizationId,
      definition,
      config: deps.config,
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
      customPropertiesOptionsRepository: createCustomPropertiesOptionsRepository({ db: deps.db }),
    });

    return { propertyDefinition };
  },
});

export const updateCustomPropertyTool = defineMcpTool({
  name: 'update_custom_property',
  description:
    'Update a custom property definition. changes holds the fields to change (name, description, displayOrder and, for select and multi_select, options as a list of { id?, name }). The type cannot change.',
  input: v.strictObject({
    ...propertyDefinitionInput,
    // Validated by the use case against the update schema of the property type
    changes: v.pipe(
      // v.record would accept an array and rebuild it as an object, so the shape is checked on the raw value
      v.custom<Record<string, unknown>>(
        (changes) => typeof changes === 'object' && changes !== null && !Array.isArray(changes),
        'changes must be an object',
      ),
      v.check((changes) => Object.keys(changes).length > 0, 'changes must hold at least one field'),
    ),
  }),
  // The converter cannot express a custom check
  jsonSchemaOverride: {
    changes: {
      type: 'object',
      description:
        'Fields to change: name, description, displayOrder and, for select and multi_select, options.',
    },
  },
  permissions: ['custom-properties:update'],
  annotations: IDEMPOTENT_ANNOTATIONS,
  handler: async ({ input: { organizationId, propertyDefinitionId, changes }, deps }) => {
    const { propertyDefinition } = await updatePropertyDefinition({
      propertyDefinitionId,
      organizationId,
      rawDefinition: changes,
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
      customPropertiesOptionsRepository: createCustomPropertiesOptionsRepository({ db: deps.db }),
    });

    return { propertyDefinition };
  },
});

export const deleteCustomPropertyTool = defineMcpTool({
  name: 'delete_custom_property',
  description:
    'Delete a custom property definition and the values set with it on every document. This cannot be undone.',
  input: v.strictObject(propertyDefinitionInput),
  permissions: ['custom-properties:delete'],
  annotations: DESTRUCTIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, propertyDefinitionId }, deps }) => {
    await deletePropertyDefinition({
      propertyDefinitionId,
      organizationId,
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
    });

    return { deleted: true };
  },
});

export const setDocumentCustomPropertyTool = defineMcpTool({
  name: 'set_document_custom_property',
  description: `Set the value of a custom property on a document, replacing the previous value. Call get_custom_property first: the shape of value depends on the type of the property. ${Object.entries(
    VALUE_SHAPE_BY_TYPE,
  )
    .map(([type, shape]) => `${type}: ${shape}`)
    .join('; ')}. Use search_documents for document ids.`,
  input: v.strictObject({
    ...documentPropertyInput,
    value: v.pipe(
      v.unknown(),
      v.description(
        'The value, in the shape of the property type. See the tool description for the shape of each type.',
      ),
    ),
  }),
  permissions: ['documents:update', 'custom-properties:read'],
  annotations: IDEMPOTENT_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, propertyDefinitionId, value }, deps }) => {
    const customPropertiesRepository = createCustomPropertiesRepository({ db: deps.db });
    const { documentsRepository } = await ensureDocumentInOrganization({
      documentId,
      organizationId,
      db: deps.db,
    });

    try {
      await setDocumentCustomPropertyValue({
        documentId,
        propertyDefinitionId,
        organizationId,
        value,
        customPropertiesRepository,
        customPropertiesOptionsRepository: createCustomPropertiesOptionsRepository({ db: deps.db }),
        organizationsRepository: createOrganizationsRepository({ db: deps.db }),
        documentsRepository,
      });
    } catch (error) {
      if (!isErrorWithCode({ error, code: CUSTOM_PROPERTY_VALUE_INVALID_CODE })) {
        throw error;
      }

      // Name the expected shape so the model can retry
      const { definition } = await ensurePropertyDefinitionExists({
        propertyDefinitionId,
        organizationId,
        customPropertiesRepository,
      });
      const shape = VALUE_SHAPE_BY_TYPE[definition.type as CustomPropertyType];

      throw createCustomPropertyValueInvalidError({
        message: `The provided value is invalid for a ${definition.type} property${shape ? `, expected ${shape}` : ''}.`,
      });
    }

    return { updated: true };
  },
});

export const deleteDocumentCustomPropertyTool = defineMcpTool({
  name: 'delete_document_custom_property',
  description: 'Clear the value of a custom property on a document.',
  input: v.strictObject(documentPropertyInput),
  permissions: ['documents:update', 'custom-properties:read'],
  annotations: DESTRUCTIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, documentId, propertyDefinitionId }, deps }) => {
    await ensureDocumentInOrganization({ documentId, organizationId, db: deps.db });

    await deleteDocumentCustomPropertyValue({
      documentId,
      propertyDefinitionId,
      organizationId,
      customPropertiesRepository: createCustomPropertiesRepository({ db: deps.db }),
    });

    return { deleted: true };
  },
});
