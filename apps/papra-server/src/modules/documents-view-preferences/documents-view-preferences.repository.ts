import type { Database } from '../app/database/database.types';
import type { DocumentsViewPreferences } from './documents-view-preferences.types';
import { injectArguments } from '@corentinth/chisels';
import { and, eq } from 'drizzle-orm';
import { defaultDocumentsViewPreferences } from './documents-view-preferences.models';
import { documentsViewPreferencesTable } from './documents-view-preferences.table';

export type DocumentsViewPreferencesRepository = ReturnType<
  typeof createDocumentsViewPreferencesRepository
>;

export function createDocumentsViewPreferencesRepository({ db }: { db: Database }) {
  return injectArguments(
    {
      getDocumentsViewPreferences,
      saveDocumentsViewPreferences,
    },
    { db },
  );
}

// Returns the defaults when the user has not saved any preference for the organization
async function getDocumentsViewPreferences({
  userId,
  organizationId,
  db,
}: {
  userId: string;
  organizationId: string;
  db: Database;
}) {
  const [row] = await db
    .select({ preferences: documentsViewPreferencesTable.preferences })
    .from(documentsViewPreferencesTable)
    .where(
      and(
        eq(documentsViewPreferencesTable.userId, userId),
        eq(documentsViewPreferencesTable.organizationId, organizationId),
      ),
    );

  return { preferences: row?.preferences ?? defaultDocumentsViewPreferences };
}

async function saveDocumentsViewPreferences({
  userId,
  organizationId,
  preferences,
  db,
  now = new Date(),
}: {
  userId: string;
  organizationId: string;
  preferences: DocumentsViewPreferences;
  db: Database;
  now?: Date;
}) {
  const [row] = await db
    .insert(documentsViewPreferencesTable)
    .values({ userId, organizationId, preferences, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [documentsViewPreferencesTable.userId, documentsViewPreferencesTable.organizationId],
      set: { preferences, updatedAt: now },
    })
    .returning({ preferences: documentsViewPreferencesTable.preferences });

  return { preferences: row?.preferences ?? preferences };
}
