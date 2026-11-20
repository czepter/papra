export const DOCUMENT_ACTIVITY_EVENTS = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  RESTORED: 'restored',
  TAGGED: 'tagged',
  UNTAGGED: 'untagged',
} as const;

export const DOCUMENT_ACTIVITY_EVENT_LIST = Object.values(DOCUMENT_ACTIVITY_EVENTS);

export const MAX_CONCURRENT_DOCUMENT_UPLOADS = 3;

export const DEFAULT_DOCUMENT_ICON = 'i-tabler-file';

export const DOCUMENT_SEARCH_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'documentDate',
] as const;

// Sorts by a custom property value, identified by the property key
export const CUSTOM_PROPERTY_SORT_FIELD_PREFIX = 'customProperty:';
export type DocumentSearchCustomPropertySortField = `customProperty:${string}`;

export type DocumentSearchSortField =
  | (typeof DOCUMENT_SEARCH_SORT_FIELDS)[number]
  | DocumentSearchCustomPropertySortField;

export const DOCUMENT_SEARCH_SORT_ORDERS = ['asc', 'desc'] as const;
export type DocumentSearchSortOrder = (typeof DOCUMENT_SEARCH_SORT_ORDERS)[number];

export const DEFAULT_DOCUMENT_SEARCH_SORT_FIELD: DocumentSearchSortField = 'documentDate';
export const DEFAULT_DOCUMENT_SEARCH_SORT_ORDER: DocumentSearchSortOrder = 'desc';
