import { createNoopLogger } from '@crowlog/logger';
import { describe, expect, test } from 'vitest';
import { setupDatabase } from '../../modules/app/database/database';
import { seedDatabase } from '../../modules/app/database/database.test-utils';
import { documentReviewsTable } from '../../modules/document-inbox/document-inbox.table';
import { organizationSettingsTable } from '../../modules/organizations/organization-settings/organization-settings.tables';
import { migrations } from '../migrations.registry';
import { runMigrations } from '../migrations.usecases';
import { documentInboxMigration } from './0031-document-inbox.migration';

describe('document inbox migration', () => {
  test('every existing document gets a system review so the inbox starts empty, and replaying the migration does not duplicate them', async () => {
    const { db } = setupDatabase({ url: ':memory:' });
    await runMigrations({
      db,
      migrations: migrations.slice(0, migrations.indexOf(documentInboxMigration)),
      logger: createNoopLogger(),
    });

    const document = {
      mimeType: 'application/pdf',
      originalSha256Hash: 'hash',
    };

    await seedDatabase({
      db,
      organizations: [
        { id: 'org_1', name: 'Organization 1' },
        { id: 'org_2', name: 'Organization 2' },
      ],
      documents: [
        {
          ...document,
          id: 'doc_1',
          organizationId: 'org_1',
          name: 'a.pdf',
          originalName: 'a.pdf',
          originalStorageKey: 'a',
          originalSha256Hash: 'a',
        },
        {
          ...document,
          id: 'doc_2',
          organizationId: 'org_2',
          name: 'b.pdf',
          originalName: 'b.pdf',
          originalStorageKey: 'b',
          originalSha256Hash: 'b',
        },
        {
          ...document,
          id: 'doc_3',
          organizationId: 'org_2',
          name: 'c.pdf',
          originalName: 'c.pdf',
          originalStorageKey: 'c',
          originalSha256Hash: 'c',
          isDeleted: true,
        },
      ],
    });

    await documentInboxMigration.up({ db });
    await documentInboxMigration.up({ db });

    const reviews = await db
      .select()
      .from(documentReviewsTable)
      .orderBy(documentReviewsTable.documentId);

    expect(
      reviews.map(({ documentId, organizationId, userId }) => ({
        documentId,
        organizationId,
        userId,
      })),
    ).to.eql([
      { documentId: 'doc_1', organizationId: 'org_1', userId: null },
      { documentId: 'doc_2', organizationId: 'org_2', userId: null },
      { documentId: 'doc_3', organizationId: 'org_2', userId: null },
    ]);
    expect(new Set(reviews.map(({ id }) => id)).size).to.eql(3);
    expect(reviews.every(({ id }) => id.startsWith('doc_rev_'))).to.eql(true);
    expect(reviews.every(({ createdAt }) => createdAt.getTime() > Date.UTC(2020, 0, 1))).to.eql(
      true,
    );
  });

  test('the organization settings get a nullable inbox mode column', async () => {
    const { db } = setupDatabase({ url: ':memory:' });
    await runMigrations({ db, migrations, logger: createNoopLogger() });

    await seedDatabase({ db, organizations: [{ id: 'org_1', name: 'Organization 1' }] });
    await db.insert(organizationSettingsTable).values({ organizationId: 'org_1' });
    const [settings] = await db.select().from(organizationSettingsTable);

    expect(settings?.inboxMode).to.eql(null);
  });
});
