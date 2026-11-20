import type { DocumentsViewPreferences } from './documents-view-preference.models';
import { apiClient } from '../shared/http/api-client';

export async function fetchDocumentsViewPreferences({
  organizationId,
}: {
  organizationId: string;
}) {
  return apiClient<{ preferences: DocumentsViewPreferences }>({
    method: 'GET',
    path: `/api/organizations/${organizationId}/documents/view-preferences`,
  });
}

export async function saveDocumentsViewPreferences({
  organizationId,
  preferences,
}: {
  organizationId: string;
  preferences: DocumentsViewPreferences;
}) {
  return apiClient<{ preferences: DocumentsViewPreferences }>({
    method: 'PUT',
    path: `/api/organizations/${organizationId}/documents/view-preferences`,
    body: { preferences },
  });
}
