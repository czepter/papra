import type { AsDto } from '../shared/http/http-client.types';
import type { Tag } from './tags.types';
import { apiClient } from '../shared/http/api-client';
import { coerceDates } from '../shared/http/http-client.models';

export async function fetchTags({ organizationId }: { organizationId: string }) {
  const { tags } = await apiClient<{ tags: AsDto<Tag>[] }>({
    path: `/api/organizations/${organizationId}/tags`,
    method: 'GET',
  });

  return {
    tags: tags.map(coerceDates),
  };
}

export async function createTag({
  organizationId,
  name,
  color,
  description,
}: {
  organizationId: string;
  name: string;
  color: string;
  description: string;
}) {
  const { tag } = await apiClient<{ tag: AsDto<Tag> }>({
    path: `/api/organizations/${organizationId}/tags`,
    method: 'POST',
    body: { name, color, description },
  });

  return {
    tag: coerceDates(tag),
  };
}

export async function updateTag({
  organizationId,
  tagId,
  name,
  color,
  description,
}: {
  organizationId: string;
  tagId: string;
  name: string;
  color: string;
  description: string;
}) {
  const { tag } = await apiClient<{ tag: AsDto<Tag> }>({
    path: `/api/organizations/${organizationId}/tags/${tagId}`,
    method: 'PUT',
    body: { name, color, description },
  });

  return {
    tag: coerceDates(tag),
  };
}

export async function deleteTag({
  organizationId,
  tagId,
}: {
  organizationId: string;
  tagId: string;
}) {
  await apiClient({
    path: `/api/organizations/${organizationId}/tags/${tagId}`,
    method: 'DELETE',
  });
}

export async function addTagToDocument({
  organizationId,
  documentId,
  tagId,
}: {
  organizationId: string;
  documentId: string;
  tagId: string;
}) {
  await apiClient({
    path: `/api/organizations/${organizationId}/documents/${documentId}/tags`,
    method: 'POST',
    body: { tagId },
  });
}

export async function removeTagFromDocument({
  organizationId,
  documentId,
  tagId,
}: {
  organizationId: string;
  documentId: string;
  tagId: string;
}) {
  await apiClient({
    path: `/api/organizations/${organizationId}/documents/${documentId}/tags/${tagId}`,
    method: 'DELETE',
  });
}

export async function fetchPinnedTags({ organizationId }: { organizationId: string }) {
  const { pinnedTags } = await apiClient<{ pinnedTags: AsDto<Tag>[] }>({
    path: `/api/organizations/${organizationId}/tags/pinned`,
    method: 'GET',
  });

  return {
    pinnedTags: pinnedTags.map(coerceDates),
  };
}

export async function pinTag({ organizationId, tagId }: { organizationId: string; tagId: string }) {
  await apiClient({
    path: `/api/organizations/${organizationId}/tags/${tagId}/pin`,
    method: 'POST',
  });
}

export async function unpinTag({
  organizationId,
  tagId,
}: {
  organizationId: string;
  tagId: string;
}) {
  await apiClient({
    path: `/api/organizations/${organizationId}/tags/${tagId}/pin`,
    method: 'DELETE',
  });
}

export async function reorderPinnedTags({
  organizationId,
  tagIds,
}: {
  organizationId: string;
  tagIds: string[];
}) {
  await apiClient({
    path: `/api/organizations/${organizationId}/tags/pinned/order`,
    method: 'PUT',
    body: { tagIds },
  });
}
