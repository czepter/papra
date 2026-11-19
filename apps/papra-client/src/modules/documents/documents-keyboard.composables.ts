import type { Accessor } from 'solid-js';
import type { KeyboardShortcutContext } from './document-quick-look.models';
import type { DocumentsView } from './documents-view-preference.models';
import type { Document } from './documents.types';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  getFocusMoveForKey,
  getGridColumnCount,
  getNextFocusIndex,
  shouldHandleShortcut,
} from './document-quick-look.models';

export const DOCUMENT_ID_ATTRIBUTE = 'data-document-id';

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'];

export function getShortcutContext(
  event: KeyboardEvent,
  { ignoredOverlay }: { ignoredOverlay?: Element } = {},
): KeyboardShortcutContext {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  const isInput = target instanceof HTMLInputElement;
  const isNonTextInput = isInput && NON_TEXT_INPUT_TYPES.includes(target.type);

  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    defaultPrevented: event.defaultPrevented,
    isEditableTarget:
      target !== undefined &&
      !isNonTextInput &&
      (isInput ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable),
    isInteractiveTarget:
      target !== undefined &&
      (isNonTextInput ||
        target.closest(
          'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="combobox"]',
        ) !== null),
    hasOpenOverlay: Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(
      (overlay) => overlay !== ignoredOverlay,
    ),
  };
}

export function getDocumentElement({ documentId }: { documentId: string }) {
  return document.querySelector<HTMLElement>(
    `[${DOCUMENT_ID_ATTRIBUTE}="${CSS.escape(documentId)}"]`,
  );
}

// Focus highlight in the documents list and grid (j/k, and arrows in the grid) and Space to open quick look
// for the focused or hovered document. Pure decisions live in document-quick-look.models.
export function createDocumentsKeyboardNavigation({
  getDocuments,
  getView,
  isEnabled,
  onOpen,
}: {
  getDocuments: Accessor<Document[]>;
  getView: Accessor<DocumentsView>;
  isEnabled: Accessor<boolean>;
  onOpen: (document: Document) => void;
}) {
  const [getFocusedId, setFocusedId] = createSignal<string>();
  let hoveredId: string | undefined;
  let lastInput: 'pointer' | 'keyboard' = 'keyboard';

  createEffect(() => {
    const focusedId = getFocusedId();

    if (focusedId !== undefined && !getDocuments().some((document) => document.id === focusedId)) {
      setFocusedId(undefined);
    }
  });

  function focusDocument({ documentId }: { documentId: string }) {
    setFocusedId(documentId);

    const element = getDocumentElement({ documentId });

    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }

  function getColumnCount() {
    if (getView() !== 'grid') {
      return 1;
    }

    return getGridColumnCount({
      offsetTops: Array.from(
        document.querySelectorAll<HTMLElement>(`[${DOCUMENT_ID_ATTRIBUTE}]`),
      ).map((element) => element.offsetTop),
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isEnabled()) {
      return;
    }

    const documents = getDocuments();

    if (event.key === ' ') {
      if (
        !shouldHandleShortcut({
          context: getShortcutContext(event),
          allowOnInteractiveTarget: false,
        })
      ) {
        return;
      }

      const id =
        lastInput === 'pointer' ? (hoveredId ?? getFocusedId()) : (getFocusedId() ?? hoveredId);
      const document = documents.find((candidate) => candidate.id === id);

      if (document) {
        event.preventDefault();
        setFocusedId(document.id);
        onOpen(document);
      }

      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const move = getFocusMoveForKey({ key, view: getView() });

    if (!move || !shouldHandleShortcut({ context: getShortcutContext(event) })) {
      return;
    }

    const currentIndex = documents.findIndex((document) => document.id === getFocusedId());
    const nextIndex = getNextFocusIndex({
      index: currentIndex === -1 ? undefined : currentIndex,
      count: documents.length,
      move,
      columns: getColumnCount(),
    });
    const next = nextIndex === undefined ? undefined : documents[nextIndex];

    if (next) {
      event.preventDefault();
      lastInput = 'keyboard';
      focusDocument({ documentId: next.id });
    }
  }

  function onPointerOver(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      return;
    }

    const target = event.target instanceof Element ? event.target : undefined;

    hoveredId =
      target?.closest(`[${DOCUMENT_ID_ATTRIBUTE}]`)?.getAttribute(DOCUMENT_ID_ATTRIBUTE) ??
      undefined;
    lastInput = 'pointer';
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerover', onPointerOver);

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerover', onPointerOver);
    });
  });

  return { getFocusedId, setFocusedId, focusDocument };
}
