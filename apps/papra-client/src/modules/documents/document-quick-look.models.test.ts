import { describe, expect, test } from 'vitest';
import {
  buildMatchSnippets,
  countTermMatches,
  extractSearchTerms,
  getAdjacentIndex,
  getFocusMoveForKey,
  getGridColumnCount,
  getNeighbourIndexes,
  getNextFocusIndex,
  getTextLines,
  shouldHandleShortcut,
  splitTextByTerms,
} from './document-quick-look.models';

const baseContext = {
  key: ' ',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isEditableTarget: false,
  isInteractiveTarget: false,
  hasOpenOverlay: false,
};

describe('document-quick-look models', () => {
  describe('extractSearchTerms', () => {
    test('returns the text terms and keeps quoted phrases whole', () => {
      expect(extractSearchTerms({ query: 'invoice "acme corp"' })).toEqual([
        'invoice',
        'acme corp',
      ]);
    });

    test('skips filters and negated terms', () => {
      expect(extractSearchTerms({ query: 'tag:invoices foo -bar NOT baz' })).toEqual(['foo']);
      expect(extractSearchTerms({ query: 'tag:invoices' })).toEqual([]);
    });

    test('keeps terms of both sides of an or and drops duplicates', () => {
      expect(extractSearchTerms({ query: 'foo OR Foo OR bar' })).toEqual(['foo', 'bar']);
    });

    test('an empty query has no terms', () => {
      expect(extractSearchTerms({ query: '   ' })).toEqual([]);
    });
  });

  describe('splitTextByTerms', () => {
    test('flags the matching segments, ignoring the case', () => {
      expect(splitTextByTerms({ text: 'Total Invoice due', terms: ['invoice'] })).toEqual([
        { text: 'Total ', isMatch: false },
        { text: 'Invoice', isMatch: true },
        { text: ' due', isMatch: false },
      ]);
    });

    test('prefers the longest term at a position and escapes regexp characters', () => {
      expect(splitTextByTerms({ text: 'a.b foo bar', terms: ['foo', 'foo bar', 'a.b'] })).toEqual([
        { text: 'a.b', isMatch: true },
        { text: ' ', isMatch: false },
        { text: 'foo bar', isMatch: true },
      ]);
      expect(splitTextByTerms({ text: 'axb', terms: ['a.b'] })).toEqual([
        { text: 'axb', isMatch: false },
      ]);
    });

    test('without terms or text, nothing is highlighted', () => {
      expect(splitTextByTerms({ text: 'hello', terms: [] })).toEqual([
        { text: 'hello', isMatch: false },
      ]);
      expect(splitTextByTerms({ text: '', terms: ['a'] })).toEqual([]);
    });
  });

  test('countTermMatches counts every occurrence', () => {
    expect(countTermMatches({ text: 'foo bar Foo', terms: ['foo'] })).toBe(2);
    expect(countTermMatches({ text: 'foo', terms: [] })).toBe(0);
  });

  describe('buildMatchSnippets', () => {
    test('builds ellipsized excerpts around matches', () => {
      const text = `${'lorem '.repeat(20)}needle ${'ipsum '.repeat(20)}`;
      const [snippet, ...others] = buildMatchSnippets({ text, terms: ['needle'], radius: 10 });

      expect(others).toEqual([]);
      expect(snippet).toBe('…rem lorem needle ipsum ips…');
    });

    test('caps the number of snippets and merges close matches', () => {
      const text = Array.from({ length: 10 }, () => `needle ${'x '.repeat(50)}`).join('');

      expect(
        buildMatchSnippets({ text, terms: ['needle'], maxSnippets: 3, radius: 5 }),
      ).toHaveLength(3);
      expect(buildMatchSnippets({ text: 'needle needle', terms: ['needle'] })).toHaveLength(1);
    });

    test('returns nothing without a match', () => {
      expect(buildMatchSnippets({ text: 'hello', terms: ['x'] })).toEqual([]);
      expect(buildMatchSnippets({ text: 'hello', terms: [] })).toEqual([]);
    });
  });

  describe('getTextLines', () => {
    test('drops blank lines and truncates', () => {
      expect(getTextLines({ text: 'a\n\n b \nc\nd', maxLines: 2 })).toEqual({
        lines: ['a', 'b'],
        hasMore: true,
      });
      expect(getTextLines({ text: 'a\nb', maxLines: 2 })).toEqual({
        lines: ['a', 'b'],
        hasMore: false,
      });
      expect(getTextLines({ text: 'a\nb\nc' }).lines).toHaveLength(3);
    });
  });

  describe('index navigation bounds', () => {
    test('getAdjacentIndex stops at the edges', () => {
      expect(getAdjacentIndex({ index: 0, count: 3, direction: 'previous' })).toBeUndefined();
      expect(getAdjacentIndex({ index: 0, count: 3, direction: 'next' })).toBe(1);
      expect(getAdjacentIndex({ index: 2, count: 3, direction: 'next' })).toBeUndefined();
      expect(getAdjacentIndex({ index: 2, count: 3, direction: 'previous' })).toBe(1);
    });

    test('getNeighbourIndexes lists the existing neighbours', () => {
      expect(getNeighbourIndexes({ index: 0, count: 1 })).toEqual([]);
      expect(getNeighbourIndexes({ index: 0, count: 3 })).toEqual([1]);
      expect(getNeighbourIndexes({ index: 1, count: 3 })).toEqual([2, 0]);
    });

    test('getNextFocusIndex starts at the first item and clamps', () => {
      expect(getNextFocusIndex({ index: undefined, count: 3, move: 'next' })).toBe(0);
      expect(getNextFocusIndex({ index: 0, count: 0, move: 'next' })).toBeUndefined();
      expect(getNextFocusIndex({ index: 2, count: 3, move: 'next' })).toBe(2);
      expect(getNextFocusIndex({ index: 0, count: 3, move: 'previous' })).toBe(0);
      expect(getNextFocusIndex({ index: 1, count: 3, move: 'next' })).toBe(2);
    });

    test('getNextFocusIndex moves by a row in a grid', () => {
      expect(getNextFocusIndex({ index: 1, count: 10, move: 'down', columns: 4 })).toBe(5);
      expect(getNextFocusIndex({ index: 8, count: 10, move: 'down', columns: 4 })).toBe(9);
      expect(getNextFocusIndex({ index: 5, count: 10, move: 'up', columns: 4 })).toBe(1);
      expect(getNextFocusIndex({ index: 2, count: 10, move: 'up', columns: 4 })).toBe(0);
    });

    test('getGridColumnCount counts the items of the first row', () => {
      expect(getGridColumnCount({ offsetTops: [0, 0, 0, 200, 200] })).toBe(3);
      expect(getGridColumnCount({ offsetTops: [] })).toBe(1);
    });

    test('getFocusMoveForKey maps j/k in the list, and arrows in the grid too', () => {
      expect(getFocusMoveForKey({ key: 'j', view: 'list' })).toBe('next');
      expect(getFocusMoveForKey({ key: 'k', view: 'list' })).toBe('previous');
      expect(getFocusMoveForKey({ key: 'ArrowDown', view: 'list' })).toBeUndefined();
      expect(getFocusMoveForKey({ key: 'ArrowDown', view: 'grid' })).toBe('down');
      expect(getFocusMoveForKey({ key: 'ArrowLeft', view: 'grid' })).toBe('previous');
    });
  });

  describe('shouldHandleShortcut', () => {
    test('handles a plain key', () => {
      expect(shouldHandleShortcut({ context: baseContext })).toBe(true);
    });

    test('does not hijack typing, modifiers, handled events or open overlays', () => {
      expect(shouldHandleShortcut({ context: { ...baseContext, isEditableTarget: true } })).toBe(
        false,
      );
      expect(shouldHandleShortcut({ context: { ...baseContext, ctrlKey: true } })).toBe(false);
      expect(shouldHandleShortcut({ context: { ...baseContext, metaKey: true } })).toBe(false);
      expect(shouldHandleShortcut({ context: { ...baseContext, altKey: true } })).toBe(false);
      expect(shouldHandleShortcut({ context: { ...baseContext, shiftKey: true } })).toBe(false);
      expect(shouldHandleShortcut({ context: { ...baseContext, defaultPrevented: true } })).toBe(
        false,
      );
      expect(shouldHandleShortcut({ context: { ...baseContext, hasOpenOverlay: true } })).toBe(
        false,
      );
    });

    test('leaves interactive targets alone only when asked to', () => {
      const context = { ...baseContext, isInteractiveTarget: true };

      expect(shouldHandleShortcut({ context })).toBe(true);
      expect(shouldHandleShortcut({ context, allowOnInteractiveTarget: false })).toBe(false);
    });
  });
});
