import type { ColumnDef } from '@tanstack/solid-table';
import type { Document } from '@/modules/documents/documents.types';
import type {
  CustomPropertyColumnDefinition,
  CustomPropertyDisplayLabels,
} from './custom-property-display.models';
import { getCustomPropertySortField } from '@/modules/documents/document.models';
import { formatCustomPropertyValue } from './custom-property-display.models';

// The column id is the sort field, so the table sorting maps straight to the API
export function createCustomPropertyColumns({
  definitions,
  labels,
}: {
  definitions: CustomPropertyColumnDefinition[];
  labels: CustomPropertyDisplayLabels;
}): ColumnDef<Document>[] {
  return definitions.map(({ key, name }): ColumnDef<Document> => ({
    id: getCustomPropertySortField({ key }),
    header: () => <span class="hidden sm:block">{name}</span>,
    accessorFn: (document) => document.customProperties?.find((property) => property.key === key),
    enableSorting: true,
    cell: (data) => {
      const property = data.getValue<NonNullable<Document['customProperties']>[number]>();
      const text = property ? formatCustomPropertyValue({ property, labels }) : undefined;

      return (
        <span class="text-muted-foreground hidden sm:block max-w-48 truncate" title={text}>
          {text}
        </span>
      );
    },
  }));
}
