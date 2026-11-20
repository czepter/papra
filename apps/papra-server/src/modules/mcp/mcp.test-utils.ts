import { getApiKeyHash } from '../api-keys/api-keys.models';
import { apiKeysTable } from '../api-keys/api-keys.tables';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createServer } from '../app/server';
import { createTestServerDependencies } from '../app/server.test-utils';
import {
  customPropertyDefinitionsTable,
  documentCustomPropertyValuesTable,
} from '../custom-properties/custom-properties.table';
import { customPropertySelectOptionsTable } from '../custom-properties/options/custom-properties-options.table';
import { documentsTable } from '../documents/documents.table';
import { organizationMembersTable } from '../organizations/organizations.table';
import { documentsTagsTable, tagsTable } from '../tags/tags.table';
import {
  taggingRuleActionsTable,
  taggingRuleConditionsTable,
  taggingRulesTable,
} from '../tagging-rules/tagging-rules.tables';
import { overrideConfig } from '../config/config.test-utils';
import type { ApiKeyPermissions } from '../api-keys/api-keys.types';
import type { GlobalDependencies } from '../app/server.types';
import type { Database } from '../app/database/database.types';

// Ids must match the id regexes of the schemas: prefix, underscore, 24 lowercase alphanumeric characters
export function testId(prefix: string, label: string) {
  return `${prefix}_${label.padEnd(24, '0')}`;
}

export const ids = {
  alice: testId('usr', 'alice'),
  bob: testId('usr', 'bob'),
  orgA: testId('org', 'orga'),
  orgB: testId('org', 'orgb'),
  docA1: testId('doc', 'docaone'),
  docA2: testId('doc', 'docatwo'),
  docB1: testId('doc', 'docbone'),
  tagA1: testId('tag', 'tagaone'),
  tagA2: testId('tag', 'tagatwo'),
  tagB1: testId('tag', 'tagbone'),
  ruleA1: testId('tr', 'ruleaone'),
  ruleB1: testId('tr', 'rulebone'),
  // Property definitions of organization A, one per type
  propText: testId('cpd', 'proptext'),
  propNumber: testId('cpd', 'propnumber'),
  propDate: testId('cpd', 'propdate'),
  propBoolean: testId('cpd', 'propboolean'),
  propSelect: testId('cpd', 'propselect'),
  propMultiSelect: testId('cpd', 'propmultiselect'),
  propUserRelation: testId('cpd', 'propuserrelation'),
  propDocumentRelation: testId('cpd', 'propdocumentrelation'),
  // Property definition of organization B
  propB: testId('cpd', 'propb'),
  optionA1: testId('cpso', 'optionaone'),
  optionA2: testId('cpso', 'optionatwo'),
  optionB1: testId('cpso', 'optionbone'),
};

export const DOC_A1_CONTENT = 'Invoice from Acme: total due is 1200 euros. '.repeat(10).trim();
export const DOC_B1_CONTENT = 'Confidential letter of the Bob organization';

const propertyDefinitionRow = ({
  id,
  organizationId = ids.orgA,
  type,
  name,
}: {
  id: string;
  organizationId?: string;
  type: (typeof customPropertyDefinitionsTable.$inferInsert)['type'];
  name: string;
}) => ({ id, organizationId, type, name, key: name.toLowerCase().replaceAll(' ', '-') });

const documentRow = ({
  id,
  organizationId,
  name,
  content,
  createdBy,
}: {
  id: string;
  organizationId: string;
  name: string;
  content: string;
  createdBy: string;
}) => ({
  id,
  organizationId,
  createdBy,
  name,
  originalName: name,
  content,
  originalStorageKey: `${organizationId}/originals/${id}.txt`,
  mimeType: 'text/plain',
  originalSize: content.length,
  originalSha256Hash: `hash-${id}`,
});

let keyCounter = 0;

export function createTestToken() {
  keyCounter += 1;

  return `ppapi_${keyCounter.toString(36).padStart(64, 'k')}`;
}

export async function insertApiKey({
  db,
  userId,
  permissions,
}: {
  db: Database;
  userId: string;
  permissions: ApiKeyPermissions[];
}) {
  const token = createTestToken();

  await db.insert(apiKeysTable).values({
    name: 'test key',
    userId,
    prefix: token.slice(0, 11),
    keyHash: getApiKeyHash({ token }).keyHash,
    permissions,
  });

  return { token };
}

export async function setupMcpTest({
  config = {},
  dependencies = {},
}: {
  config?: Parameters<typeof overrideConfig>[0];
  dependencies?: Partial<GlobalDependencies>;
} = {}) {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: ids.alice, email: 'alice@example.com' },
      { id: ids.bob, email: 'bob@example.com' },
    ],
    organizations: [
      { id: ids.orgA, name: 'Alice org' },
      { id: ids.orgB, name: 'Bob org' },
    ],
    organizationMembers: [
      {
        id: testId('org_mem', 'alice'),
        organizationId: ids.orgA,
        userId: ids.alice,
        role: 'owner',
      },
      { id: testId('org_mem', 'bob'), organizationId: ids.orgB, userId: ids.bob, role: 'owner' },
    ],
    documents: [
      documentRow({
        id: ids.docA1,
        organizationId: ids.orgA,
        name: 'Acme invoice',
        content: DOC_A1_CONTENT,
        createdBy: ids.alice,
      }),
      documentRow({
        id: ids.docA2,
        organizationId: ids.orgA,
        name: 'Holiday photo',
        content: 'beach',
        createdBy: ids.alice,
      }),
      documentRow({
        id: ids.docB1,
        organizationId: ids.orgB,
        name: 'Bob letter',
        content: DOC_B1_CONTENT,
        createdBy: ids.bob,
      }),
    ],
    tags: [
      {
        id: ids.tagA1,
        organizationId: ids.orgA,
        name: 'Finance',
        normalizedName: 'finance',
        color: '#00FF00',
      },
      {
        id: ids.tagA2,
        organizationId: ids.orgA,
        name: 'Travel',
        normalizedName: 'travel',
        color: '#0000FF',
      },
      {
        id: ids.tagB1,
        organizationId: ids.orgB,
        name: 'Secret',
        normalizedName: 'secret',
        color: '#FF0000',
      },
    ],
    customPropertyDefinitions: [
      propertyDefinitionRow({ id: ids.propText, type: 'text', name: 'Reference' }),
      propertyDefinitionRow({ id: ids.propNumber, type: 'number', name: 'Amount' }),
      propertyDefinitionRow({ id: ids.propDate, type: 'date', name: 'Due date' }),
      propertyDefinitionRow({ id: ids.propBoolean, type: 'boolean', name: 'Paid' }),
      propertyDefinitionRow({ id: ids.propSelect, type: 'select', name: 'Status' }),
      propertyDefinitionRow({ id: ids.propMultiSelect, type: 'multi_select', name: 'Labels' }),
      propertyDefinitionRow({ id: ids.propUserRelation, type: 'user_relation', name: 'Owners' }),
      propertyDefinitionRow({
        id: ids.propDocumentRelation,
        type: 'document_relation',
        name: 'Related',
      }),
      propertyDefinitionRow({
        id: ids.propB,
        organizationId: ids.orgB,
        type: 'select',
        name: 'Secret status',
      }),
    ],
    customPropertySelectOptions: [
      { id: ids.optionA1, propertyDefinitionId: ids.propSelect, name: 'Open', key: 'open' },
      { id: ids.optionA2, propertyDefinitionId: ids.propSelect, name: 'Closed', key: 'closed' },
      { id: ids.optionB1, propertyDefinitionId: ids.propB, name: 'Hidden', key: 'hidden' },
    ],
  });

  // A multi select shares the options table of the select type, give it its own options
  await db.insert(customPropertySelectOptionsTable).values([
    {
      id: testId('cpso', 'labelone'),
      propertyDefinitionId: ids.propMultiSelect,
      name: 'Urgent',
      key: 'urgent',
    },
    {
      id: testId('cpso', 'labeltwo'),
      propertyDefinitionId: ids.propMultiSelect,
      name: 'Later',
      key: 'later',
    },
  ]);

  await db.insert(documentsTagsTable).values({ documentId: ids.docA1, tagId: ids.tagA1 });
  await db.insert(taggingRulesTable).values([
    { id: ids.ruleA1, organizationId: ids.orgA, name: 'Invoices', conditionMatchMode: 'all' },
    { id: ids.ruleB1, organizationId: ids.orgB, name: 'Secrets', conditionMatchMode: 'all' },
  ]);
  await db.insert(taggingRuleConditionsTable).values([
    { taggingRuleId: ids.ruleA1, field: 'name', operator: 'contains', value: 'invoice' },
    { taggingRuleId: ids.ruleB1, field: 'name', operator: 'contains', value: 'secret' },
  ]);
  await db.insert(taggingRuleActionsTable).values([
    { taggingRuleId: ids.ruleA1, tagId: ids.tagA1 },
    { taggingRuleId: ids.ruleB1, tagId: ids.tagB1 },
  ]);
  await db.insert(documentCustomPropertyValuesTable).values({
    documentId: ids.docA1,
    propertyDefinitionId: ids.propText,
    textValue: 'INV-1',
  });

  const { app, ...rest } = createServerFor({ db, config, dependencies });

  // Seeded rows are not indexed: the index is maintained by the events of the usecases
  const seededDocuments = await db.select().from(documentsTable);
  await rest.serverDependencies.documentSearchServices.indexDocuments({
    documents: seededDocuments.map(({ id, name, content, isDeleted, organizationId }) => ({
      id,
      name,
      content,
      isDeleted,
      organizationId,
    })),
  });

  const allPermissions = [...API_KEY_PERMISSIONS_VALUES] as ApiKeyPermissions[];
  const { token: aliceToken } = await insertApiKey({
    db,
    userId: ids.alice,
    permissions: allPermissions,
  });
  const { token: bobToken } = await insertApiKey({
    db,
    userId: ids.bob,
    permissions: allPermissions,
  });

  async function rpc({ token, body }: { token: string; body: unknown }) {
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    return { response, ...(await readRpc(response)) };
  }

  async function callTool({
    name,
    args = {},
    token = aliceToken,
  }: {
    name: string;
    args?: Record<string, unknown>;
    token?: string;
  }) {
    const { result, error } = await rpc({
      token,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });

    const text: string = result?.content?.[0]?.text ?? '';

    return {
      result,
      error,
      isError: result?.isError === true,
      text,
      // The JSON the tool answered, or the public error payload of a failed call
      get data(): any {
        return JSON.parse(text);
      },
    };
  }

  async function listTools({ token = aliceToken }: { token?: string } = {}) {
    const { result } = await rpc({
      token,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });

    return result.tools as {
      name: string;
      description: string;
      inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
      annotations: Record<string, boolean>;
    }[];
  }

  return { app, db, aliceToken, bobToken, rpc, callTool, listTools, ...rest };
}

function createServerFor({
  db,
  config,
  dependencies,
}: {
  db: Database;
  config: Parameters<typeof overrideConfig>[0];
  dependencies: Partial<GlobalDependencies>;
}) {
  const serverDependencies = createTestServerDependencies({
    db,
    config: overrideConfig({ documentsStorage: { driver: 'in-memory' }, ...config }),
    ...dependencies,
  });
  const { app } = createServer(serverDependencies);

  return { app, serverDependencies };
}

// The stateless transport answers with a server-sent event stream carrying one JSON-RPC message
async function readRpc(response: Response) {
  const text = await response.text();
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice('data:'.length);

  return JSON.parse(data ?? 'null') as {
    result?: any;
    error?: { code: number; message: string };
  };
}

// Every row of the tables the tools write to, to assert that a denied call changed nothing
export async function snapshotDatabase({ db }: { db: Database }) {
  const tables = [
    documentsTable,
    tagsTable,
    documentsTagsTable,
    customPropertyDefinitionsTable,
    customPropertySelectOptionsTable,
    documentCustomPropertyValuesTable,
    organizationMembersTable,
    taggingRulesTable,
    taggingRuleConditionsTable,
    taggingRuleActionsTable,
  ];

  const rows = await Promise.all(tables.map(async (table) => db.select().from(table)));

  return JSON.stringify(rows);
}
