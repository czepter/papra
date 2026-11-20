import { PDF_MIME_TYPE, UNSUPPORTED_PREVIEW_IMAGE_MIME_TYPES } from './previews.constants';

function normalizeMimeType({ mimeType }: { mimeType: string }) {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

export function isPdfMimeType({ mimeType }: { mimeType: string }) {
  return normalizeMimeType({ mimeType }) === PDF_MIME_TYPE;
}

export function isPreviewSupportedMimeType({ mimeType }: { mimeType: string }) {
  const normalizedMimeType = normalizeMimeType({ mimeType });

  if (normalizedMimeType === PDF_MIME_TYPE) {
    return true;
  }

  return (
    normalizedMimeType.startsWith('image/') &&
    !UNSUPPORTED_PREVIEW_IMAGE_MIME_TYPES.includes(normalizedMimeType)
  );
}
