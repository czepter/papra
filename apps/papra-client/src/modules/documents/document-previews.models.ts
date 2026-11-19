import { joinUrlPaths } from '@corentinth/chisels';
import { getDocumentNameExtension } from './document.models';

export const DOCUMENT_PREVIEW_VARIANTS = ['thumb', 'card', 'preview'] as const;
export type DocumentPreviewVariant = (typeof DOCUMENT_PREVIEW_VARIANTS)[number];

export type DocumentPreviewStatus = 'pending' | 'ready' | 'unsupported' | 'failed';

// What the UI should render for a preview:
// - loading: generation in progress (or being probed), show a skeleton
// - ready: the image can be loaded
// - unavailable: no preview will ever exist, show a file type tile
export type DocumentPreviewDisplayState = 'loading' | 'ready' | 'unavailable';

export function getDocumentPreviewUrl({
  baseUrl,
  organizationId,
  documentId,
  variant,
}: {
  baseUrl: string;
  organizationId: string;
  documentId: string;
  variant: DocumentPreviewVariant;
}) {
  return joinUrlPaths(
    baseUrl,
    `/api/organizations/${organizationId}/documents/${documentId}/previews/${variant}`,
  );
}

export function getInitialPreviewDisplayState({
  previewStatus,
}: {
  // Create and update responses do not carry the preview status, it is treated as pending
  previewStatus?: DocumentPreviewStatus;
}): DocumentPreviewDisplayState {
  if (previewStatus === 'ready') {
    return 'ready';
  }

  if (previewStatus === 'unsupported' || previewStatus === 'failed') {
    return 'unavailable';
  }

  return 'loading';
}

export const PREVIEW_MAX_ATTEMPTS = 8;
const PREVIEW_BASE_DELAY_MS = 3000;
const PREVIEW_MAX_DELAY_MS = 15_000;

// Delay before the next attempt (attempt is 0-based): honors the server Retry-After as a floor,
// then grows by 50% each attempt up to a cap, so a page full of pending previews does not hammer the server.
export function getPreviewRetryDelayMs({
  attempt,
  retryAfterSeconds,
  jitter = 0,
}: {
  attempt: number;
  retryAfterSeconds?: number;
  jitter?: number;
}) {
  const retryAfterMs = Number.isFinite(retryAfterSeconds)
    ? (retryAfterSeconds as number) * 1000
    : 0;
  const backoffMs = Math.min(PREVIEW_BASE_DELAY_MS * 1.5 ** attempt, PREVIEW_MAX_DELAY_MS);

  return Math.round(Math.max(retryAfterMs, backoffMs) + jitter);
}

export function createConcurrencyLimiter({ maxConcurrency }: { maxConcurrency: number }) {
  let running = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (running >= maxConcurrency) {
      return;
    }

    queue.shift()?.();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running >= maxConcurrency) {
        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      }

      running += 1;

      try {
        return await task();
      } finally {
        running -= 1;
        next();
      }
    },
  };
}

export type DocumentTypeFamily =
  | 'pdf'
  | 'spreadsheet'
  | 'word'
  | 'email'
  | 'archive'
  | 'image'
  | 'other';

const familyByMimeType: Record<string, DocumentTypeFamily> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.oasis.opendocument.text': 'word',
  'application/rtf': 'word',
  'message/rfc822': 'email',
  'application/vnd.ms-outlook': 'email',
  'application/zip': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive',
  'application/gzip': 'archive',
  'application/x-tar': 'archive',
};

const familyByExtension: Record<string, DocumentTypeFamily> = {
  'pdf': 'pdf',
  'xls': 'spreadsheet',
  'xlsx': 'spreadsheet',
  'ods': 'spreadsheet',
  'csv': 'spreadsheet',
  'doc': 'word',
  'docx': 'word',
  'odt': 'word',
  'rtf': 'word',
  'eml': 'email',
  'msg': 'email',
  'zip': 'archive',
  'rar': 'archive',
  '7z': 'archive',
  'gz': 'archive',
  'tar': 'archive',
  'jpg': 'image',
  'jpeg': 'image',
  'png': 'image',
  'gif': 'image',
  'webp': 'image',
  'bmp': 'image',
  'svg': 'image',
  'tiff': 'image',
  'heic': 'image',
};

export function getDocumentTypeFamily({
  mimeType,
  name,
}: {
  mimeType?: string;
  name?: string;
}): DocumentTypeFamily {
  const normalizedMimeType = mimeType?.toLowerCase();

  if (normalizedMimeType) {
    const family = familyByMimeType[normalizedMimeType];

    if (family) {
      return family;
    }

    if (normalizedMimeType.startsWith('image/')) {
      return 'image';
    }
  }

  const extension = name ? getDocumentNameExtension({ name })?.toLowerCase() : undefined;

  return (extension ? familyByExtension[extension] : undefined) ?? 'other';
}

export function isImageDocument({ mimeType }: { mimeType?: string }) {
  return mimeType?.toLowerCase().startsWith('image/') ?? false;
}

export function getDocumentTextExcerpt({
  content,
  maxLength = 300,
}: {
  content?: string;
  maxLength?: number;
}) {
  const normalized = (content ?? '').replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}
