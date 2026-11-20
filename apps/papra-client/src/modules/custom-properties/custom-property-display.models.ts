import type { Document } from '@/modules/documents/documents.types';
import type { DocumentCustomProperty } from './custom-properties.types';
import {
  rawPropertyValueAsOption,
  rawPropertyValueAsOptionArray,
  rawPropertyValueAsRelatedDocumentArray,
  rawPropertyValueAsUserArray,
} from './custom-properties.models';

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

// Returns undefined when there is nothing to show, so callers can skip empty values
export function formatCustomPropertyValue({
  property,
  labels,
}: {
  property: Pick<DocumentCustomProperty, 'type' | 'value'>;
  labels: CustomPropertyDisplayLabels;
}): string | undefined {
  const { type, value } = property;

  const joined = (items: string[]) => (items.length > 0 ? items.join(', ') : undefined);

  switch (type) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    case 'number':
      return typeof value === 'number' ? String(value) : undefined;
    case 'date': {
      const date = parseDate(value);
      return date ? labels.formatDate(date) : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? (value ? labels.yes : labels.no) : undefined;
    case 'select':
      return rawPropertyValueAsOption(value)?.name;
    case 'multi_select':
      return joined(rawPropertyValueAsOptionArray(value).map(({ name }) => name));
    case 'user_relation':
      return joined(rawPropertyValueAsUserArray(value).map(({ name, email }) => name || email));
    case 'document_relation':
      return joined(rawPropertyValueAsRelatedDocumentArray(value).map(({ name }) => name));
    default:
      return undefined;
  }
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
      return text === undefined ? [] : [{ key: property.key, name: property.name, text }];
    });
}

// Properties worth a column: those with a value on at least one of the documents
export function getCustomPropertyColumnDefinitions({
  documents,
  labels,
}: {
  documents: Pick<Document, 'customProperties'>[];
  labels: CustomPropertyDisplayLabels;
}) {
  const definitionsByKey = new Map<string, { key: string; name: string; displayOrder: number }>();

  for (const document of documents) {
    for (const property of document.customProperties ?? []) {
      if (
        !definitionsByKey.has(property.key) &&
        formatCustomPropertyValue({ property, labels }) !== undefined
      ) {
        definitionsByKey.set(property.key, {
          key: property.key,
          name: property.name,
          displayOrder: property.displayOrder,
        });
      }
    }
  }

  return [...definitionsByKey.values()].toSorted((a, b) => a.displayOrder - b.displayOrder);
}
