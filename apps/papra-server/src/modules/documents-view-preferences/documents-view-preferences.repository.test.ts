import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { organizationsTable } from '../organizations/organizations.table';
import { usersTable } from '../users/users.table';
import { eq } from 'drizzle-orm';
import { defaultDocumentsViewPreferences } from './documents-view-preferences.models';
import { createDocumentsViewPreferencesRepository } from './documents-view-preferences.repository';
import { documentsViewPreferencesTable } from './documents-view-preferences.table';

async function createTestDatabase() {
  return createInMemoryDatabase({
    users: [
      { id: 'usr_1', email: 'user-1@example.com' },
      { id: 'usr_2', email: 'user-2@example.com' },
    ],
    organizations: [
      { id: 'org_1', name: 'Organization 1' },
      { id: 'org_2', name: 'Organization 2' },
    ],
  });
}

describe('documents view preferences repository', () => {
  describe('getDocumentsViewPreferences', () => {
    test('the defaults are returned when nothing has been saved', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentsViewPreferencesRepository({ db });

      const { preferences } = await repository.getDocumentsViewPreferences({
        userId: 'usr_1',
        organizationId: 'org_1',
      });

      expect(preferences).to.eql(defaultDocumentsViewPreferences);
      expect(preferences).to.eql({ defaultView: 'list', tagViews: {} });
    });
  });

  describe('saveDocumentsViewPreferences', () => {
    test('saved preferences are read back, and saving again replaces them without duplicating the row', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentsViewPreferencesRepository({ db });
      const identity = { userId: 'usr_1', organizationId: 'org_1' };

      await repository.saveDocumentsViewPreferences({
        ...identity,
        preferences: { defaultView: 'grid', tagViews: { invoices: 'list' } },
        now: new Date('2025-01-01'),
      });

      expect((await repository.getDocumentsViewPreferences(identity)).preferences).to.eql({
        defaultView: 'grid',
        tagViews: { invoices: 'list' },
      });

      const { preferences } = await repository.saveDocumentsViewPreferences({
        ...identity,
        preferences: { defaultView: 'list', tagViews: {} },
        now: new Date('2025-01-02'),
      });

      expect(preferences).to.eql({ defaultView: 'list', tagViews: {} });
      expect((await repository.getDocumentsViewPreferences(identity)).preferences).to.eql({
        defaultView: 'list',
        tagViews: {},
      });

      const rows = await db.select().from(documentsViewPreferencesTable);

      expect(rows).to.have.length(1);
      expect(rows[0]?.createdAt).to.eql(new Date('2025-01-01'));
      expect(rows[0]?.updatedAt).to.eql(new Date('2025-01-02'));
    });

    test('preferences are isolated between users and between organizations', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentsViewPreferencesRepository({ db });

      await repository.saveDocumentsViewPreferences({
        userId: 'usr_1',
        organizationId: 'org_1',
        preferences: { defaultView: 'grid', tagViews: {} },
      });

      for (const identity of [
        { userId: 'usr_2', organizationId: 'org_1' },
        { userId: 'usr_1', organizationId: 'org_2' },
      ]) {
        expect((await repository.getDocumentsViewPreferences(identity)).preferences).to.eql(
          defaultDocumentsViewPreferences,
        );
      }
    });

    test('the preferences are deleted with the user or the organization', async () => {
      const { db } = await createTestDatabase();
      const repository = createDocumentsViewPreferencesRepository({ db });
      const preferences = { defaultView: 'grid', tagViews: {} } as const;

      await repository.saveDocumentsViewPreferences({
        userId: 'usr_1',
        organizationId: 'org_1',
        preferences,
      });
      await repository.saveDocumentsViewPreferences({
        userId: 'usr_2',
        organizationId: 'org_2',
        preferences,
      });

      await db.delete(usersTable).where(eq(usersTable.id, 'usr_1'));
      expect(await db.select().from(documentsViewPreferencesTable)).to.have.length(1);

      await db.delete(organizationsTable).where(eq(organizationsTable.id, 'org_2'));
      expect(await db.select().from(documentsViewPreferencesTable)).to.have.length(0);
    });
  });
});
