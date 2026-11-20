import type { Document } from '@/modules/documents/documents.types';
import type { DocumentCustomProperty } from './custom-properties.types';
import {
  rawPropertyValueAsOption,
  rawPropertyValueAsOptionArray,
  rawPropertyValueAsRelatedDocumentArray,
  rawPropertyValueAsUserArray,
} from './custom-properties.models';
import { buildCustomPropertyFilterTerm } from './custom-property-filter.models';

export type CustomPropertyDisplayLabels = {
  yes: string;
  no: string;
  formatDate: (date: Date) => string;
};

function parseDate(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type CustomPropertyValueItem = {
  text: string;
  // Search term filtering the documents by this value, undefined when the value can't be filtered on
  filterTerm: string | undefined;
};

// One item per displayed value: single value types have at most one, multi value types one per value.
// The filter value is what the search syntax expects for the type: the option name for selects (matched
// by its generated key), the user id, the related document id, the stored ISO string for dates.
export function getCustomPropertyValueItems({
  property,
  labels,
}: {
  property: Pick<DocumentCustomProperty, 'key' | 'type' | 'value'>;
  labels: CustomPropertyDisplayLabels;
}): CustomPropertyValueItem[] {
  const { key, type, value } = property;

  const item = (text: string, filterValue: string): CustomPropertyValueItem => ({
    text,
    filterTerm: buildCustomPropertyFilterTerm({ key, value: filterValue }),
  });

  switch (type) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? [item(value, value)] : [];
    case 'number':
      return typeof value === 'number' ? [item(String(value), String(value))] : [];
    case 'date': {
      const date = parseDate(value);
      return date ? [item(labels.formatDate(date), value as string)] : [];
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? [item(value ? labels.yes : labels.no, String(value))]
        : [];
    case 'select': {
      const option = rawPropertyValueAsOption(value);
      return option ? [item(option.name, option.name)] : [];
    }
    case 'multi_select':
      return rawPropertyValueAsOptionArray(value).map(({ name }) => item(name, name));
    case 'user_relation':
      return rawPropertyValueAsUserArray(value).map(({ userId, name, email }) =>
        item(name || email, userId),
      );
    case 'document_relation':
      return rawPropertyValueAsRelatedDocumentArray(value).map(({ documentId, name }) =>
        item(name, documentId),
      );
    default:
      return [];
  }
}

// Returns undefined when there is nothing to show, so callers can skip empty values
export function formatCustomPropertyValue({
  property,
  labels,
}: {
  property: Pick<DocumentCustomProperty, 'type' | 'value'>;
  labels: CustomPropertyDisplayLabels;
}): string | undefined {
  const items = getCustomPropertyValueItems({ property: { key: '', ...property }, labels });

  return items.length > 0 ? items.map(({ text }) => text).join(', ') : undefined;
}

// One entry per property having a value, ordered by displayOrder
export function getDocumentCustomPropertyDisplayValues({
  document,
  labels,
}: {
  document: Pick<Document, 'customProperties'>;
  labels: CustomPropertyDisplayLabels;
}) {
  return (document.customProperties ?? [])
    .toSorted((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((property) => {
      const text = formatCustomPropertyValue({ property, labels });
      return text === undefined
        ? []
        : [
            {
              key: property.key,
              name: property.name,
              text,
              items: getCustomPropertyValueItems({ property, labels }),
            },
          ];
    });
}

export type CustomPropertyColumnDefinition = Pick<
  DocumentCustomProperty,
  'key' | 'name' | 'type' | 'displayOrder'
>;

// Properties worth a column: those with a value on at least one of the documents,
// plus the pinned ones (e.g. the property the list is sorted by) that must stay reachable without values
export function getCustomPropertyColumnDefinitions({
  documents,
  labels,
  pinnedDefinitions = [],
}: {
  documents: Pick<Document, 'customProperties'>[];
  labels: CustomPropertyDisplayLabels;
  pinnedDefinitions?: CustomPropertyColumnDefinition[];
}): CustomPropertyColumnDefinition[] {
  const definitionsByKey = new Map<string, CustomPropertyColumnDefinition>();

  for (const document of documents) {
    for (const property of document.customProperties ?? []) {
      if (
        !definitionsByKey.has(property.key) &&
        formatCustomPropertyValue({ property, labels }) !== undefined
      ) {
        definitionsByKey.set(property.key, {
          key: property.key,
          name: property.name,
          type: property.type,
          displayOrder: property.displayOrder,
        });
      }
    }
  }

  for (const definition of pinnedDefinitions) {
    if (!definitionsByKey.has(definition.key)) {
      definitionsByKey.set(definition.key, definition);
    }
  }

  return [...definitionsByKey.values()].toSorted((a, b) => a.displayOrder - b.displayOrder);
}
