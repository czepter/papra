import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { documentsTable } from '../documents/documents.table';
import { usersTable } from '../users/users.table';
import { INBOX_MODES } from './document-inbox.constants';
import { createDocumentInboxRepository } from './document-inbox.repository';
import { documentReviewsTable } from './document-inbox.table';

const ORGANIZATION_ID = 'org_1';

function makeDocument({ id, createdAt }: { id: string; createdAt: Date }) {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    name: `${id}.pdf`,
    originalName: `${id}.pdf`,
    originalStorageKey: `${id}.pdf`,
    originalSha256Hash: `hash-${id}`,
    mimeType: 'application/pdf',
    createdAt,
  };
}

async function createTestDatabase() {
  return createInMemoryDatabase({
    users: [
      { id: 'usr_1', email: 'user-1@example.com' },
      { id: 'usr_2', email: 'user-2@example.com' },
    ],
    organizations: [
      { id: ORGANIZATION_ID, name: 'Organization 1' },
      { id: 'org_2', name: 'Organization 2' },
    ],
    organizationMembers: [
      {
        organizationId: ORGANIZATION_ID,
        userId: 'usr_1',
        role: 'owner',
        createdAt: new Date('2025-01-01'),
      },
      {
        organizationId: ORGANIZATION_ID,
        userId: 'usr_2',
        role: 'member',
        createdAt: new Date('2025-03-01'),
      },
    ],
    documents: [
      makeDocument({ id: 'doc_old', createdAt: new Date('2025-02-01') }),
      makeDocument({ id: 'doc_mid', createdAt: new Date('2025-03-15') }),
      makeDocument({ id: 'doc_new', createdAt: new Date('2025-04-01') }),
    ],
  });
}

async function getInboxIds({
  repository,
  userId,
  mode,
}: {
  repository: ReturnType<typeof createDocumentInboxRepository>;
  userId: string;
  mode: (typeof INBOX_MODES)[keyof typeof INBOX_MODES];
}) {
  const { documents, documentsCount } = await repository.getInboxDocuments({
    organizationId: ORGANIZATION_ID,
    userId,
    mode,
    pageIndex: 0,
    pageSize: 10,
  });

  return { ids: documents.map(({ id }) => id), documentsCount };
}

describe('document inbox repository', () => {
  describe('getInboxDocuments', () => {
    test('shared mode lists unreviewed documents newest first for every member', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      for (const userId of ['usr_1', 'usr_2']) {
        expect(await getInboxIds({ repository, userId, mode: INBOX_MODES.SHARED })).to.eql({
          ids: ['doc_new', 'doc_mid', 'doc_old'],
          documentsCount: 3,
        });
      }
    });

    test('in shared mode a review by any member hides the document for everyone', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await repository.markDocumentsAsReviewed({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_mid'],
        userId: 'usr_1',
      });

      for (const userId of ['usr_1', 'usr_2']) {
        expect((await getInboxIds({ repository, userId, mode: INBOX_MODES.SHARED })).ids).to.eql([
          'doc_new',
          'doc_old',
        ]);
      }
    });

    test('in per_user mode a review only hides the document for the reviewer', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await repository.markDocumentsAsReviewed({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_new'],
        userId: 'usr_2',
      });

      expect(
        (await getInboxIds({ repository, userId: 'usr_2', mode: INBOX_MODES.PER_USER })).ids,
      ).to.eql(['doc_mid']);
      expect(
        (await getInboxIds({ repository, userId: 'usr_1', mode: INBOX_MODES.PER_USER })).ids,
      ).to.eql(['doc_new', 'doc_mid', 'doc_old']);
    });

    test('in per_user mode documents imported before the member joined are not in their inbox', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      // usr_2 joined on 2025-03-01, doc_old was imported on 2025-02-01
      expect(await getInboxIds({ repository, userId: 'usr_2', mode: INBOX_MODES.PER_USER })).to.eql(
        {
          ids: ['doc_new', 'doc_mid'],
          documentsCount: 2,
        },
      );
    });

    test('a user who is not a member of the organization has an empty per_user inbox', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      expect(
        await getInboxIds({ repository, userId: 'usr_unknown', mode: INBOX_MODES.PER_USER }),
      ).to.eql({
        ids: [],
        documentsCount: 0,
      });
    });

    test('a system review (no user) hides the document in both modes', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await db
        .insert(documentReviewsTable)
        .values({ organizationId: ORGANIZATION_ID, documentId: 'doc_new', userId: null });

      for (const mode of [INBOX_MODES.SHARED, INBOX_MODES.PER_USER]) {
        expect((await getInboxIds({ repository, userId: 'usr_2', mode })).ids).to.not.include(
          'doc_new',
        );
      }
    });

    test('deleted documents are excluded from the inbox and the count', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await db
        .update(documentsTable)
        .set({ isDeleted: true })
        .where(eq(documentsTable.id, 'doc_mid'));

      expect(await getInboxIds({ repository, userId: 'usr_1', mode: INBOX_MODES.SHARED })).to.eql({
        ids: ['doc_new', 'doc_old'],
        documentsCount: 2,
      });
    });

    test('documents of other organizations are excluded', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await db
        .update(documentsTable)
        .set({ organizationId: 'org_2' })
        .where(eq(documentsTable.id, 'doc_new'));

      expect(
        (await getInboxIds({ repository, userId: 'usr_1', mode: INBOX_MODES.SHARED })).ids,
      ).to.eql(['doc_mid', 'doc_old']);
    });

    test('pagination returns a page while the count covers the whole inbox', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      const { documents, documentsCount } = await repository.getInboxDocuments({
        organizationId: ORGANIZATION_ID,
        userId: 'usr_1',
        mode: INBOX_MODES.SHARED,
        pageIndex: 1,
        pageSize: 2,
      });

      expect(documents.map(({ id }) => id)).to.eql(['doc_old']);
      expect(documentsCount).to.eql(3);
    });
  });

  describe('getInboxCount', () => {
    test('the count follows the mode and the reviews', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });
      const count = async (userId: string, mode: (typeof INBOX_MODES)[keyof typeof INBOX_MODES]) =>
        (await repository.getInboxCount({ organizationId: ORGANIZATION_ID, userId, mode }))
          .documentsCount;

      expect(await count('usr_2', INBOX_MODES.SHARED)).to.eql(3);
      expect(await count('usr_2', INBOX_MODES.PER_USER)).to.eql(2);

      await repository.markDocumentsAsReviewed({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_new'],
        userId: 'usr_1',
      });

      expect(await count('usr_2', INBOX_MODES.SHARED)).to.eql(2);
      expect(await count('usr_2', INBOX_MODES.PER_USER)).to.eql(2);
    });
  });

  describe('markDocumentsAsReviewed', () => {
    test('reviewing the same document twice keeps a single review', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });
      const args = {
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_new', 'doc_new', 'doc_mid'],
        userId: 'usr_1',
      };

      await repository.markDocumentsAsReviewed(args);
      await repository.markDocumentsAsReviewed(args);

      const reviews = await db.select().from(documentReviewsTable);

      expect(reviews).to.have.length(2);
      expect(reviews.every(({ userId }) => userId === 'usr_1')).to.eql(true);
    });

    test('reviews are deleted with the user or the document', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });

      await repository.markDocumentsAsReviewed({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_new'],
        userId: 'usr_1',
      });
      await repository.markDocumentsAsReviewed({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_mid'],
        userId: 'usr_2',
      });

      await db.delete(usersTable).where(eq(usersTable.id, 'usr_1'));
      expect(await db.select().from(documentReviewsTable)).to.have.length(1);

      await db.delete(documentsTable).where(eq(documentsTable.id, 'doc_mid'));
      expect(await db.select().from(documentReviewsTable)).to.have.length(0);
    });
  });

  describe('moveDocumentsBackToInbox', () => {
    test('in shared mode all member reviews of the document are removed but system reviews are kept', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });
      const base = { organizationId: ORGANIZATION_ID, documentIds: ['doc_new', 'doc_mid'] };

      await repository.markDocumentsAsReviewed({ ...base, userId: 'usr_1' });
      await repository.markDocumentsAsReviewed({ ...base, userId: 'usr_2' });
      await db
        .insert(documentReviewsTable)
        .values({ organizationId: ORGANIZATION_ID, documentId: 'doc_mid', userId: null });

      await repository.moveDocumentsBackToInbox({
        organizationId: ORGANIZATION_ID,
        documentIds: ['doc_new', 'doc_mid'],
        userId: 'usr_1',
        mode: INBOX_MODES.SHARED,
      });

      const reviews = await db.select().from(documentReviewsTable);

      expect(reviews.map(({ documentId, userId }) => ({ documentId, userId }))).to.eql([
        { documentId: 'doc_mid', userId: null },
      ]);
      expect(
        (await getInboxIds({ repository, userId: 'usr_1', mode: INBOX_MODES.SHARED })).ids,
      ).to.eql(['doc_new', 'doc_old']);
    });

    test('in per_user mode only the review of the user is removed', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentInboxRepository({ db });
      const base = { organizationId: ORGANIZATION_ID, documentIds: ['doc_new'] };

      await repository.markDocumentsAsReviewed({ ...base, userId: 'usr_1' });
      await repository.markDocumentsAsReviewed({ ...base, userId: 'usr_2' });

      await repository.moveDocumentsBackToInbox({
        ...base,
        userId: 'usr_1',
        mode: INBOX_MODES.PER_USER,
      });

      expect(
        (await getInboxIds({ repository, userId: 'usr_1', mode: INBOX_MODES.PER_USER })).ids,
      ).to.include('doc_new');
      expect(
        (await getInboxIds({ repository, userId: 'usr_2', mode: INBOX_MODES.PER_USER })).ids,
      ).to.not.include('doc_new');
    });
  });
});
