import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase, seedDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';

const ORG_ID = 'org_222222222222222222222222';
const OTHER_ORG_ID = 'org_333333333333333333333333';
const TAG_A = 'tag_aaaaaaaaaaaaaaaaaaaaaaaa';
const TAG_B = 'tag_bbbbbbbbbbbbbbbbbbbbbbbb';
const TAG_C = 'tag_cccccccccccccccccccccccc';
const OTHER_ORG_TAG = 'tag_dddddddddddddddddddddddd';

async function setupApp() {
  const { db } = await createInMemoryDatabase({
    organizations: [
      { id: ORG_ID, name: 'Org 1' },
      { id: OTHER_ORG_ID, name: 'Org 2' },
    ],
    tags: [
      { id: TAG_A, organizationId: ORG_ID, name: 'A', color: '#111111' },
      { id: TAG_B, organizationId: ORG_ID, name: 'B', color: '#222222' },
      { id: TAG_C, organizationId: ORG_ID, name: 'C', color: '#333333' },
      { id: OTHER_ORG_TAG, organizationId: OTHER_ORG_ID, name: 'Other', color: '#444444' },
    ],
  });

  const dependencies = createTestServerDependencies({
    db,
    config: overrideConfig({ auth: { firstUserAsAdmin: false } }),
  });
  const { app } = createServer(dependencies);

  // Contract routes resolve the real session, so sign up a user and reuse its cookie
  const {
    headers: responseHeaders,
    response: { user },
  } = await dependencies.auth.api.signUpEmail({
    body: { email: 'alice@example.com', password: 'StrongPassword123!', name: 'Alice' },
    returnHeaders: true,
  });
  const cookie = responseHeaders
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  await seedDatabase({
    db,
    organizationMembers: [
      { organizationId: ORG_ID, userId: user.id, role: ORGANIZATION_ROLES.OWNER },
    ],
  });

  const request = async (path: string, method: string, body?: unknown) =>
    app.request(`/api/organizations/${ORG_ID}/tags/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const getPinnedIds = async () => {
    const response = await request('pinned', 'GET');
    const { pinnedTags } = (await response.json()) as { pinnedTags: { id: string }[] };
    return pinnedTags.map(({ id }) => id);
  };

  return { request, getPinnedIds };
}

describe('pinned tags e2e', () => {
  test('pinning is idempotent and pinned tags are listed in order', async () => {
    const { request, getPinnedIds } = await setupApp();

    expect((await request(`${TAG_B}/pin`, 'POST')).status).to.eql(204);
    expect((await request(`${TAG_A}/pin`, 'POST')).status).to.eql(204);
    expect((await request(`${TAG_B}/pin`, 'POST')).status).to.eql(204);

    expect(await getPinnedIds()).to.eql([TAG_B, TAG_A]);

    expect((await request(`${TAG_B}/pin`, 'DELETE')).status).to.eql(204);
    expect(await getPinnedIds()).to.eql([TAG_A]);
  });

  test('pinning a tag from another organization returns 404 and pins nothing', async () => {
    const { request, getPinnedIds } = await setupApp();

    const response = await request(`${OTHER_ORG_TAG}/pin`, 'POST');

    expect(response.status).to.eql(404);
    expect(await response.json()).to.eql({
      error: { code: 'tags.not_found', message: 'Tag not found' },
    });
    expect(await getPinnedIds()).to.eql([]);
  });

  test('pinned tags can be reordered', async () => {
    const { request, getPinnedIds } = await setupApp();

    for (const tagId of [TAG_A, TAG_B, TAG_C]) {
      await request(`${tagId}/pin`, 'POST');
    }

    const response = await request('pinned/order', 'PUT', { tagIds: [TAG_C, TAG_A, TAG_B] });

    expect(response.status).to.eql(204);
    expect(await getPinnedIds()).to.eql([TAG_C, TAG_A, TAG_B]);
  });

  test('reordering ignores tags that are not pinned and rejects invalid ids', async () => {
    const { request, getPinnedIds } = await setupApp();

    await request(`${TAG_A}/pin`, 'POST');
    await request(`${TAG_B}/pin`, 'POST');

    const response = await request('pinned/order', 'PUT', { tagIds: [OTHER_ORG_TAG, TAG_B] });

    expect(response.status).to.eql(204);
    expect(await getPinnedIds()).to.eql([TAG_B, TAG_A]);

    expect((await request('pinned/order', 'PUT', { tagIds: ['nope'] })).status).to.eql(400);
  });
});
