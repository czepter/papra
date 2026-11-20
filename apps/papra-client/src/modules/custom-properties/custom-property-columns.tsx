import type { ColumnDef } from '@tanstack/solid-table';
import type { Document } from '@/modules/documents/documents.types';
import type {
  CustomPropertyColumnDefinition,
  CustomPropertyDisplayLabels,
} from './custom-property-display.models';
import { getCustomPropertySortField } from '@/modules/documents/document.models';
import { CustomPropertyValueLinks } from './components/custom-property-value-links.component';
import { getCustomPropertyValueItems } from './custom-property-display.models';

// The column id is the sort field, so the table sorting maps straight to the API
export function createCustomPropertyColumns({
  definitions,
  labels,
  getFilterHref,
}: {
  definitions: CustomPropertyColumnDefinition[];
  labels: CustomPropertyDisplayLabels;
  // Values link to this href when provided
  getFilterHref?: (term: string) => string;
}): ColumnDef<Document>[] {
  return definitions.map(({ key, name }): ColumnDef<Document> => ({
    id: getCustomPropertySortField({ key }),
    header: () => <span class="hidden sm:block">{name}</span>,
    accessorFn: (document) => document.customProperties?.find((property) => property.key === key),
    enableSorting: true,
    cell: (data) => {
      const property = data.getValue<NonNullable<Document['customProperties']>[number]>();
      const items = property ? getCustomPropertyValueItems({ property, labels }) : [];

      return (
        <span
          class="text-muted-foreground hidden sm:block max-w-48 truncate"
          title={items.map(({ text }) => text).join(', ')}
        >
          <CustomPropertyValueLinks items={items} getFilterHref={getFilterHref} />
        </span>
      );
    },
  }));
}
