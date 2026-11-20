import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';

const USER_ID = 'usr_111111111111111111111111';
const OTHER_USER_ID = 'usr_333333333333333333333333';
const OUTSIDER_USER_ID = 'usr_444444444444444444444444';
const ORGANIZATION_ID = 'org_222222222222222222222222';
const OTHER_ORGANIZATION_ID = 'org_555555555555555555555555';

async function createTestApp() {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: USER_ID, email: 'user@example.com' },
      { id: OTHER_USER_ID, email: 'other@example.com' },
      { id: OUTSIDER_USER_ID, email: 'outsider@example.com' },
    ],
    organizations: [
      { id: ORGANIZATION_ID, name: 'Org 1' },
      { id: OTHER_ORGANIZATION_ID, name: 'Org 2' },
    ],
    organizationMembers: [
      { organizationId: ORGANIZATION_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
      { organizationId: ORGANIZATION_ID, userId: OTHER_USER_ID, role: ORGANIZATION_ROLES.MEMBER },
      { organizationId: OTHER_ORGANIZATION_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
    ],
  });

  const { app } = createServer(
    createTestServerDependencies({ db, config: overrideConfig({ env: 'test' }) }),
  );

  const url = (organizationId = ORGANIZATION_ID) =>
    `/api/organizations/${organizationId}/documents/view-preferences`;

  return {
    get: async ({ userId = USER_ID, organizationId = ORGANIZATION_ID } = {}) =>
      app.request(url(organizationId), {}, { loggedInUserId: userId }),
    put: async ({
      userId = USER_ID,
      organizationId = ORGANIZATION_ID,
      body,
    }: {
      userId?: string;
      organizationId?: string;
      body: unknown;
    }) =>
      app.request(
        url(organizationId),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { loggedInUserId: userId },
      ),
    anonymousGet: async () => app.request(url()),
  };
}

describe('documents view preferences e2e', () => {
  test('the defaults are returned when nothing has been saved', async () => {
    const { get } = await createTestApp();

    const response = await get();

    expect(response.status).to.eql(200);
    expect(await response.json()).to.eql({ preferences: { defaultView: 'list', tagViews: {} } });
  });

  test('saved preferences are returned by the save route and by the get route', async () => {
    const { get, put } = await createTestApp();
    const preferences = { defaultView: 'grid', tagViews: { invoices: 'list' } };

    const putResponse = await put({ body: { preferences } });

    expect(putResponse.status).to.eql(200);
    expect(await putResponse.json()).to.eql({ preferences });

    const getResponse = await get();

    expect(getResponse.status).to.eql(200);
    expect(await getResponse.json()).to.eql({ preferences });

    await put({ body: { preferences: { defaultView: 'list', tagViews: {} } } });

    expect(await (await get()).json()).to.eql({
      preferences: { defaultView: 'list', tagViews: {} },
    });
  });

  test('preferences are isolated between users and between organizations', async () => {
    const { get, put } = await createTestApp();

    await put({ body: { preferences: { defaultView: 'grid', tagViews: {} } } });

    expect(await (await get({ userId: OTHER_USER_ID })).json()).to.eql({
      preferences: { defaultView: 'list', tagViews: {} },
    });
    expect(await (await get({ organizationId: OTHER_ORGANIZATION_ID })).json()).to.eql({
      preferences: { defaultView: 'list', tagViews: {} },
    });
    expect(await (await get()).json()).to.eql({
      preferences: { defaultView: 'grid', tagViews: {} },
    });
  });

  test('a user that is not a member of the organization can neither read nor save the preferences', async () => {
    const { get, put } = await createTestApp();

    const getResponse = await get({ userId: OUTSIDER_USER_ID });
    const putResponse = await put({
      userId: OUTSIDER_USER_ID,
      body: { preferences: { defaultView: 'grid', tagViews: {} } },
    });

    expect(getResponse.status).to.eql(403);
    expect(putResponse.status).to.eql(403);
    expect(await (await get()).json()).to.eql({
      preferences: { defaultView: 'list', tagViews: {} },
    });
  });

  test('unauthenticated requests are rejected', async () => {
    const { anonymousGet } = await createTestApp();

    expect((await anonymousGet()).status).to.eql(401);
  });

  test('an invalid body is rejected and nothing is saved', async () => {
    const { get, put } = await createTestApp();

    for (const body of [
      {},
      { preferences: { defaultView: 'masonry', tagViews: {} } },
      { preferences: { defaultView: 'grid', tagViews: { invoices: 'masonry' } } },
      { preferences: { defaultView: 'grid', tagViews: {}, extra: true } },
      { preferences: { defaultView: 'grid' } },
      { preferences: { defaultView: 'grid', tagViews: {} }, extra: true },
      { preferences: { defaultView: 'grid', tagViews: { ['a'.repeat(65)]: 'list' } } },
    ]) {
      const response = await put({ body });

      expect(response.status).to.eql(400);
      expect(
        ((await response.json()) as { error: { code: string } }).error.code,
        JSON.stringify(body),
      ).to.eql('server.invalid_request.body');
    }

    expect(await (await get()).json()).to.eql({
      preferences: { defaultView: 'list', tagViews: {} },
    });
  });

  test('too many tag views are rejected', async () => {
    const { put } = await createTestApp();
    const tagViews = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`tag-${index}`, 'grid']),
    );

    const response = await put({ body: { preferences: { defaultView: 'grid', tagViews } } });

    expect(response.status).to.eql(400);
  });

  test('an invalid organization id is rejected', async () => {
    const { get } = await createTestApp();

    expect((await get({ organizationId: 'nope' })).status).to.eql(400);
  });
});
