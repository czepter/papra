import type {
  DocumentPreview,
  DocumentPreviewApiStatus,
  DocumentPreviewVariant,
} from './document-previews.types';
import { isPreviewSupportedMimeType } from '@papra/lecture';
import { joinStorageKeyParts } from '../documents/documents.models';
import {
  DOCUMENT_PREVIEW_API_STATUSES,
  DOCUMENT_PREVIEW_STATUSES,
  MAX_PREVIEW_GENERATION_ATTEMPTS,
  PENDING_PREVIEW_STALE_DELAY_MS,
  PREVIEW_VARIANTS,
  PREVIEWS_STORAGE_KEY,
} from './document-previews.constants';

// Same layout as the legacy original documents storage keys: <organizationId>/previews/<documentId>/<variant>.webp
// Previews keys are not derived from the user-defined storage key pattern, as the original file can be moved when the pattern changes.
export function buildDocumentPreviewStorageKey({
  organizationId,
  documentId,
  variant,
}: {
  organizationId: string;
  documentId: string;
  variant: DocumentPreviewVariant;
}) {
  return {
    storageKey: joinStorageKeyParts(
      organizationId,
      PREVIEWS_STORAGE_KEY,
      documentId,
      `${variant}.webp`,
    ),
  };
}

export function isDocumentPreviewSupported({
  mimeType,
  arePreviewsEnabled,
}: {
  mimeType: string;
  arePreviewsEnabled: boolean;
}) {
  return arePreviewsEnabled && isPreviewSupportedMimeType({ mimeType });
}

// A failed preview is retried until it has failed too many times
export function isPreviewPermanentlyFailed({
  status,
  failedAttemptsCount,
}: Pick<DocumentPreview, 'status' | 'failedAttemptsCount'>) {
  return (
    status === DOCUMENT_PREVIEW_STATUSES.FAILED &&
    failedAttemptsCount >= MAX_PREVIEW_GENERATION_ATTEMPTS
  );
}

export function areAllPreviewVariantsReady({
  previews,
}: {
  previews: Pick<DocumentPreview, 'variant' | 'status'>[];
}) {
  return PREVIEW_VARIANTS.every((variant) =>
    previews.some(
      (preview) =>
        preview.variant === variant && preview.status === DOCUMENT_PREVIEW_STATUSES.READY,
    ),
  );
}

export function getDocumentPreviewApiStatus({
  mimeType,
  previews,
  arePreviewsEnabled,
}: {
  mimeType: string;
  previews: Pick<DocumentPreview, 'variant' | 'status' | 'failedAttemptsCount'>[];
  arePreviewsEnabled: boolean;
}): DocumentPreviewApiStatus {
  if (!isDocumentPreviewSupported({ mimeType, arePreviewsEnabled })) {
    return DOCUMENT_PREVIEW_API_STATUSES.UNSUPPORTED;
  }

  if (previews.some(isPreviewPermanentlyFailed)) {
    return DOCUMENT_PREVIEW_API_STATUSES.FAILED;
  }

  return areAllPreviewVariantsReady({ previews })
    ? DOCUMENT_PREVIEW_API_STATUSES.READY
    : DOCUMENT_PREVIEW_API_STATUSES.PENDING;
}

// A generation has to be (re)scheduled when a variant has no record, when a previous attempt failed but can be retried,
// or when a pending record has been waiting for too long (e.g. the job got lost)
export function isPreviewGenerationRequired({
  previews,
  now = new Date(),
}: {
  previews: Pick<DocumentPreview, 'variant' | 'status' | 'updatedAt'>[];
  now?: Date;
}) {
  return PREVIEW_VARIANTS.some((variant) => {
    const preview = previews.find((preview) => preview.variant === variant);

    if (!preview) {
      return true;
    }

    if (preview.status === DOCUMENT_PREVIEW_STATUSES.FAILED) {
      return true;
    }

    return (
      preview.status === DOCUMENT_PREVIEW_STATUSES.PENDING &&
      now.getTime() - preview.updatedAt.getTime() > PENDING_PREVIEW_STALE_DELAY_MS
    );
  });
}

export function buildPreviewEtag({
  originalSha256Hash,
  variant,
}: {
  originalSha256Hash: string;
  variant: DocumentPreviewVariant;
}) {
  return `"${originalSha256Hash}-${variant}"`;
}
