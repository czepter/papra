import type { Expression } from '@papra/search-parser';
import { parseSearchQuery } from '@papra/search-parser';

// Plain-text terms of a search query: filters (`tag:`) and negated terms are skipped, quoted phrases stay whole
export function extractSearchTerms({ query }: { query: string }): string[] {
  if (query.trim() === '') {
    return [];
  }

  const terms: string[] = [];

  function visit(expression: Expression) {
    switch (expression.type) {
      case 'text': {
        terms.push(expression.value.trim());
        break;
      }
      case 'and':
      case 'or': {
        expression.operands.forEach(visit);
        break;
      }
      default: {
        // filter, not and empty carry nothing to highlight
        break;
      }
    }
  }

  visit(parseSearchQuery({ query }).expression);

  const seen = new Set<string>();

  return terms.filter((term) => {
    const key = term.toLowerCase();

    if (term === '' || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function escapeRegExp({ value }: { value: string }) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest terms first, so that "foo bar" wins over "foo" at the same position
function createTermsRegExp({ terms }: { terms: string[] }) {
  const alternatives = terms
    .filter((term) => term !== '')
    .toSorted((a, b) => b.length - a.length)
    .map((term) => escapeRegExp({ value: term }));

  return alternatives.length === 0 ? undefined : new RegExp(alternatives.join('|'), 'giu');
}

export type TextSegment = { text: string; isMatch: boolean };

// Cuts a text into consecutive segments, flagging the ones matching a term (case insensitive)
export function splitTextByTerms({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}): TextSegment[] {
  const regExp = createTermsRegExp({ terms });

  if (!regExp || text === '') {
    return text === '' ? [] : [{ text, isMatch: false }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(regExp)) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), isMatch: false });
    }

    segments.push({ text: match[0], isMatch: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }

  return segments;
}

export function countTermMatches({ text, terms }: { text: string; terms: string[] }) {
  return splitTextByTerms({ text, terms }).filter((segment) => segment.isMatch).length;
}

// Short excerpts of the text around the matches, whitespace collapsed. Matches close to a previous
// snippet are merged into it rather than repeated.
export function buildMatchSnippets({
  text,
  terms,
  maxSnippets = 5,
  radius = 40,
}: {
  text: string;
  terms: string[];
  maxSnippets?: number;
  radius?: number;
}): string[] {
  const regExp = createTermsRegExp({ terms });

  if (!regExp) {
    return [];
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  const snippets: string[] = [];
  let lastEnd = -1;

  for (const match of normalized.matchAll(regExp)) {
    if (snippets.length >= maxSnippets) {
      break;
    }

    if (match.index < lastEnd) {
      continue;
    }

    const start = Math.max(0, match.index - radius);
    const end = Math.min(normalized.length, match.index + match[0].length + radius);

    snippets.push(
      `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? '…' : ''}`,
    );
    lastEnd = end;
  }

  return snippets;
}

// First lines of a text (blank lines dropped), and whether more are hidden
export function getTextLines({ text, maxLines }: { text: string; maxLines?: number }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (maxLines === undefined || lines.length <= maxLines) {
    return { lines, hasMore: false };
  }

  return { lines: lines.slice(0, maxLines), hasMore: true };
}

// Index of the neighbour document, undefined at the edges of the page (no wrap, no pagination)
export function getAdjacentIndex({
  index,
  count,
  direction,
}: {
  index: number;
  count: number;
  direction: 'previous' | 'next';
}) {
  const target = direction === 'next' ? index + 1 : index - 1;

  return target >= 0 && target < count ? target : undefined;
}

export function getNeighbourIndexes({ index, count }: { index: number; count: number }) {
  return [
    getAdjacentIndex({ index, count, direction: 'next' }),
    getAdjacentIndex({ index, count, direction: 'previous' }),
  ].filter((value): value is number => value !== undefined);
}

export type KeyboardShortcutContext = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  // Typing in an input, textarea, select or contenteditable
  isEditableTarget: boolean;
  // A button, link, checkbox, etc. that reacts to Space or Enter itself
  isInteractiveTarget: boolean;
  // Another dialog, menu or listbox is open
  hasOpenOverlay: boolean;
};

// Shortcuts never hijack typing, modified keys (browser and OS shortcuts), other overlays or handled events.
// Space and Enter also leave focused buttons and links alone, as they activate them.
export function shouldHandleShortcut({
  context,
  allowOnInteractiveTarget = true,
}: {
  context: KeyboardShortcutContext;
  allowOnInteractiveTarget?: boolean;
}) {
  if (context.defaultPrevented || context.hasOpenOverlay || context.isEditableTarget) {
    return false;
  }

  if (context.ctrlKey || context.metaKey || context.altKey || context.shiftKey) {
    return false;
  }

  return allowOnInteractiveTarget || !context.isInteractiveTarget;
}

export type FocusMove = 'previous' | 'next' | 'up' | 'down';

// Keyboard focus in the documents list or grid. Nothing focused yet: the first move lands on the first item.
export function getNextFocusIndex({
  index,
  count,
  move,
  columns = 1,
}: {
  index: number | undefined;
  count: number;
  move: FocusMove;
  columns?: number;
}) {
  if (count === 0) {
    return undefined;
  }

  if (index === undefined || index < 0 || index >= count) {
    return 0;
  }

  const step = move === 'previous' ? -1 : move === 'next' ? 1 : (move === 'up' ? -1 : 1) * columns;

  return Math.min(count - 1, Math.max(0, index + step));
}

// Number of columns of a grid, from the top offset of each item (items of the first row share the same one)
export function getGridColumnCount({ offsetTops }: { offsetTops: number[] }) {
  const [first] = offsetTops;

  if (first === undefined) {
    return 1;
  }

  return Math.max(1, offsetTops.filter((top) => top === first).length);
}

type ShortcutKeyMap = Record<string, FocusMove>;

const LIST_FOCUS_KEYS: ShortcutKeyMap = { j: 'next', k: 'previous' };
const GRID_FOCUS_KEYS: ShortcutKeyMap = {
  ...LIST_FOCUS_KEYS,
  ArrowRight: 'next',
  ArrowLeft: 'previous',
  ArrowDown: 'down',
  ArrowUp: 'up',
};

export function getFocusMoveForKey({ key, view }: { key: string; view: 'list' | 'grid' }) {
  return (view === 'grid' ? GRID_FOCUS_KEYS : LIST_FOCUS_KEYS)[key];
}
