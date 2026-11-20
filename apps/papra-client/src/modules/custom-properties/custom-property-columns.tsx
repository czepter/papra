import type { ColumnDef } from '@tanstack/solid-table';
import type { Document } from '@/modules/documents/documents.types';
import type { CustomPropertyDisplayLabels } from './custom-property-display.models';
import {
  formatCustomPropertyValue,
  getCustomPropertyColumnDefinitions,
} from './custom-property-display.models';

// Columns follow the data: only properties set on at least one document of the page get one
export function createCustomPropertyColumns({
  documents,
  labels,
}: {
  documents: Document[];
  labels: CustomPropertyDisplayLabels;
}): ColumnDef<Document>[] {
  return getCustomPropertyColumnDefinitions({ documents, labels }).map(
    ({ key, name }): ColumnDef<Document> => ({
      id: `custom-property-${key}`,
      header: () => <span class="hidden sm:block">{name}</span>,
      accessorFn: (document) => document.customProperties?.find((property) => property.key === key),
      enableSorting: false,
      cell: (data) => {
        const property = data.getValue<NonNullable<Document['customProperties']>[number]>();
        const text = property ? formatCustomPropertyValue({ property, labels }) : undefined;

        return (
          <span class="text-muted-foreground hidden sm:block max-w-48 truncate" title={text}>
            {text}
          </span>
        );
      },
    }),
  );
}
