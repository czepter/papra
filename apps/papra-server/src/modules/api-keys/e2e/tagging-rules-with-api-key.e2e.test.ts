import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';
import {
  taggingRuleActionsTable,
  taggingRulesTable,
} from '../../tagging-rules/tagging-rules.tables';

const USER_ID = 'usr_111111111111111111111111';
const ORG_ID = 'org_222222222222222222222222';
const TAG_ID = 'tag_333333333333333333333333';
const OTHER_ORG_ID = 'org_555555555555555555555555';
const OTHER_TAG_ID = 'tag_666666666666666666666666';
const OTHER_RULE_ID = 'tr_777777777777777777777777';

async function setup() {
  const { db } = await createInMemoryDatabase({
    users: [{ id: USER_ID, email: 'user@example.com' }],
    organizations: [
      { id: ORG_ID, name: 'Org 1' },
      { id: OTHER_ORG_ID, name: 'Org 2' },
    ],
    organizationMembers: [
      { organizationId: ORG_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
    ],
    tags: [
      { id: TAG_ID, organizationId: ORG_ID, name: 'Tag', normalizedName: 'tag', color: '#000000' },
      {
        id: OTHER_TAG_ID,
        organizationId: OTHER_ORG_ID,
        name: 'Other',
        normalizedName: 'other',
        color: '#000000',
      },
    ],
    taggingRules: [{ id: OTHER_RULE_ID, organizationId: OTHER_ORG_ID, name: 'Other rule' }],
  });

  const { app } = createServer(
    createTestServerDependencies({ db, config: overrideConfig({ env: 'test' }) }),
  );

  async function createApiKey(permissions: string[]) {
    const response = await app.request(
      '/api/api-keys',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test API Key', permissions }),
      },
      { loggedInUserId: USER_ID },
    );

    return ((await response.json()) as { token: string }).token;
  }

  const request = async (path: string, init: RequestInit & { token: string }) =>
    app.request(`/api/organizations/${ORG_ID}/tagging-rules${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${init.token}`,
      },
    });

  return { createApiKey, request, db };
}

const body = JSON.stringify({ name: 'Rule', conditions: [], tagIds: [TAG_ID] });

describe('tagging rules api-key e2e', () => {
  test('an api key with the matching permission can create, list and delete tagging rules', async () => {
    const { createApiKey, request } = await setup();
    const token = await createApiKey([
      'tagging-rules:create',
      'tagging-rules:read',
      'tagging-rules:delete',
    ]);

    expect((await request('', { method: 'POST', body, token })).status).toBe(204);

    const listResponse = await request('', { method: 'GET', token });
    expect(listResponse.status).toBe(200);
    const { taggingRules } = (await listResponse.json()) as { taggingRules: { id: string }[] };
    expect(taggingRules).toHaveLength(1);

    expect((await request(`/${taggingRules[0]!.id}`, { method: 'DELETE', token })).status).toBe(
      204,
    );
  });

  test('an api key without the permission is refused', async () => {
    const { createApiKey, request } = await setup();
    const token = await createApiKey(['tags:read', 'tagging-rules:read']);

    expect((await request('', { method: 'POST', body, token })).status).toBe(401);
    expect(
      (await request('/tr_444444444444444444444444', { method: 'PUT', body, token })).status,
    ).toBe(401);
    expect(
      (await request('/tr_444444444444444444444444', { method: 'DELETE', token })).status,
    ).toBe(401);
  });

  test('applying a rule needs the document update permission as well', async () => {
    const { createApiKey, request } = await setup();
    const token = await createApiKey(['tagging-rules:read']);

    expect(
      (await request('/tr_444444444444444444444444/apply', { method: 'POST', token })).status,
    ).toBe(401);
  });

  describe('tag ownership and organization scoping', () => {
    const allPermissions = [
      'tagging-rules:create',
      'tagging-rules:read',
      'tagging-rules:update',
      'tagging-rules:delete',
    ];

    test('a rule can be replaced with a PUT and duplicate tag ids are stored once', async () => {
      const { createApiKey, request, db } = await setup();
      const token = await createApiKey(allPermissions);

      await request('', { method: 'POST', body, token });
      const { taggingRules } = (await (await request('', { method: 'GET', token })).json()) as {
        taggingRules: { id: string }[];
      };
      const [{ id }] = taggingRules as [{ id: string }];

      const putBody = JSON.stringify({
        name: 'Renamed',
        conditions: [{ field: 'name', operator: 'contains', value: 'x' }],
        tagIds: [TAG_ID, TAG_ID],
      });
      expect((await request(`/${id}`, { method: 'PUT', body: putBody, token })).status).toBe(204);

      const { taggingRule } = (await (
        await request(`/${id}`, { method: 'GET', token })
      ).json()) as {
        taggingRule: { name: string; conditions: unknown[]; actions: unknown[] };
      };
      expect(taggingRule.name).toBe('Renamed');
      expect(taggingRule.conditions).toHaveLength(1);
      expect(taggingRule.actions).toHaveLength(1);
      expect(await db.select().from(taggingRuleActionsTable)).toHaveLength(1);
    });

    test('a tag of another organization is refused with 404 on create and update, nothing is written', async () => {
      const { createApiKey, request, db } = await setup();
      const token = await createApiKey(allPermissions);
      const foreignBody = JSON.stringify({ name: 'Rule', conditions: [], tagIds: [OTHER_TAG_ID] });

      expect((await request('', { method: 'POST', body: foreignBody, token })).status).toBe(404);
      expect(await db.select().from(taggingRulesTable)).toHaveLength(1); // only the seeded rule of the other org

      await request('', { method: 'POST', body, token });
      const { taggingRules } = (await (await request('', { method: 'GET', token })).json()) as {
        taggingRules: { id: string }[];
      };
      const [{ id }] = taggingRules as [{ id: string }];

      expect((await request(`/${id}`, { method: 'PUT', body: foreignBody, token })).status).toBe(
        404,
      );
      const actions = await db
        .select()
        .from(taggingRuleActionsTable)
        .where(eq(taggingRuleActionsTable.taggingRuleId, id));
      expect(actions.map(({ tagId }) => tagId)).toEqual([TAG_ID]);
    });

    test('a rule of another organization is not found on get, update and apply, and delete leaves it alone', async () => {
      const { createApiKey, request, db } = await setup();
      const token = await createApiKey([...allPermissions, 'documents:update']);

      expect((await request(`/${OTHER_RULE_ID}`, { method: 'GET', token })).status).toBe(404);
      expect((await request(`/${OTHER_RULE_ID}`, { method: 'PUT', body, token })).status).toBe(404);
      expect((await request(`/${OTHER_RULE_ID}/apply`, { method: 'POST', token })).status).toBe(
        404,
      );

      await request(`/${OTHER_RULE_ID}`, { method: 'DELETE', token });
      expect(await db.select().from(taggingRulesTable)).toHaveLength(1);
    });
  });
});
