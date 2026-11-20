import { PREVIEW_VARIANTS } from '@papra/lecture';

export { PREVIEW_VARIANTS };

export const DOCUMENT_PREVIEW_STATUSES = {
  PENDING: 'pending',
  READY: 'ready',
  FAILED: 'failed',
} as const;

type DocumentPreviewStatus =
  (typeof DOCUMENT_PREVIEW_STATUSES)[keyof typeof DOCUMENT_PREVIEW_STATUSES];

// Drizzle enum columns require a non-empty tuple
export const DOCUMENT_PREVIEW_STATUS_LIST = Object.values(DOCUMENT_PREVIEW_STATUSES) as [
  DocumentPreviewStatus,
  ...DocumentPreviewStatus[],
];

// Status exposed in the document API payload, it is derived from the stored statuses, the document mime type and the config
export const DOCUMENT_PREVIEW_API_STATUSES = {
  PENDING: 'pending',
  READY: 'ready',
  UNSUPPORTED: 'unsupported',
  FAILED: 'failed',
} as const;

export const PREVIEWS_STORAGE_KEY = 'previews';

// A failed generation is retried once (the next time a preview is requested), then it is considered permanently failed
export const MAX_PREVIEW_GENERATION_ATTEMPTS = 2;

// A pending preview that is still not ready after this delay is considered lost (e.g. job dropped), generation is scheduled again
export const PENDING_PREVIEW_STALE_DELAY_MS = 5 * 60 * 1000;

export const PREVIEW_NOT_READY_RETRY_AFTER_SECONDS = 3;
export const PREVIEW_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;

export const GENERATE_DOCUMENT_PREVIEWS_TASK_NAME = 'generate-document-previews';
