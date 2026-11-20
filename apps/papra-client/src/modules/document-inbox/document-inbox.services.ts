import type { Document } from '../documents/documents.types';
import type { AsDto } from '../shared/http/http-client.types';
import { apiClient } from '../shared/http/api-client';
import { coerceDates } from '../shared/http/http-client.models';

export async function fetchInboxDocuments({
  organizationId,
  pageIndex,
  pageSize,
}: {
  organizationId: string;
  pageIndex: number;
  pageSize: number;
}) {
  const { documents, documentsCount } = await apiClient<{
    documents: AsDto<Document>[];
    documentsCount: number;
  }>({
    method: 'GET',
    path: `/api/organizations/${organizationId}/documents/inbox`,
    query: { pageIndex, pageSize },
  });

  return {
    documents: documents.map(coerceDates),
    documentsCount,
  };
}

export async function fetchInboxCount({ organizationId }: { organizationId: string }) {
  return apiClient<{ count: number }>({
    method: 'GET',
    path: `/api/organizations/${organizationId}/documents/inbox/count`,
  });
}

export async function markDocumentsAsReviewed({
  organizationId,
  documentIds,
}: {
  organizationId: string;
  documentIds: string[];
}) {
  await apiClient({
    method: 'POST',
    path: `/api/organizations/${organizationId}/documents/reviews`,
    body: { documentIds },
  });
}

export async function moveDocumentToInbox({
  organizationId,
  documentId,
}: {
  organizationId: string;
  documentId: string;
}) {
  await apiClient({
    method: 'DELETE',
    path: `/api/organizations/${organizationId}/documents/${documentId}/review`,
  });
}
