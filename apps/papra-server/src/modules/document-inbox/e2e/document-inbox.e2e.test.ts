import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import type { Auth } from '../../app/auth/auth.services';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';
import { documentReviewsTable } from '../document-inbox.table';

const OWNER_ID = 'usr_111111111111111111111111';
const MEMBER_ID = 'usr_333333333333333333333333';
const OUTSIDER_ID = 'usr_444444444444444444444444';
const ORGANIZATION_ID = 'org_222222222222222222222222';
const OTHER_ORGANIZATION_ID = 'org_555555555555555555555555';
const DOC_1 = 'doc_111111111111111111111111';
const DOC_2 = 'doc_222222222222222222222222';
const DOC_3 = 'doc_333333333333333333333333';
const OTHER_ORG_DOC = 'doc_444444444444444444444444';
const TAG_ID = 'tag_111111111111111111111111';

function makeDocument({
  id,
  organizationId = ORGANIZATION_ID,
  createdAt,
}: {
  id: string;
  organizationId?: string;
  createdAt: Date;
}) {
  return {
    id,
    organizationId,
    name: `${id}.txt`,
    mimeType: 'text/plain',
    originalName: `${id}.txt`,
    originalStorageKey: `documents/${id}`,
    originalSha256Hash: `hash-${id}`,
    createdBy: OWNER_ID,
    createdAt,
  };
}

async function createTestApp() {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: OWNER_ID, email: 'owner@example.com' },
      { id: MEMBER_ID, email: 'member@example.com' },
      { id: OUTSIDER_ID, email: 'outsider@example.com' },
    ],
    organizations: [
      { id: ORGANIZATION_ID, name: 'Org 1' },
      { id: OTHER_ORGANIZATION_ID, name: 'Org 2' },
    ],
    organizationMembers: [
      {
        organizationId: ORGANIZATION_ID,
        userId: OWNER_ID,
        role: ORGANIZATION_ROLES.OWNER,
        createdAt: new Date('2025-01-01'),
      },
      {
        organizationId: ORGANIZATION_ID,
        userId: MEMBER_ID,
        role: ORGANIZATION_ROLES.MEMBER,
        createdAt: new Date('2025-01-01'),
      },
      { organizationId: OTHER_ORGANIZATION_ID, userId: OWNER_ID, role: ORGANIZATION_ROLES.OWNER },
    ],
    documents: [
      makeDocument({ id: DOC_1, createdAt: new Date('2025-02-01') }),
      makeDocument({ id: DOC_2, createdAt: new Date('2025-02-02') }),
      makeDocument({ id: DOC_3, createdAt: new Date('2025-02-03') }),
      makeDocument({
        id: OTHER_ORG_DOC,
        organizationId: OTHER_ORGANIZATION_ID,
        createdAt: new Date('2025-02-04'),
      }),
    ],
    tags: [
      {
        id: TAG_ID,
        name: 'Invoices',
        normalizedName: 'invoices',
        color: '#000000',
        organizationId: ORGANIZATION_ID,
      },
    ],
  });

  const { app } = createServer(
    createTestServerDependencies({
      db,
      config: overrideConfig({ env: 'test' }),
      // The tag routes go through the contract router, which resolves the session with the auth instance instead of the test-only `loggedInUserId`
      auth: {
        api: {
          getSession: async ({ headers }: { headers: Headers }) => {
            const userId = headers.get('x-test-user-id');

            return userId === null ? null : { user: { id: userId } };
          },
        },
      } as unknown as Auth,
    }),
  );

  const base = (organizationId = ORGANIZATION_ID) => `/api/organizations/${organizationId}`;
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    db,
    list: async ({ userId = OWNER_ID, organizationId = ORGANIZATION_ID, query = '' } = {}) =>
      app.request(
        `${base(organizationId)}/documents/inbox${query}`,
        {},
        { loggedInUserId: userId },
      ),
    count: async ({ userId = OWNER_ID, organizationId = ORGANIZATION_ID } = {}) =>
      app.request(`${base(organizationId)}/documents/inbox/count`, {}, { loggedInUserId: userId }),
    review: async ({ userId = OWNER_ID, body }: { userId?: string; body: unknown }) =>
      app.request(`${base()}/documents/reviews`, json('POST', body), { loggedInUserId: userId }),
    unreview: async ({ userId = OWNER_ID, documentId }: { userId?: string; documentId: string }) =>
      app.request(`${base()}/documents/${documentId}/review`, json('DELETE'), {
        loggedInUserId: userId,
      }),
    addTag: async ({ userId = OWNER_ID, documentId }: { userId?: string; documentId: string }) =>
      app.request(
        `${base()}/documents/${documentId}/tags`,
        {
          ...json('POST', { tagId: TAG_ID }),
          headers: { 'Content-Type': 'application/json', 'x-test-user-id': userId },
        },
        { loggedInUserId: userId },
      ),
    batchTag: async ({ userId = OWNER_ID, body }: { userId?: string; body: unknown }) =>
      app.request(`${base()}/documents/batch/tags`, json('POST', body), { loggedInUserId: userId }),
    patchSettings: async ({ userId = OWNER_ID, body }: { userId?: string; body: unknown }) =>
      app.request(`${base()}/settings`, json('PATCH', body), { loggedInUserId: userId }),
    getSettings: async ({ userId = OWNER_ID } = {}) =>
      app.request(`${base()}/settings`, {}, { loggedInUserId: userId }),
    getDocument: async ({
      userId = OWNER_ID,
      documentId,
    }: {
      userId?: string;
      documentId: string;
    }) => app.request(`${base()}/documents/${documentId}`, {}, { loggedInUserId: userId }),
  };
}

async function listIds(response: Response) {
  const { documents } = (await response.json()) as { documents: { id: string }[] };

  return documents.map(({ id }) => id);
}

async function getCount(response: Response) {
  return ((await response.json()) as { count: number }).count;
}

describe('document inbox e2e', () => {
  describe('GET /documents/inbox', () => {
    test('lists the unreviewed documents of the organization, newest first, with their count', async () => {
      const { list } = await createTestApp();

      const response = await list();

      expect(response.status).to.eql(200);

      const body = (await response.json()) as {
        documents: { id: string; tags: unknown[] }[];
        documentsCount: number;
      };

      expect(body.documents.map(({ id }) => id)).to.eql([DOC_3, DOC_2, DOC_1]);
      expect(body.documents[0]?.tags).to.eql([]);
      expect(body.documentsCount).to.eql(3);
    });

    test('the static inbox path is not captured by the :documentId routes', async () => {
      const { list, count } = await createTestApp();

      // If `inbox` was captured by `documents/:documentId`, these would be rejected by the document id validation
      expect((await list()).status).to.eql(200);
      expect((await count()).status).to.eql(200);
    });

    test('the page size and index paginate the list', async () => {
      const { list } = await createTestApp();

      const response = await list({ query: '?pageIndex=1&pageSize=2' });
      const body = (await response.json()) as {
        documents: { id: string }[];
        documentsCount: number;
      };

      expect(body.documents.map(({ id }) => id)).to.eql([DOC_1]);
      expect(body.documentsCount).to.eql(3);
    });

    test('non members cannot read the inbox and anonymous requests are rejected', async () => {
      const { list, count } = await createTestApp();

      expect((await list({ userId: OUTSIDER_ID })).status).to.eql(403);
      expect((await count({ userId: OUTSIDER_ID })).status).to.eql(403);
    });
  });

  describe('GET /documents/inbox/count', () => {
    test('returns the number of documents in the inbox of the user', async () => {
      const { count } = await createTestApp();

      const response = await count();

      expect(response.status).to.eql(200);
      expect(await response.json()).to.eql({ count: 3 });
    });
  });

  describe('POST /documents/reviews', () => {
    test('shared mode: a review by one member removes the documents for every member', async () => {
      const { review, list, count } = await createTestApp();

      const response = await review({ body: { documentIds: [DOC_1, DOC_3] } });

      expect(response.status).to.eql(204);
      expect(await listIds(await list({ userId: MEMBER_ID }))).to.eql([DOC_2]);
      expect(await getCount(await count({ userId: MEMBER_ID }))).to.eql(1);
      expect(await getCount(await count({ userId: OWNER_ID }))).to.eql(1);
    });

    test('per_user mode: a review only removes the documents for the reviewer', async () => {
      const { review, list, patchSettings } = await createTestApp();

      expect((await patchSettings({ body: { inbox: { mode: 'per_user' } } })).status).to.eql(204);
      expect((await review({ body: { documentIds: [DOC_1] } })).status).to.eql(204);

      expect(await listIds(await list({ userId: OWNER_ID }))).to.eql([DOC_3, DOC_2]);
      expect(await listIds(await list({ userId: MEMBER_ID }))).to.eql([DOC_3, DOC_2, DOC_1]);
    });

    test('reviewing twice is idempotent', async () => {
      const { review, db } = await createTestApp();

      expect((await review({ body: { documentIds: [DOC_1] } })).status).to.eql(204);
      expect((await review({ body: { documentIds: [DOC_1] } })).status).to.eql(204);
      expect(await db.select().from(documentReviewsTable)).to.have.length(1);
    });

    test('documents of another organization are rejected and nothing is reviewed', async () => {
      const { review, count } = await createTestApp();

      const response = await review({ body: { documentIds: [DOC_1, OTHER_ORG_DOC] } });

      expect(response.status).to.eql(400);
      expect(await getCount(await count())).to.eql(3);
    });

    test('the body is validated', async () => {
      const { review } = await createTestApp();

      expect((await review({ body: { documentIds: [] } })).status).to.eql(400);
      expect((await review({ body: { documentIds: ['not-a-document-id'] } })).status).to.eql(400);
      expect((await review({ body: {} })).status).to.eql(400);
      expect(
        (
          await review({
            body: {
              documentIds: Array.from(
                { length: 101 },
                (_, i) => `doc_${String(i).padStart(24, '0')}`,
              ),
            },
          })
        ).status,
      ).to.eql(400);
    });

    test('non members cannot review documents', async () => {
      const { review } = await createTestApp();

      expect((await review({ userId: OUTSIDER_ID, body: { documentIds: [DOC_1] } })).status).to.eql(
        403,
      );
    });
  });

  describe('DELETE /documents/:documentId/review', () => {
    test('shared mode: moves the document back into everyone inbox', async () => {
      const { review, unreview, list } = await createTestApp();

      await review({ body: { documentIds: [DOC_1] } });
      await review({ userId: MEMBER_ID, body: { documentIds: [DOC_1] } });

      expect((await unreview({ userId: MEMBER_ID, documentId: DOC_1 })).status).to.eql(204);
      expect(await listIds(await list({ userId: OWNER_ID }))).to.eql([DOC_3, DOC_2, DOC_1]);
    });

    test('per_user mode: moves the document back into the inbox of the user only', async () => {
      const { review, unreview, list, patchSettings } = await createTestApp();

      await patchSettings({ body: { inbox: { mode: 'per_user' } } });
      await review({ body: { documentIds: [DOC_1] } });
      await review({ userId: MEMBER_ID, body: { documentIds: [DOC_1] } });

      expect((await unreview({ documentId: DOC_1 })).status).to.eql(204);
      expect(await listIds(await list({ userId: OWNER_ID }))).to.eql([DOC_3, DOC_2, DOC_1]);
      expect(await listIds(await list({ userId: MEMBER_ID }))).to.eql([DOC_3, DOC_2]);
    });

    test('an unknown document returns a 404', async () => {
      const { unreview } = await createTestApp();

      expect((await unreview({ documentId: 'doc_999999999999999999999999' })).status).to.eql(404);
      expect((await unreview({ documentId: OTHER_ORG_DOC })).status).to.eql(404);
    });
  });

  describe('manual tagging', () => {
    test('adding a tag to a document marks it as reviewed', async () => {
      const { addTag, list } = await createTestApp();

      expect((await addTag({ documentId: DOC_2 })).status).to.eql(204);
      expect(await listIds(await list())).to.eql([DOC_3, DOC_1]);
    });

    test('adding tags with the batch route marks the targeted documents as reviewed', async () => {
      const { batchTag, list } = await createTestApp();

      const response = await batchTag({
        body: { filter: { documentIds: [DOC_1, DOC_2] }, addTagIds: [TAG_ID], removeTagIds: [] },
      });

      expect(response.status).to.eql(204);
      expect(await listIds(await list())).to.eql([DOC_3]);
    });

    test('the batch route without added tags does not review the documents', async () => {
      const { batchTag, list } = await createTestApp();

      const response = await batchTag({
        body: { filter: { documentIds: [DOC_1] }, addTagIds: [], removeTagIds: [TAG_ID] },
      });

      expect(response.status).to.eql(204);
      expect(await listIds(await list())).to.eql([DOC_3, DOC_2, DOC_1]);
    });
  });

  describe('inbox mode setting', () => {
    test('defaults to shared and can be changed by the owner only', async () => {
      const { getSettings, patchSettings } = await createTestApp();
      const readMode = async () =>
        (
          (await (await getSettings()).json()) as {
            organizationSettings: { inbox: { mode: string } };
          }
        ).organizationSettings.inbox.mode;

      expect(await readMode()).to.eql('shared');
      expect(
        (await patchSettings({ userId: MEMBER_ID, body: { inbox: { mode: 'per_user' } } })).status,
      ).to.eql(403);
      expect(await readMode()).to.eql('shared');
      expect((await patchSettings({ body: { inbox: { mode: 'per_user' } } })).status).to.eql(204);
      expect(await readMode()).to.eql('per_user');
      expect((await patchSettings({ body: { inbox: { mode: 'nope' } } })).status).to.eql(400);
    });
  });

  test('regular document routes still resolve next to the inbox routes', async () => {
    const { getDocument } = await createTestApp();

    const response = await getDocument({ documentId: DOC_1 });

    expect(response.status).to.eql(200);
    expect(((await response.json()) as { document: { id: string } }).document.id).to.eql(DOC_1);
  });
});
