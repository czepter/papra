import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Database } from '../../../app/database/database.types';
import type {
  DocumentSearchBuiltInSortField,
  DocumentSearchSort,
} from '../document-search.constants';
import type { CustomPropertyDefinition } from './query-builder/query-builder.custom-properties';
import { parseSearchQuery } from '@papra/search-parser';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { documentCustomPropertyValuesTable } from '../../../custom-properties/custom-properties.table';
import { customPropertySelectOptionsTable } from '../../../custom-properties/options/custom-properties-options.table';
import { usersTable } from '../../../users/users.table';
import { documentsTable } from '../../documents.table';
import {
  DEFAULT_DOCUMENT_SEARCH_SORT,
  getCustomPropertyKeyFromSortField,
} from '../document-search.constants';
import { buildQueryFromExpression } from './query-builder/query-builder';

export function makeSearchWhereClause({
  query,
  organizationId,
  db,
  now = new Date(),
  customPropertyDefinitions = [],
}: {
  query: string;
  organizationId: string;
  db: Database;
  now?: Date;
  customPropertyDefinitions?: CustomPropertyDefinition[];
}) {
  const { expression, issues: parsedIssues } = parseSearchQuery({ query });

  const customPropertyDefinitionsByKey = Object.fromEntries(
    customPropertyDefinitions.map((definition) => [definition.key, definition]),
  );

  const { sqlQuery, issues } = buildQueryFromExpression({
    expression,
    organizationId,
    db,
    now,
    customPropertyDefinitionsByKey,
  });

  return {
    searchWhereClause: and(
      eq(documentsTable.organizationId, organizationId),
      eq(documentsTable.isDeleted, false),
      sqlQuery,
    ),
    issues: [...parsedIssues, ...issues],
  };
}

const sortableColumnsByField: Record<DocumentSearchBuiltInSortField, SQLiteColumn | SQL> = {
  createdAt: documentsTable.createdAt,
  updatedAt: documentsTable.updatedAt,
  name: sql`${documentsTable.name} COLLATE NOCASE`, // case-insensitive sorting for name
  documentDate: documentsTable.documentDate,
};

const relatedDocumentsTable = alias(documentsTable, 'related_documents');

// One comparable value per document: a correlated subquery over the property values, MIN() picks a representative one for multi-value properties
function getCustomPropertySortValue({ definition }: { definition: CustomPropertyDefinition }): SQL {
  const values = documentCustomPropertyValuesTable;
  const scope = sql`${values.documentId} = ${documentsTable.id} and ${values.propertyDefinitionId} = ${definition.id}`;

  switch (definition.type) {
    case 'text':
      return sql`(select min(${values.textValue}) from ${values} where ${scope}) COLLATE NOCASE`;
    case 'number':
      return sql`(select min(${values.numberValue}) from ${values} where ${scope})`;
    case 'date':
      return sql`(select min(${values.dateValue}) from ${values} where ${scope})`;
    case 'boolean':
      return sql`(select min(${values.booleanValue}) from ${values} where ${scope})`;
    case 'select':
    case 'multi_select':
      return sql`(select min(${customPropertySelectOptionsTable.name}) from ${values} inner join ${customPropertySelectOptionsTable} on ${customPropertySelectOptionsTable.id} = ${values.selectOptionId} where ${scope}) COLLATE NOCASE`;
    case 'user_relation':
      return sql`(select min(coalesce(nullif(${usersTable.name}, ''), ${usersTable.email})) from ${values} inner join ${usersTable} on ${usersTable.id} = ${values.userId} where ${scope}) COLLATE NOCASE`;
    case 'document_relation':
      return sql`(select min(${relatedDocumentsTable.name}) from ${values} inner join ${relatedDocumentsTable} on ${relatedDocumentsTable.id} = ${values.relatedDocumentId} where ${scope}) COLLATE NOCASE`;
    default:
      return sql`null`;
  }
}

export function makeSearchOrderByClauses({
  sort,
  customPropertyDefinitions = [],
}: {
  sort: DocumentSearchSort;
  customPropertyDefinitions?: CustomPropertyDefinition[];
}) {
  const orderDirection = sort.order === 'desc' ? desc : asc;
  const customPropertyKey = getCustomPropertyKeyFromSortField({ field: sort.field });

  if (customPropertyKey !== undefined) {
    const definition = customPropertyDefinitions.find(({ key }) => key === customPropertyKey);

    // Unknown (e.g. deleted) property: keep the list usable with the default sort field
    if (!definition) {
      return makeSearchOrderByClauses({
        sort: { field: DEFAULT_DOCUMENT_SEARCH_SORT.field, order: sort.order },
        customPropertyDefinitions,
      });
    }

    const sortColumn = getCustomPropertySortValue({ definition });

    return {
      orderByClauses: [
        // Documents without a value go last whatever the direction
        asc(sql`${sortColumn} is null`),
        orderDirection(sortColumn),
        orderDirection(documentsTable.createdAt),
        orderDirection(documentsTable.id),
      ],
      sortColumn,
    };
  }

  const sortColumn = sortableColumnsByField[sort.field as DocumentSearchBuiltInSortField];

  const orderByClauses = [
    orderDirection(sortColumn),
    ...(sort.field !== 'createdAt' ? [orderDirection(documentsTable.createdAt)] : []),
    orderDirection(documentsTable.id), // tie-breaker to ensure deterministic order
  ];

  return { orderByClauses, sortColumn };
}
