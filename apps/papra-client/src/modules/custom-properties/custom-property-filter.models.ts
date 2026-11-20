import { parseSearchQuery } from '@papra/search-parser';

// Search fields handled before custom properties, a property with one of these keys can't be targeted by key
const RESERVED_SEARCH_FIELDS = new Set(['tag', 'name', 'content', 'created', 'date', 'has']);

const UNQUOTED_VALUE_REGEX = /^[\p{L}\p{N}][\p{L}\p{N}_.\-@]*$/u;

function quoteSearchValue({ value }: { value: string }) {
  if (UNQUOTED_VALUE_REGEX.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// The search term matching documents having this value for the property, e.g. `korrespondent:"Finanzamt Jena"`.
// What `value` must be depends on the property type, see getCustomPropertyValueItems.
export function buildCustomPropertyFilterTerm({
  key,
  value,
}: {
  key: string;
  value: string;
}): string | undefined {
  if (RESERVED_SEARCH_FIELDS.has(key) || value === '') {
    return undefined;
  }

  return `${key}:${quoteSearchValue({ value })}`;
}

// ANDs the term to the query, unless the query already requires it
export function addTermToSearchQuery({ query, term }: { query: string; term: string }) {
  const trimmedQuery = query.trim();

  if (trimmedQuery === '') {
    return term;
  }

  const { expression, issues } = parseSearchQuery({ query: trimmedQuery });

  // Can't reason about a broken query, keep it as the user typed it
  if (issues.length > 0) {
    return `${trimmedQuery} ${term}`;
  }

  const { expression: termExpression } = parseSearchQuery({ query: term });
  const requiredExpressions = expression.type === 'and' ? expression.operands : [expression];

  const isAlreadyRequired = requiredExpressions.some(
    (operand) =>
      operand.type === 'filter' &&
      termExpression.type === 'filter' &&
      operand.field.toLowerCase() === termExpression.field.toLowerCase() &&
      operand.operator === termExpression.operator &&
      operand.value === termExpression.value,
  );

  if (isAlreadyRequired) {
    return trimmedQuery;
  }

  // Without parentheses the term would only bind to the last alternative of an OR
  return expression.type === 'or' ? `(${trimmedQuery}) ${term}` : `${trimmedQuery} ${term}`;
}

export function makeDocumentsFilterHref({
  organizationId,
  query,
  term,
}: {
  organizationId: string;
  query: string;
  term: string;
}) {
  return `/organizations/${organizationId}/documents?query=${encodeURIComponent(addTermToSearchQuery({ query, term }))}`;
}
