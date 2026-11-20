import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../app/database/database.test-utils';
import { createPinnedTagsRepository } from './pinned-tags.repository';
import { createTagsRepository } from './tags.repository';

async function setup() {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: 'user-1', email: 'user-1@example.com' },
      { id: 'user-2', email: 'user-2@example.com' },
    ],
    organizations: [
      { id: 'org-1', name: 'Org 1' },
      { id: 'org-2', name: 'Org 2' },
    ],
    tags: [
      { id: 'tag-1', organizationId: 'org-1', name: 'One', color: '#111111' },
      { id: 'tag-2', organizationId: 'org-1', name: 'Two', color: '#222222' },
      { id: 'tag-3', organizationId: 'org-1', name: 'Three', color: '#333333' },
      { id: 'tag-other', organizationId: 'org-2', name: 'Other', color: '#444444' },
    ],
  });

  return {
    repo: createPinnedTagsRepository({ db }),
    tagsRepository: createTagsRepository({ db }),
  };
}

const ids = (tags: { id: string }[]) => tags.map(({ id }) => id);

describe('pinned tags repository', () => {
  test('pinned tags are returned in pin order with full tag data', async () => {
    const { repo } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-2' });
    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });

    const { pinnedTags } = await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' });

    expect(ids(pinnedTags)).toEqual(['tag-2', 'tag-1']);
    expect(pinnedTags[0]).toMatchObject({ name: 'Two', color: '#222222' });
  });

  test('pinning is idempotent and keeps the original position', async () => {
    const { repo } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });
    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-2' });
    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });

    const { pinnedTags } = await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' });

    expect(ids(pinnedTags)).toEqual(['tag-1', 'tag-2']);
  });

  test('pins are per user', async () => {
    const { repo } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });
    await repo.pinTag({ userId: 'user-2', organizationId: 'org-1', tagId: 'tag-2' });

    expect(
      ids((await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags),
    ).toEqual(['tag-1']);
    expect(
      ids((await repo.getPinnedTags({ userId: 'user-2', organizationId: 'org-1' })).pinnedTags),
    ).toEqual(['tag-2']);

    await repo.unpinTag({ userId: 'user-2', organizationId: 'org-1', tagId: 'tag-1' });

    expect(
      ids((await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags),
    ).toEqual(['tag-1']);
  });

  test('unpinning removes the tag', async () => {
    const { repo } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });
    await repo.unpinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });

    expect(
      (await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags,
    ).toEqual([]);
  });

  test('pins from another organization are not returned and tags of another org are not visible via getTagById', async () => {
    const { repo, tagsRepository } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-2', tagId: 'tag-other' });

    expect(
      (await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags,
    ).toEqual([]);
    // The route rejects cross-org pins by checking the tag belongs to the organization
    expect(
      (await tagsRepository.getTagById({ tagId: 'tag-other', organizationId: 'org-1' })).tag,
    ).toBeUndefined();
  });

  test('deleting a tag removes it from pinned tags', async () => {
    const { repo, tagsRepository } = await setup();

    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-1' });
    await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId: 'tag-2' });
    await tagsRepository.deleteTag({ tagId: 'tag-1', organizationId: 'org-1' });

    expect(
      ids((await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags),
    ).toEqual(['tag-2']);
  });

  test('pinned tags can be reordered, unknown ids ignored and omitted pins kept at the end', async () => {
    const { repo } = await setup();

    for (const tagId of ['tag-1', 'tag-2', 'tag-3']) {
      await repo.pinTag({ userId: 'user-1', organizationId: 'org-1', tagId });
    }

    await repo.reorderPinnedTags({
      userId: 'user-1',
      organizationId: 'org-1',
      tagIds: ['tag-3', 'unknown', 'tag-1'],
    });

    expect(
      ids((await repo.getPinnedTags({ userId: 'user-1', organizationId: 'org-1' })).pinnedTags),
    ).toEqual(['tag-3', 'tag-1', 'tag-2']);
  });
});
