import { describe, expect, test } from 'vitest';
import {
  applyViewEverywhere,
  defaultDocumentsViewPreferences,
  getSingleTagFromSearchQuery,
  hasTagViewOverride,
  parseStoredDocumentsViewPreferences,
  resolveDocumentsView,
  setDocumentsView,
} from './documents-view-preference.models';

describe('documents-view-preference models', () => {
  describe('getSingleTagFromSearchQuery', () => {
    test('returns the tag name when the query is only one tag filter', () => {
      expect(getSingleTagFromSearchQuery({ query: 'tag:invoices' })).toBe('invoices');
      expect(getSingleTagFromSearchQuery({ query: 'tag:"tax 2024"' })).toBe('tax 2024');
      expect(getSingleTagFromSearchQuery({ query: '  tag:invoices ' })).toBe('invoices');
    });

    test('returns undefined for anything else', () => {
      expect(getSingleTagFromSearchQuery({ query: '' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'invoice' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'tag:a tag:b' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'tag:a invoice' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'tag:a OR tag:b' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'NOT tag:a' })).toBeUndefined();
      expect(getSingleTagFromSearchQuery({ query: 'name:report' })).toBeUndefined();
    });
  });

  describe('resolveDocumentsView', () => {
    const preferences = { defaultView: 'list', tagViews: { invoices: 'grid' } } as const;

    test('uses the default view without a tag or without an override', () => {
      expect(resolveDocumentsView({ preferences })).toBe('list');
      expect(resolveDocumentsView({ preferences, tagName: 'receipts' })).toBe('list');
    });

    test('uses the tag override, ignoring case', () => {
      expect(resolveDocumentsView({ preferences, tagName: 'Invoices' })).toBe('grid');
    });
  });

  describe('setDocumentsView', () => {
    test('changes the default view when not filtered by a tag', () => {
      expect(
        setDocumentsView({ preferences: defaultDocumentsViewPreferences, view: 'grid' }),
      ).toEqual({ defaultView: 'grid', tagViews: {} });
    });

    test('creates an override for the tag only when filtered by a tag', () => {
      const result = setDocumentsView({
        preferences: defaultDocumentsViewPreferences,
        tagName: 'Invoices',
        view: 'grid',
      });

      expect(result).toEqual({ defaultView: 'list', tagViews: { invoices: 'grid' } });
      expect(hasTagViewOverride({ preferences: result, tagName: 'invoices' })).toBe(true);
    });

    test('drops the override when it is set back to the default view', () => {
      const result = setDocumentsView({
        preferences: { defaultView: 'list', tagViews: { invoices: 'grid', other: 'grid' } },
        tagName: 'invoices',
        view: 'list',
      });

      expect(result).toEqual({ defaultView: 'list', tagViews: { other: 'grid' } });
    });
  });

  describe('applyViewEverywhere', () => {
    test('sets the default and removes the override of the tag', () => {
      expect(
        applyViewEverywhere({
          preferences: { defaultView: 'list', tagViews: { invoices: 'grid', other: 'list' } },
          tagName: 'invoices',
          view: 'grid',
        }),
      ).toEqual({ defaultView: 'grid', tagViews: { other: 'list' } });
    });
  });

  describe('parseStoredDocumentsViewPreferences', () => {
    test('falls back to the defaults for missing or corrupted values', () => {
      expect(parseStoredDocumentsViewPreferences({ raw: null })).toEqual(
        defaultDocumentsViewPreferences,
      );
      expect(parseStoredDocumentsViewPreferences({ raw: 'not json' })).toEqual(
        defaultDocumentsViewPreferences,
      );
      expect(parseStoredDocumentsViewPreferences({ raw: '42' })).toEqual(
        defaultDocumentsViewPreferences,
      );
    });

    test('keeps valid values and drops invalid ones', () => {
      expect(
        parseStoredDocumentsViewPreferences({
          raw: JSON.stringify({ defaultView: 'grid', tagViews: { a: 'list', b: 'masonry' } }),
        }),
      ).toEqual({ defaultView: 'grid', tagViews: { a: 'list' } });

      expect(
        parseStoredDocumentsViewPreferences({
          raw: JSON.stringify({ defaultView: 'nope', tagViews: 'x' }),
        }),
      ).toEqual(defaultDocumentsViewPreferences);
    });
  });
});
