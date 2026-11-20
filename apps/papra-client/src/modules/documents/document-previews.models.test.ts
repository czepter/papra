import { describe, expect, test } from 'vitest';
import {
  getDocumentPreviewUrl,
  getDocumentTextExcerpt,
  getDocumentTypeFamily,
  getInitialPreviewDisplayState,
  getPreviewRetryDelayMs,
  isImageDocument,
} from './document-previews.models';

describe('document-previews models', () => {
  describe('getDocumentPreviewUrl', () => {
    test('builds the absolute url of a preview variant', () => {
      expect(
        getDocumentPreviewUrl({
          baseUrl: 'https://papra.example.com/',
          organizationId: 'org_1',
          documentId: 'doc_1',
          variant: 'thumb',
        }),
      ).toBe('https://papra.example.com/api/organizations/org_1/documents/doc_1/previews/thumb');
    });
  });

  describe('getInitialPreviewDisplayState', () => {
    test('maps the server preview status to what the ui renders, a missing status being pending', () => {
      expect(getInitialPreviewDisplayState({ previewStatus: 'ready' })).toBe('ready');
      expect(getInitialPreviewDisplayState({ previewStatus: 'pending' })).toBe('loading');
      expect(getInitialPreviewDisplayState({})).toBe('loading');
      expect(getInitialPreviewDisplayState({ previewStatus: 'unsupported' })).toBe('unavailable');
      expect(getInitialPreviewDisplayState({ previewStatus: 'failed' })).toBe('unavailable');
    });
  });

  describe('getPreviewRetryDelayMs', () => {
    test('grows with the attempt count up to a cap', () => {
      expect(getPreviewRetryDelayMs({ attempt: 0 })).toBe(3000);
      expect(getPreviewRetryDelayMs({ attempt: 1 })).toBe(4500);
      expect(getPreviewRetryDelayMs({ attempt: 2 })).toBe(6750);
      expect(getPreviewRetryDelayMs({ attempt: 20 })).toBe(15_000);
    });

    test('the server Retry-After is a floor and jitter is added on top', () => {
      expect(getPreviewRetryDelayMs({ attempt: 0, retryAfterSeconds: 10 })).toBe(10_000);
      expect(getPreviewRetryDelayMs({ attempt: 0, retryAfterSeconds: 1 })).toBe(3000);
      expect(getPreviewRetryDelayMs({ attempt: 0, jitter: 250 })).toBe(3250);
      expect(getPreviewRetryDelayMs({ attempt: 0, retryAfterSeconds: Number.NaN })).toBe(3000);
    });
  });

  describe('getDocumentTypeFamily', () => {
    test.each([
      [{ mimeType: 'application/pdf', name: 'a.pdf' }, 'pdf'],
      [
        { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        'spreadsheet',
      ],
      [{ mimeType: 'text/csv' }, 'spreadsheet'],
      [{ mimeType: 'application/msword' }, 'word'],
      [{ mimeType: 'message/rfc822' }, 'email'],
      [{ mimeType: 'application/zip' }, 'archive'],
      [{ mimeType: 'image/avif' }, 'image'],
      [{ mimeType: 'application/octet-stream', name: 'mail.EML' }, 'email'],
      [{ mimeType: 'application/octet-stream', name: 'archive.7z' }, 'archive'],
      [{ mimeType: 'text/plain', name: 'notes.txt' }, 'other'],
      [{ name: 'no-extension' }, 'other'],
      [{}, 'other'],
    ] as const)('%j is in the %s family', (document, family) => {
      expect(getDocumentTypeFamily(document)).toBe(family);
    });
  });

  describe('isImageDocument', () => {
    test('is true only for image mime types', () => {
      expect(isImageDocument({ mimeType: 'image/png' })).toBe(true);
      expect(isImageDocument({ mimeType: 'application/pdf' })).toBe(false);
      expect(isImageDocument({})).toBe(false);
    });
  });

  describe('getDocumentTextExcerpt', () => {
    test('collapses whitespace and truncates long content with an ellipsis', () => {
      expect(getDocumentTextExcerpt({ content: '  Hello \n\n  world  ' })).toBe('Hello world');
      expect(getDocumentTextExcerpt({ content: 'abcdefghij', maxLength: 5 })).toBe('abcde…');
      expect(getDocumentTextExcerpt({ content: undefined })).toBe('');
    });
  });
});
