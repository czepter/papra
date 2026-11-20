import { parseSearchQuery } from '@papra/search-parser';

export const DOCUMENTS_VIEWS = ['list', 'grid'] as const;
export type DocumentsView = (typeof DOCUMENTS_VIEWS)[number];

export const DEFAULT_DOCUMENTS_VIEW: DocumentsView = 'list';

export type DocumentsViewPreferences = {
  defaultView: DocumentsView;
  // Overrides keyed by normalized tag name
  tagViews: Record<string, DocumentsView>;
};

export const defaultDocumentsViewPreferences: DocumentsViewPreferences = {
  defaultView: DEFAULT_DOCUMENTS_VIEW,
  tagViews: {},
};

export function normalizeTagKey({ tagName }: { tagName: string }) {
  return tagName.trim().toLowerCase();
}

// Returns the tag name when the query filters by exactly one tag and nothing else (e.g. `tag:invoices`)
export function getSingleTagFromSearchQuery({ query }: { query: string }): string | undefined {
  if (query.trim() === '') {
    return undefined;
  }

  const { expression, issues } = parseSearchQuery({ query });

  if (issues.length > 0) {
    return undefined;
  }

  if (expression.type === 'filter' && expression.field === 'tag' && expression.operator === '=') {
    return expression.value;
  }

  return undefined;
}

export function resolveDocumentsView({
  preferences,
  tagName,
}: {
  preferences: DocumentsViewPreferences;
  tagName?: string;
}): DocumentsView {
  if (tagName === undefined) {
    return preferences.defaultView;
  }

  return preferences.tagViews[normalizeTagKey({ tagName })] ?? preferences.defaultView;
}

export function hasTagViewOverride({
  preferences,
  tagName,
}: {
  preferences: DocumentsViewPreferences;
  tagName?: string;
}) {
  return tagName !== undefined && normalizeTagKey({ tagName }) in preferences.tagViews;
}

// Toggling in the unfiltered view changes the default, toggling in a single-tag view only overrides that tag.
// An override equal to the default is dropped, so it does not stay pinned when the default changes later.
export function setDocumentsView({
  preferences,
  tagName,
  view,
}: {
  preferences: DocumentsViewPreferences;
  tagName?: string;
  view: DocumentsView;
}): DocumentsViewPreferences {
  if (tagName === undefined) {
    return { ...preferences, defaultView: view };
  }

  const key = normalizeTagKey({ tagName });
  const { [key]: _previous, ...otherTagViews } = preferences.tagViews;

  return {
    ...preferences,
    tagViews: view === preferences.defaultView ? otherTagViews : { ...otherTagViews, [key]: view },
  };
}

export function removeTagViewOverride({
  preferences,
  tagName,
}: {
  preferences: DocumentsViewPreferences;
  tagName: string;
}): DocumentsViewPreferences {
  const { [normalizeTagKey({ tagName })]: _removed, ...tagViews } = preferences.tagViews;

  return { ...preferences, tagViews };
}

// Makes the view the default everywhere and drops the override of the tag it was just saved for
export function applyViewEverywhere({
  preferences,
  tagName,
  view,
}: {
  preferences: DocumentsViewPreferences;
  tagName: string;
  view: DocumentsView;
}): DocumentsViewPreferences {
  return removeTagViewOverride({ preferences: { ...preferences, defaultView: view }, tagName });
}
