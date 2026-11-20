import type { ApiKeyPermissions } from '../api-keys/api-keys.types';
import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';
import { organizationMembersTable } from '../organizations/organizations.table';
import { createError } from '../shared/errors/errors';
import { MCP_REQUEST_BODY_MAX_SIZE } from './mcp.constants';
import { executeMcpTool } from './mcp.tools';
import { mcpTools } from './mcp.tools.catalogue';
import { defineMcpTool } from './mcp.tools.types';
import { ids, insertApiKey, setupMcpTest, snapshotDatabase, testId } from './mcp.test-utils';

// Pinned on purpose: a change to a permission list has to show up in review.
// Verified against the apiKeyPermissions of the REST routes, not derived from the catalogue.
const EXPECTED_PERMISSIONS: Record<string, ApiKeyPermissions[]> = {
  ping: [],
  list_organizations: ['organizations:read'],
  search_documents: ['documents:read'],
  get_document: ['documents:read'],
  read_document_content: ['documents:read'],
  update_document: ['documents:update'],
  upload_document: ['documents:create'],
  list_tags: ['tags:read'],
  create_tag: ['tags:create'],
  update_tag: ['tags:update'],
  delete_tag: ['tags:delete'],
  add_document_tag: ['documents:update', 'tags:read'],
  remove_document_tag: ['documents:update', 'tags:read'],
  list_custom_properties: ['custom-properties:read'],
  get_custom_property: ['custom-properties:read'],
  create_custom_property: ['custom-properties:create'],
  update_custom_property: ['custom-properties:update'],
  delete_custom_property: ['custom-properties:delete'],
  get_document_custom_properties: ['documents:read', 'custom-properties:read'],
  set_document_custom_property: ['documents:update', 'custom-properties:read'],
  delete_document_custom_property: ['documents:update', 'custom-properties:read'],
  enrich_document: ['documents:update'],
  reprocess_document: ['documents:update'],
  list_tagging_rules: ['tagging-rules:read'],
  get_tagging_rule: ['tagging-rules:read'],
  create_tagging_rule: ['tagging-rules:create'],
  update_tagging_rule: ['tagging-rules:update'],
  delete_tagging_rule: ['tagging-rules:delete'],
  apply_tagging_rule: ['tagging-rules:read', 'documents:update'],
};

// Arguments that pass the validation of each tool, for the organization given
const validArgs: Record<string, (organizationId: string) => Record<string, unknown>> = {
  ping: () => ({}),
  list_organizations: () => ({}),
  search_documents: (organizationId) => ({ organizationId }),
  get_document: (organizationId) => ({ organizationId, documentId: ids.docA1 }),
  read_document_content: (organizationId) => ({ organizationId, documentId: ids.docA1 }),
  update_document: (organizationId) => ({ organizationId, documentId: ids.docA1, name: 'Renamed' }),
  upload_document: (organizationId) => ({
    organizationId,
    fileName: 'note.txt',
    mimeType: 'text/plain',
    contentBase64: btoa('hello'),
  }),
  list_tags: (organizationId) => ({ organizationId }),
  create_tag: (organizationId) => ({ organizationId, name: 'New tag', color: '#112233' }),
  update_tag: (organizationId) => ({ organizationId, tagId: ids.tagA1, name: 'Renamed tag' }),
  delete_tag: (organizationId) => ({ organizationId, tagId: ids.tagA1 }),
  add_document_tag: (organizationId) => ({
    organizationId,
    documentId: ids.docA2,
    tagId: ids.tagA1,
  }),
  remove_document_tag: (organizationId) => ({
    organizationId,
    documentId: ids.docA1,
    tagId: ids.tagA1,
  }),
  list_custom_properties: (organizationId) => ({ organizationId }),
  get_custom_property: (organizationId) => ({ organizationId, propertyDefinitionId: ids.propText }),
  create_custom_property: (organizationId) => ({
    organizationId,
    definition: { type: 'text', name: 'Another property' },
  }),
  update_custom_property: (organizationId) => ({
    organizationId,
    propertyDefinitionId: ids.propText,
    changes: { name: 'Renamed property' },
  }),
  delete_custom_property: (organizationId) => ({
    organizationId,
    propertyDefinitionId: ids.propText,
  }),
  get_document_custom_properties: (organizationId) => ({ organizationId, documentId: ids.docA1 }),
  set_document_custom_property: (organizationId) => ({
    organizationId,
    documentId: ids.docA1,
    propertyDefinitionId: ids.propText,
    value: 'INV-2',
  }),
  delete_document_custom_property: (organizationId) => ({
    organizationId,
    documentId: ids.docA1,
    propertyDefinitionId: ids.propText,
  }),
  enrich_document: (organizationId) => ({
    organizationId,
    documentId: ids.docA1,
    capabilities: ['auto-tagging'],
  }),
  reprocess_document: (organizationId) => ({ organizationId, documentId: ids.docA1 }),
  list_tagging_rules: (organizationId) => ({ organizationId }),
  get_tagging_rule: (organizationId) => ({ organizationId, taggingRuleId: ids.ruleA1 }),
  create_tagging_rule: (organizationId) => ({
    organizationId,
    name: 'New rule',
    conditions: [],
    tagIds: [ids.tagA1],
  }),
  update_tagging_rule: (organizationId) => ({
    organizationId,
    taggingRuleId: ids.ruleA1,
    name: 'Renamed rule',
    conditions: [],
    tagIds: [ids.tagA1],
  }),
  delete_tagging_rule: (organizationId) => ({ organizationId, taggingRuleId: ids.ruleA1 }),
  apply_tagging_rule: (organizationId) => ({ organizationId, taggingRuleId: ids.ruleA1 }),
};

const organizationScopedTools = Object.keys(EXPECTED_PERMISSIONS).filter(
  (name) => name !== 'ping' && name !== 'list_organizations',
);

// Keys of a valibot object schema, possibly wrapped in a pipe, split by whether the caller must send them
function describeEntries(schema: v.GenericSchema) {
  const objectSchema = ('pipe' in schema
    ? (schema.pipe as v.GenericSchema[])[0]
    : schema) as unknown as {
    entries: Record<string, v.GenericSchema>;
  };

  const keys = Object.keys(objectSchema.entries);
  const required = keys.filter(
    (key) => !['optional', 'exact_optional', 'nullish'].includes(objectSchema.entries[key]!.type),
  );

  return { keys, required };
}

describe('mcp tools catalogue', () => {
  describe('catalogue', () => {
    test('tools/list lists exactly the 29 tools of the catalogue', async () => {
      const { listTools } = await setupMcpTest();

      const names = (await listTools()).map(({ name }) => name).sort();

      expect(names).to.eql(Object.keys(EXPECTED_PERMISSIONS).sort());
      expect(names).to.have.length(29);
    });

    test('every tool requires exactly the permissions of its REST route', () => {
      const actual = Object.fromEntries(
        mcpTools.map(({ name, permissions }) => [name, permissions]),
      );

      expect(actual).to.eql(EXPECTED_PERMISSIONS);
    });

    test('tool names are unique and every permission is a real api key permission', () => {
      expect(new Set(mcpTools.map(({ name }) => name)).size).to.eql(mcpTools.length);

      for (const { permissions } of mcpTools) {
        for (const permission of permissions) {
          expect(API_KEY_PERMISSIONS_VALUES).to.include(permission);
        }
      }
    });

    test('annotations follow the plan: read-only, destructive and idempotent hints', async () => {
      const { listTools } = await setupMcpTest();
      const tools = Object.fromEntries(
        (await listTools()).map((tool) => [tool.name, tool.annotations]),
      );

      for (const name of [
        'ping',
        'list_organizations',
        'search_documents',
        'get_document',
        'read_document_content',
        'list_tags',
        'list_custom_properties',
        'get_custom_property',
        'get_document_custom_properties',
        'list_tagging_rules',
        'get_tagging_rule',
      ]) {
        expect(tools[name]!.readOnlyHint, name).to.eql(true);
      }

      for (const name of [
        'delete_tag',
        'delete_custom_property',
        'remove_document_tag',
        'delete_document_custom_property',
        'delete_tagging_rule',
      ]) {
        expect(tools[name], name).to.include({ readOnlyHint: false, destructiveHint: true });
      }

      for (const name of [
        'update_document',
        'update_tag',
        'update_custom_property',
        'set_document_custom_property',
        'update_tagging_rule',
      ]) {
        expect(tools[name], name).to.include({ readOnlyHint: false, idempotentHint: true });
      }

      for (const name of [
        'upload_document',
        'create_tag',
        'create_custom_property',
        'add_document_tag',
        'enrich_document',
        'reprocess_document',
        'create_tagging_rule',
        'apply_tagging_rule',
      ]) {
        expect(tools[name], name).to.include({ readOnlyHint: false, destructiveHint: false });
      }
    });

    test('no tool takes a user id as argument, identity comes from the api key', async () => {
      const { listTools } = await setupMcpTest();

      for (const { name, inputSchema } of await listTools()) {
        expect(Object.keys(inputSchema.properties ?? {}), name).not.to.include.members(['userId']);
      }
    });
  });

  describe('input schema derivation', () => {
    test('every tool publishes an object schema whose properties and required keys match the valibot schema', async () => {
      const { listTools } = await setupMcpTest();
      const published = Object.fromEntries(
        (await listTools()).map((tool) => [tool.name, tool.inputSchema]),
      );

      for (const tool of mcpTools) {
        const inputSchema = published[tool.name]!;
        const { keys, required } = describeEntries(tool.input);

        expect(inputSchema.type, tool.name).to.eql('object');
        expect(Object.keys(inputSchema.properties ?? {}).sort(), tool.name).to.eql(
          [...keys].sort(),
        );
        expect([...(inputSchema.required ?? [])].sort(), tool.name).to.eql([...required].sort());
      }
    });

    test('the valid arguments of every tool pass the valibot schema, and a user id is never an identity', () => {
      for (const tool of mcpTools) {
        const args = validArgs[tool.name]!(ids.orgA);

        expect(v.safeParse(tool.input, args).success, tool.name).to.eql(true);
      }
    });
  });

  describe('permission check', () => {
    test('a key lacking any one of the permissions of a tool gets an error naming it and nothing changes', async () => {
      const { db, callTool } = await setupMcpTest();

      for (const [name, permissions] of Object.entries(EXPECTED_PERMISSIONS)) {
        for (const missing of permissions) {
          const { token } = await insertApiKey({
            db,
            userId: ids.alice,
            permissions: API_KEY_PERMISSIONS_VALUES.filter((permission) => permission !== missing),
          });
          const before = await snapshotDatabase({ db });

          const { isError, text } = await callTool({
            name,
            args: validArgs[name]!(ids.orgA),
            token,
          });

          expect(isError, `${name} without ${missing}`).to.eql(true);
          expect(text, `${name} without ${missing}`).to.include(missing);
          expect(await snapshotDatabase({ db }), `${name} without ${missing}`).to.eql(before);
        }
      }
    });

    test('a key with no permission at all can only call ping', async () => {
      const { db, callTool } = await setupMcpTest();
      const { token } = await insertApiKey({ db, userId: ids.alice, permissions: [] });

      for (const name of Object.keys(EXPECTED_PERMISSIONS)) {
        const { isError } = await callTool({ name, args: validArgs[name]!(ids.orgA), token });

        expect(isError, name).to.eql(name !== 'ping');
      }
    });

    test('the permission is checked before the organization membership', async () => {
      const { db, callTool } = await setupMcpTest();
      const { token } = await insertApiKey({ db, userId: ids.alice, permissions: [] });

      // Alice is not in organization B, but the missing permission is reported first: no database read happened
      const { text } = await callTool({
        name: 'list_tags',
        args: { organizationId: ids.orgB },
        token,
      });

      expect(text).to.include('tags:read');
      expect(text).not.to.include('user.not_in_organization');
    });
  });

  describe('organization membership', () => {
    test('every organization scoped tool refuses an organization the user is not a member of', async () => {
      const { db, callTool } = await setupMcpTest();

      for (const name of organizationScopedTools) {
        const before = await snapshotDatabase({ db });

        const { isError, data } = await callTool({ name, args: validArgs[name]!(ids.orgB) });

        expect(isError, name).to.eql(true);
        expect(data, name).to.eql({
          error: {
            message: 'You are not part of this organization.',
            code: 'user.not_in_organization',
          },
        });
        expect(await snapshotDatabase({ db }), name).to.eql(before);
      }
    });

    test('the membership is checked on every call: removing a member takes effect at once', async () => {
      const { db, callTool } = await setupMcpTest();
      const args = { organizationId: ids.orgA };

      expect((await callTool({ name: 'list_tags', args })).isError).to.eql(false);

      await db.delete(organizationMembersTable);

      const { isError, data } = await callTool({ name: 'list_tags', args });
      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('user.not_in_organization');
    });

    test('concurrent calls of two users to an organization scoped tool never mix their data', async () => {
      const { callTool, aliceToken, bobToken } = await setupMcpTest();

      const calls = Array.from({ length: 10 }, async (_, index) => {
        const isAlice = index % 2 === 0;
        const { data } = await callTool({
          name: 'list_tags',
          args: { organizationId: isAlice ? ids.orgA : ids.orgB },
          token: isAlice ? aliceToken : bobToken,
        });

        return { isAlice, names: data.tags.map(({ name }: { name: string }) => name).sort() };
      });

      for (const { isAlice, names } of await Promise.all(calls)) {
        expect(names).to.eql(isAlice ? ['Finance', 'Travel'] : ['Secret']);
      }
    });

    test('a user id passed as argument never gives access: bob stays outside the organization of alice', async () => {
      const { callTool, bobToken } = await setupMcpTest();

      const withUserId = await callTool({
        name: 'list_tags',
        args: { organizationId: ids.orgA, userId: ids.alice },
        token: bobToken,
      });
      const withoutUserId = await callTool({
        name: 'list_tags',
        args: { organizationId: ids.orgA },
        token: bobToken,
      });

      for (const { isError, text } of [withUserId, withoutUserId]) {
        expect(isError).to.eql(true);
        expect(text).not.to.include('Finance');
      }
      expect(withoutUserId.data.error.code).to.eql('user.not_in_organization');
    });
  });

  describe('input validation', () => {
    test('an unknown key is refused by every organization scoped tool, with the issue path and without side effect', async () => {
      const { db, callTool } = await setupMcpTest();

      for (const name of organizationScopedTools) {
        const before = await snapshotDatabase({ db });

        const { isError, text } = await callTool({
          name,
          args: { ...validArgs[name]!(ids.orgA), unexpectedKey: true },
        });

        expect(isError, name).to.eql(true);
        expect(text, name).to.match(/^Invalid arguments\./);
        expect(text, name).to.include('unexpectedKey');
        expect(text, name).not.to.match(/\n\s+at /);
        expect(await snapshotDatabase({ db }), name).to.eql(before);
      }
    });

    test('a missing organizationId and a wrongly typed one are refused with the path', async () => {
      const { callTool } = await setupMcpTest();

      for (const name of organizationScopedTools) {
        const { organizationId: _removed, ...withoutOrganization } = validArgs[name]!(ids.orgA);

        const missing = await callTool({ name, args: withoutOrganization });
        const wrongType = await callTool({
          name,
          args: { ...withoutOrganization, organizationId: 123 },
        });

        for (const { isError, text } of [missing, wrongType]) {
          expect(isError, name).to.eql(true);
          expect(text, name).to.include('organizationId');
        }
      }
    });

    test('the arguments of a malformed call do not echo long values back', async () => {
      const { callTool } = await setupMcpTest();
      const secret = `secret-${'x'.repeat(5000)}`;

      const { text } = await callTool({
        name: 'update_document',
        args: {
          organizationId: ids.orgA,
          documentId: ids.docA1,
          name: 123,
          content: secret,
          extra: secret,
        },
      });

      expect(text).not.to.include(secret);
      expect(text.length).to.be.lessThan(1000);
    });
  });

  describe('protocol and errors', () => {
    test('an unknown tool is a protocol error, not a tool error', async () => {
      const { rpc, aliceToken } = await setupMcpTest();

      const { result, error } = await rpc({
        token: aliceToken,
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'delete_document', arguments: {} },
        },
      });

      expect(result).to.eql(undefined);
      expect(error?.message).to.include('Unknown tool');
    });

    test('a handler throwing a plain error gives the generic message and nothing of the error', async () => {
      const tool = defineMcpTool({
        name: 'explode',
        description: 'throws',
        input: v.object({}),
        permissions: [],
        annotations: {},
        handler: async () => {
          throw new Error('db secret detail');
        },
      });

      const result = await executeMcpTool({
        tool,
        args: {},
        authInfo: { token: '', clientId: 'test', scopes: [], extra: { userId: ids.alice } },
        deps: {} as never,
      });

      expect(result.isError).to.eql(true);
      expect(result.content).to.eql([{ type: 'text', text: 'An error occurred' }]);
      expect(JSON.stringify(result)).not.to.include('db secret detail');
    });

    test('an internal custom error is treated like an unknown error', async () => {
      const tool = defineMcpTool({
        name: 'explode',
        description: 'throws',
        input: v.object({}),
        permissions: [],
        annotations: {},
        handler: async () => {
          throw createError({
            message: 'internal detail',
            code: 'x.internal',
            statusCode: 500,
            isInternal: true,
          });
        },
      });

      const result = await executeMcpTool({
        tool,
        args: {},
        authInfo: { token: '', clientId: 'test', scopes: [], extra: { userId: ids.alice } },
        deps: {} as never,
      });

      expect(result.isError).to.eql(true);
      expect(JSON.stringify(result)).not.to.include('internal detail');
      expect(JSON.stringify(result)).not.to.include('x.internal');
    });

    test('a public custom error is returned as its public payload', async () => {
      const tool = defineMcpTool({
        name: 'public',
        description: 'throws',
        input: v.object({}),
        permissions: [],
        annotations: {},
        handler: async () => {
          throw createError({ message: 'Nope.', code: 'x.nope', statusCode: 400 });
        },
      });

      const result = await executeMcpTool({
        tool,
        args: {},
        authInfo: { token: '', clientId: 'test', scopes: [], extra: { userId: ids.alice } },
        deps: {} as never,
      });

      expect(result.isError).to.eql(true);
      expect(JSON.parse((result.content[0] as { text: string }).text)).to.eql({
        error: { message: 'Nope.', code: 'x.nope' },
      });
    });

    test('a call without a user id in the auth info is unauthorized', async () => {
      const result = await executeMcpTool({
        tool: mcpTools.find(({ name }) => name === 'ping')!,
        args: {},
        authInfo: { token: '', clientId: 'test', scopes: [] },
        deps: {} as never,
      });

      expect(result.isError).to.eql(true);
      expect(result.content).to.eql([{ type: 'text', text: 'Unauthorized' }]);
    });

    test('tool results are a single text item holding JSON', async () => {
      const { callTool } = await setupMcpTest();

      const { result } = await callTool({ name: 'list_tags', args: { organizationId: ids.orgA } });

      expect(result.content).to.have.length(1);
      expect(result.content[0].type).to.eql('text');
      expect(() => JSON.parse(result.content[0].text)).not.to.throw();
      expect(result).not.to.have.property('structuredContent');
    });
  });

  describe('request body limit', () => {
    test('a body over the limit gets a 413 with a public error payload', async () => {
      const { app, aliceToken } = await setupMcpTest();

      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          'authorization': `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ padding: 'a'.repeat(MCP_REQUEST_BODY_MAX_SIZE + 1) }),
      });

      expect(response.status).to.eql(413);
      expect(await response.json()).to.eql({
        error: { message: 'The request body is too large.', code: 'mcp.request_body_too_large' },
      });
    });

    test('the limit applies after the authentication: an anonymous oversized request gets a 401', async () => {
      const { app } = await setupMcpTest();

      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ padding: 'a'.repeat(MCP_REQUEST_BODY_MAX_SIZE + 1) }),
      });

      expect(response.status).to.eql(401);
    });
  });

  test('fixture sanity: ids match the id formats of the schemas', () => {
    expect(testId('org', 'orga')).to.match(/^org_[a-z0-9]{24}$/);
    expect(ids.docA1).to.match(/^doc_[a-z0-9]{24}$/);
  });
});
