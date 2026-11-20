import { describe, expect, test } from 'vitest';
import {
  addTermToSearchQuery,
  buildCustomPropertyFilterTerm,
  makeDocumentsFilterHref,
} from './custom-property-filter.models';

describe('custom-property-filter models', () => {
  describe('buildCustomPropertyFilterTerm', () => {
    test('simple values are left unquoted', () => {
      expect(buildCustomPropertyFilterTerm({ key: 'dokumenttyp', value: 'Rechnung' })).to.equal(
        'dokumenttyp:Rechnung',
      );
      expect(buildCustomPropertyFilterTerm({ key: 'amount', value: '12.5' })).to.equal(
        'amount:12.5',
      );
      expect(buildCustomPropertyFilterTerm({ key: 'sender', value: 'Müller' })).to.equal(
        'sender:Müller',
      );
    });

    test('values with spaces, quotes, colons, parentheses or a leading operator are quoted and escaped', () => {
      expect(
        buildCustomPropertyFilterTerm({ key: 'korrespondent', value: 'Finanzamt Jena' }),
      ).to.equal('korrespondent:"Finanzamt Jena"');
      expect(buildCustomPropertyFilterTerm({ key: 'k', value: 'say "hi"\\' })).to.equal(
        'k:"say \\"hi\\"\\\\"',
      );
      expect(
        buildCustomPropertyFilterTerm({ key: 'k', value: '2026-01-01T00:00:00.000Z' }),
      ).to.equal('k:"2026-01-01T00:00:00.000Z"');
      expect(buildCustomPropertyFilterTerm({ key: 'k', value: 'a (b)' })).to.equal('k:"a (b)"');
      expect(buildCustomPropertyFilterTerm({ key: 'k', value: '>=3' })).to.equal('k:">=3"');
    });

    test('there is no term for an empty value or a key shadowed by a built-in search field', () => {
      expect(buildCustomPropertyFilterTerm({ key: 'k', value: '' })).to.equal(undefined);
      expect(buildCustomPropertyFilterTerm({ key: 'tag', value: 'x' })).to.equal(undefined);
      expect(buildCustomPropertyFilterTerm({ key: 'name', value: 'x' })).to.equal(undefined);
    });
  });

  describe('addTermToSearchQuery', () => {
    test('an empty query becomes the term', () => {
      expect(addTermToSearchQuery({ query: '', term: 'a:1' })).to.equal('a:1');
      expect(addTermToSearchQuery({ query: '  ', term: 'a:1' })).to.equal('a:1');
    });

    test('the term is ANDed to the existing query', () => {
      expect(addTermToSearchQuery({ query: 'invoice tag:tax', term: 'a:"x y"' })).to.equal(
        'invoice tag:tax a:"x y"',
      );
    });

    test('an OR query is wrapped so the term applies to every alternative', () => {
      expect(addTermToSearchQuery({ query: 'tag:a OR tag:b', term: 'k:1' })).to.equal(
        '(tag:a OR tag:b) k:1',
      );
    });

    test('a term already required by the query is not added twice', () => {
      expect(addTermToSearchQuery({ query: 'foo k:"x y"', term: 'k:"x y"' })).to.equal(
        'foo k:"x y"',
      );
      expect(addTermToSearchQuery({ query: 'k:x', term: 'k:x' })).to.equal('k:x');
    });

    test('a term only present in an alternative or negated is still added', () => {
      expect(addTermToSearchQuery({ query: 'k:x OR foo', term: 'k:x' })).to.equal(
        '(k:x OR foo) k:x',
      );
      expect(addTermToSearchQuery({ query: 'NOT k:x', term: 'k:x' })).to.equal('NOT k:x k:x');
    });

    test('a query with syntax issues is kept as is', () => {
      expect(addTermToSearchQuery({ query: 'foo "bar', term: 'k:1' })).to.equal('foo "bar k:1');
    });
  });

  describe('makeDocumentsFilterHref', () => {
    test('links to the documents page with the encoded combined query', () => {
      expect(
        makeDocumentsFilterHref({
          organizationId: 'org_1',
          query: 'tag:tax',
          term: 'korrespondent:"Finanzamt Jena"',
        }),
      ).to.equal(
        `/organizations/org_1/documents?query=${encodeURIComponent('tag:tax korrespondent:"Finanzamt Jena"')}`,
      );
    });
  });
});
