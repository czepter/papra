export const documentSearchSortFields = ['createdAt', 'updatedAt', 'name', 'documentDate'] as const;
export type DocumentSearchBuiltInSortField = (typeof documentSearchSortFields)[number];

// Sorts by the value of a custom property, identified by its key, e.g. `customProperty:korrespondent`
export const CUSTOM_PROPERTY_SORT_FIELD_PREFIX = 'customProperty:';
export type DocumentSearchCustomPropertySortField = `customProperty:${string}`;

export type DocumentSearchSortField =
  | DocumentSearchBuiltInSortField
  | DocumentSearchCustomPropertySortField;

// Property keys only hold lowercase letters and digits (see generatePropertyKey)
const CUSTOM_PROPERTY_SORT_FIELD_REGEX = /^customProperty:[\p{L}\p{N}]{1,100}$/u;

export function isCustomPropertySortField(
  field: string,
): field is DocumentSearchCustomPropertySortField {
  return CUSTOM_PROPERTY_SORT_FIELD_REGEX.test(field);
}

export function getCustomPropertyKeyFromSortField({
  field,
}: {
  field: DocumentSearchSortField;
}): string | undefined {
  return isCustomPropertySortField(field)
    ? field.slice(CUSTOM_PROPERTY_SORT_FIELD_PREFIX.length)
    : undefined;
}

export const documentSearchSortOrders = ['asc', 'desc'] as const;
export type DocumentSearchSortOrder = (typeof documentSearchSortOrders)[number];

export type DocumentSearchSort = {
  field: DocumentSearchSortField;
  order: DocumentSearchSortOrder;
};

export const DEFAULT_DOCUMENT_SEARCH_SORT: DocumentSearchSort = {
  field: 'createdAt',
  order: 'desc',
};
