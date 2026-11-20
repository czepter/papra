import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';

const USER_ID = 'usr_111111111111111111111111';
const ORG_ID = 'org_222222222222222222222222';
const TAG_ID = 'tag_333333333333333333333333';

async function setup() {
  const { db } = await createInMemoryDatabase({
    users: [{ id: USER_ID, email: 'user@example.com' }],
    organizations: [{ id: ORG_ID, name: 'Org 1' }],
    organizationMembers: [
      { organizationId: ORG_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
    ],
    tags: [
      { id: TAG_ID, organizationId: ORG_ID, name: 'Tag', normalizedName: 'tag', color: '#000000' },
    ],
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

  return { createApiKey, request };
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
});
