import type { DOCUMENTS_VIEWS } from './documents-view-preferences.constants';

export type DocumentsView = (typeof DOCUMENTS_VIEWS)[number];

export type DocumentsViewPreferences = {
  defaultView: DocumentsView;
  // Overrides keyed by normalized tag name
  tagViews: Record<string, DocumentsView>;
};
