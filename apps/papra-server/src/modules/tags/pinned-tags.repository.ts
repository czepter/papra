import type { Database } from '../app/database/database.types';
import { injectArguments } from '@corentinth/chisels';
import { isNonEmptyArray } from '../shared/arrays/arrays.utils';
import { tagsTable, userPinnedTagsTable } from './tags.table';
import { and, asc, eq, getTableColumns, max } from 'drizzle-orm';

export type PinnedTagsRepository = ReturnType<typeof createPinnedTagsRepository>;

export function createPinnedTagsRepository({ db }: { db: Database }) {
  return injectArguments({ getPinnedTags, pinTag, unpinTag, reorderPinnedTags }, { db });
}

async function getPinnedTags({
  userId,
  organizationId,
  db,
}: {
  userId: string;
  organizationId: string;
  db: Database;
}) {
  const pinnedTags = await db
    .select(getTableColumns(tagsTable))
    .from(userPinnedTagsTable)
    .innerJoin(tagsTable, eq(tagsTable.id, userPinnedTagsTable.tagId))
    .where(
      and(
        eq(userPinnedTagsTable.userId, userId),
        eq(userPinnedTagsTable.organizationId, organizationId),
      ),
    )
    .orderBy(asc(userPinnedTagsTable.position), asc(userPinnedTagsTable.createdAt));

  return { pinnedTags };
}

// Idempotent: pinning an already pinned tag keeps its position.
async function pinTag({
  userId,
  organizationId,
  tagId,
  db,
}: {
  userId: string;
  organizationId: string;
  tagId: string;
  db: Database;
}) {
  const [{ maxPosition } = { maxPosition: null }] = await db
    .select({ maxPosition: max(userPinnedTagsTable.position) })
    .from(userPinnedTagsTable)
    .where(
      and(
        eq(userPinnedTagsTable.userId, userId),
        eq(userPinnedTagsTable.organizationId, organizationId),
      ),
    );

  await db
    .insert(userPinnedTagsTable)
    .values({ userId, organizationId, tagId, position: (maxPosition ?? -1) + 1 })
    .onConflictDoNothing({ target: [userPinnedTagsTable.userId, userPinnedTagsTable.tagId] });
}

async function unpinTag({
  userId,
  organizationId,
  tagId,
  db,
}: {
  userId: string;
  organizationId: string;
  tagId: string;
  db: Database;
}) {
  await db
    .delete(userPinnedTagsTable)
    .where(
      and(
        eq(userPinnedTagsTable.userId, userId),
        eq(userPinnedTagsTable.organizationId, organizationId),
        eq(userPinnedTagsTable.tagId, tagId),
      ),
    );
}

// Tag ids not currently pinned are ignored; pinned tags missing from the list go after the listed ones.
async function reorderPinnedTags({
  userId,
  organizationId,
  tagIds,
  db,
}: {
  userId: string;
  organizationId: string;
  tagIds: string[];
  db: Database;
}) {
  const { pinnedTags } = await getPinnedTags({ userId, organizationId, db });
  const pinnedIds = new Set(pinnedTags.map(({ id }) => id));
  const requested = [...new Set(tagIds)].filter((id) => pinnedIds.has(id));
  const requestedSet = new Set(requested);
  const orderedIds = [
    ...requested,
    ...pinnedTags.map(({ id }) => id).filter((id) => !requestedSet.has(id)),
  ];

  const queries = orderedIds.map((tagId, position) =>
    db
      .update(userPinnedTagsTable)
      .set({ position })
      .where(and(eq(userPinnedTagsTable.userId, userId), eq(userPinnedTagsTable.tagId, tagId))),
  );

  if (!isNonEmptyArray(queries)) {
    return;
  }

  await db.batch(queries);
}
