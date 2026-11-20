import type { Config } from '../config/config.types';
import type { DocumentsRepository } from '../documents/documents.repository';
import type { OrganizationSettingsRepository } from '../organizations/organization-settings/organization-settings.repository';
import type { DocumentInboxRepository } from './document-inbox.repository';
import { createDocumentIdsNotFromOrganizationError } from '../documents/documents-batch/documents-batch.errors';
import { resolveOrganizationSettings } from '../organizations/organization-settings/organization-settings.usecases';

export async function getOrganizationInboxMode({
  organizationId,
  organizationSettingsRepository,
  config,
}: {
  organizationId: string;
  organizationSettingsRepository: OrganizationSettingsRepository;
  config: Config;
}) {
  const { organizationSettings } = await resolveOrganizationSettings({
    organizationId,
    organizationSettingsRepository,
    config,
  });

  return { mode: organizationSettings.inbox.mode };
}

export async function markDocumentsAsReviewed({
  organizationId,
  documentIds,
  userId,
  documentsRepository,
  documentInboxRepository,
}: {
  organizationId: string;
  documentIds: string[];
  userId: string;
  documentsRepository: DocumentsRepository;
  documentInboxRepository: DocumentInboxRepository;
}) {
  const areAllDocumentsInOrganization = await documentsRepository.areAllDocumentsInOrganization({
    documentIds,
    organizationId,
  });

  if (!areAllDocumentsInOrganization) {
    throw createDocumentIdsNotFromOrganizationError();
  }

  await documentInboxRepository.markDocumentsAsReviewed({ organizationId, documentIds, userId });
}
