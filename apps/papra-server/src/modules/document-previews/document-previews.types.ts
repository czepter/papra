import type { Expand } from '@corentinth/chisels';
import type { PreviewVariant } from '@papra/lecture';
import type { DOCUMENT_PREVIEW_API_STATUSES } from './document-previews.constants';
import type { documentPreviewsTable } from './document-previews.table';

export type { PreviewVariant as DocumentPreviewVariant };

export type DbSelectableDocumentPreview = Expand<typeof documentPreviewsTable.$inferSelect>;
export type DbInsertableDocumentPreview = Expand<typeof documentPreviewsTable.$inferInsert>;

export type DocumentPreview = DbSelectableDocumentPreview;

export type DocumentPreviewApiStatus =
  (typeof DOCUMENT_PREVIEW_API_STATUSES)[keyof typeof DOCUMENT_PREVIEW_API_STATUSES];
