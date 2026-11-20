import { createErrorFactory } from '../shared/errors/errors';

export const createDocumentPreviewNotReadyError = createErrorFactory({
  message: 'The document preview is not ready yet, try again shortly.',
  code: 'document.preview_not_ready',
  statusCode: 503,
});

export const createDocumentPreviewUnsupportedError = createErrorFactory({
  message: 'Previews are not available for this document.',
  code: 'document.preview_unsupported',
  statusCode: 404,
});

export const createDocumentPreviewFailedError = createErrorFactory({
  message: 'The preview of this document could not be generated.',
  code: 'document.preview_failed',
  statusCode: 404,
});
