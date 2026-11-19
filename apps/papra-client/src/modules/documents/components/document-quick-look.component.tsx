import type { Component } from 'solid-js';
import type { Document } from '../documents.types';
import { formatBytes } from '@corentinth/chisels';
import { useNavigate } from '@solidjs/router';
import { useQuery } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from 'solid-js';
import { RelativeTime } from '@/modules/i18n/components/RelativeTime';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { cn } from '@/modules/shared/style/cn';
import { DocumentTagsList } from '@/modules/tags/components/tag-list.component';
import { Button } from '@/modules/ui/components/button';
import { Dialog } from '@/modules/ui/components/dialog';
import { Skeleton } from '@/modules/ui/components/skeleton';
import { createDocumentPreview } from '../document-previews.composables';
import { getDocumentPreviewUrl } from '../document-previews.services';
import {
  buildMatchSnippets,
  countTermMatches,
  extractSearchTerms,
  getAdjacentIndex,
  getNeighbourIndexes,
  getTextLines,
  shouldHandleShortcut,
  splitTextByTerms,
} from '../document-quick-look.models';
import { getDocumentNameExtension } from '../document.models';
import { fetchDocument } from '../documents.services';
import { getDocumentElement, getShortcutContext } from '../documents-keyboard.composables';
import {
  invalidateOrganizationDocumentsQuery,
  useDownloadDocument,
} from '../documents.composables';
import { DocumentDatePicker } from './document-date-picker.component';
import { DocumentPreview } from './document-preview.component';
import { DocumentTypeTile } from './document-thumbnail.component';

const CONTENT_PREVIEW_LINES = 6;
const QUICK_LOOK_TAGS_ATTRIBUTE = 'data-quick-look-tags';
const QUICK_LOOK_DATE_ATTRIBUTE = 'data-quick-look-date';

const HighlightedText: Component<{ text: string; terms: string[] }> = (props) => (
  <For each={splitTextByTerms({ text: props.text, terms: props.terms })}>
    {(segment) => (
      <Show when={segment.isMatch} fallback={segment.text}>
        <mark class="rounded-sm bg-primary/35 px-0.5 text-foreground">{segment.text}</mark>
      </Show>
    )}
  </For>
);

const Kbd: Component<{ children: string }> = (props) => (
  <kbd class="inline-flex min-w-5 items-center justify-center rounded border bg-background px-1 font-mono text-[10px] leading-4">
    {props.children}
  </kbd>
);

const SectionHeading: Component<{ children: string }> = (props) => (
  <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
    {props.children}
  </h3>
);

const SHEET_CLASS = 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2),0_8px_30px_rgba(0,0,0,0.18)]';

// The preview image comes first (fast to flip through), the real PDF viewer is only loaded on request
const QuickLookViewer: Component<{ document: Document }> = (props) => {
  const { t } = useI18n();
  const { downloadDocument } = useDownloadDocument();
  const preview = createDocumentPreview({ getDocument: () => props.document, variant: 'preview' });
  const [getIsPdfViewerShown, setIsPdfViewerShown] = createSignal(false);

  const getIsPdf = () => props.document.mimeType === 'application/pdf';

  createEffect(
    on(
      () => props.document.id,
      () => setIsPdfViewerShown(false),
    ),
  );

  return (
    <Switch>
      <Match when={getIsPdfViewerShown()}>
        <div class="relative size-full">
          <div class={cn('size-full overflow-auto rounded', SHEET_CLASS)}>
            <DocumentPreview document={props.document} />
          </div>
          <Button
            variant="outline"
            size="sm"
            class="absolute right-4 top-3 shadow"
            onClick={() => setIsPdfViewerShown(false)}
          >
            <div class="i-tabler-arrow-back-up size-4 mr-1.5" />
            {t('documents.quick-look.show-preview')}
          </Button>
        </div>
      </Match>

      <Match when={preview.getState() === 'ready'}>
        <img
          src={preview.getUrl()}
          alt={t('documents.preview.alt', { name: props.document.name })}
          decoding="async"
          draggable={false}
          onError={preview.onImageError}
          class={cn('max-h-full max-w-full object-contain', SHEET_CLASS)}
        />

        <Show when={getIsPdf()}>
          <Button
            variant="outline"
            size="sm"
            class="absolute bottom-4 left-1/2 -translate-x-1/2 shadow"
            onClick={() => setIsPdfViewerShown(true)}
          >
            <div class="i-tabler-files size-4 mr-1.5" />
            {t('documents.quick-look.show-all-pages')}
          </Button>
        </Show>
      </Match>

      <Match when={preview.getState() === 'loading'}>
        <Skeleton class={cn('aspect-[1/1.414] h-full max-h-full rounded-sm', SHEET_CLASS)} />
      </Match>

      <Match when={preview.getState() === 'unavailable'}>
        <div class="flex max-w-sm flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-background/60 px-8 py-10 text-center">
          <div class="size-20 overflow-hidden rounded-xl shadow-sm">
            <DocumentTypeTile document={props.document} size="lg" />
          </div>
          <p class="font-semibold">{t('documents.preview.no-preview')}</p>
          <p class="text-sm text-muted-foreground">
            {t('documents.quick-look.no-preview.description')}
          </p>
          <div class="flex gap-2">
            <Button
              size="sm"
              onClick={async () =>
                downloadDocument({
                  organizationId: props.document.organizationId,
                  documentId: props.document.id,
                })
              }
            >
              <div class="i-tabler-download size-4 mr-1.5" />
              {t('documents.quick-look.download')}
            </Button>

            <Show when={getIsPdf()}>
              <Button variant="outline" size="sm" onClick={() => setIsPdfViewerShown(true)}>
                <div class="i-tabler-files size-4 mr-1.5" />
                {t('documents.quick-look.show-all-pages')}
              </Button>
            </Show>
          </div>
        </div>
      </Match>
    </Switch>
  );
};

const QuickLookSidePanel: Component<{
  document: Document;
  // Full extracted content, lists only carry an excerpt so it is loaded apart
  content: string | undefined;
  isContentLoading: boolean;
  terms: string[];
}> = (props) => {
  const { t } = useI18n();
  const [getIsExpanded, setIsExpanded] = createSignal(false);

  const getLines = () =>
    getTextLines({
      text: props.content ?? '',
      maxLines: getIsExpanded() ? undefined : CONTENT_PREVIEW_LINES,
    });
  const getSnippets = () => buildMatchSnippets({ text: props.content ?? '', terms: props.terms });

  return (
    <div class="flex flex-col gap-6 p-5">
      <section>
        <SectionHeading>{t('documents.quick-look.sections.details')}</SectionHeading>
        <dl class="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-muted-foreground">{t('documents.info.document-date')}</dt>
          <dd {...{ [QUICK_LOOK_DATE_ATTRIBUTE]: '' }}>
            <DocumentDatePicker
              document={props.document}
              organizationId={props.document.organizationId}
            />
          </dd>

          <dt class="text-muted-foreground">{t('documents.quick-look.added')}</dt>
          <dd>
            <RelativeTime date={props.document.createdAt} />
          </dd>

          <dt class="text-muted-foreground">{t('documents.info.size')}</dt>
          <dd>{formatBytes({ bytes: props.document.originalSize, base: 1000 })}</dd>
        </dl>
      </section>

      <section>
        <SectionHeading>{t('documents.quick-look.sections.tags')}</SectionHeading>
        <div {...{ [QUICK_LOOK_TAGS_ATTRIBUTE]: '' }}>
          <DocumentTagsList
            documentId={props.document.id}
            organizationId={props.document.organizationId}
            tags={props.document.tags}
            asLink
            onTagsSaved={() => {
              void invalidateOrganizationDocumentsQuery({
                organizationId: props.document.organizationId,
              });
            }}
          />
        </div>
      </section>

      <Show when={getSnippets().length > 0}>
        <section>
          <SectionHeading>{t('documents.quick-look.sections.matches')}</SectionHeading>
          <ul class="flex flex-col gap-2">
            <For each={getSnippets()}>
              {(snippet) => (
                <li class="break-words rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground/80">
                  <HighlightedText text={snippet} terms={props.terms} />
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section>
        <SectionHeading>{t('documents.quick-look.sections.content')}</SectionHeading>
        <Show
          when={!props.isContentLoading}
          fallback={
            <div class="flex flex-col gap-2" role="status" aria-busy="true">
              <Skeleton class="h-3 w-full" />
              <Skeleton class="h-3 w-11/12" />
              <Skeleton class="h-3 w-4/5" />
            </div>
          }
        >
          <Show
            when={getLines().lines.length > 0}
            fallback={
              <p class="text-sm text-muted-foreground">{t('documents.quick-look.no-content')}</p>
            }
          >
            <div class="flex flex-col gap-1 break-words text-xs leading-relaxed text-foreground/80">
              <For each={getLines().lines}>
                {(line) => (
                  <p>
                    <HighlightedText text={line} terms={props.terms} />
                  </p>
                )}
              </For>
            </div>

            <Show when={getLines().hasMore || getIsExpanded()}>
              <Button
                variant="link"
                size="sm"
                class="mt-1 h-auto p-0 text-xs"
                onClick={() => setIsExpanded((value) => !value)}
              >
                {getIsExpanded()
                  ? t('documents.quick-look.show-less')
                  : t('documents.quick-look.show-full-text')}
              </Button>
            </Show>
          </Show>
        </Show>
      </section>
    </div>
  );
};

// Large overlay over the documents list or grid, to check and file documents without leaving the list.
// Navigation stays within the documents of the current page of results.
export const DocumentQuickLook: Component<{
  documents: Document[];
  // Id of the document shown, the overlay is closed when undefined
  documentId: string | undefined;
  // Free-text search of the page, its terms are highlighted in the extracted text
  searchQuery: string;
  onDocumentChange: (documentId: string) => void;
  onClose: () => void;
}> = (props) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { downloadDocument } = useDownloadDocument();
  // oxlint-disable-next-line no-unassigned-vars -- assigned via Solid ref binding in JSX
  let contentRef: HTMLDivElement | undefined;
  let lastDocumentId: string | undefined;

  // Keeps rendering the last document while the closing animation plays
  const getDocument = createMemo<Document | undefined>((previous) =>
    props.documentId === undefined
      ? previous
      : props.documents.find((document) => document.id === props.documentId),
  );
  const getIndex = () => props.documents.findIndex((document) => document.id === props.documentId);
  const getTerms = createMemo(() => extractSearchTerms({ query: props.searchQuery }));

  // Lists only carry an excerpt of the content, the full text is loaded with the document (same query as the document page, so the cache is shared)
  const documentQuery = useQuery(() => {
    const document = getDocument();

    return {
      queryKey: ['organizations', document?.organizationId, 'documents', document?.id],
      queryFn: async () =>
        fetchDocument({
          documentId: document?.id as string,
          organizationId: document?.organizationId as string,
        }),
      enabled: props.documentId !== undefined && document !== undefined,
    };
  });
  const getContent = () => documentQuery.data?.document.content;
  const getMatchCount = () => countTermMatches({ text: getContent() ?? '', terms: getTerms() });

  // The document disappeared from the page (page change, deletion, new search)
  createEffect(() => {
    if (props.documentId !== undefined && getIndex() === -1) {
      props.onClose();
    }
  });

  createEffect(() => {
    const index = getIndex();

    if (props.documentId !== undefined) {
      lastDocumentId = props.documentId;
    }

    if (index === -1) {
      return;
    }

    // Warm the cache so flipping to the neighbours is instant
    for (const neighbourIndex of getNeighbourIndexes({ index, count: props.documents.length })) {
      const neighbour = props.documents[neighbourIndex];

      if (neighbour?.previewStatus === 'ready') {
        new Image().src = getDocumentPreviewUrl({
          organizationId: neighbour.organizationId,
          documentId: neighbour.id,
          variant: 'preview',
        });
      }
    }
  });

  function getAdjacentDocument(direction: 'previous' | 'next') {
    const index = getAdjacentIndex({ index: getIndex(), count: props.documents.length, direction });

    return index === undefined ? undefined : props.documents[index];
  }

  function go(direction: 'previous' | 'next') {
    const adjacent = getAdjacentDocument(direction);

    if (adjacent) {
      props.onDocumentChange(adjacent.id);
    }
  }

  function openDocument() {
    const document = getDocument();

    if (!document) {
      return;
    }

    props.onClose();
    navigate(`/organizations/${document.organizationId}/documents/${document.id}`);
  }

  function focusControl({ attribute }: { attribute: string }) {
    contentRef?.querySelector<HTMLElement>(`[${attribute}] button`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    // Events of the date and tag popovers bubble up from their portals, they keep their own keys
    if (!contentRef || !(event.target instanceof Node) || !contentRef.contains(event.target)) {
      return;
    }

    const context = getShortcutContext(event, { ignoredOverlay: contentRef });
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (shouldHandleShortcut({ context })) {
        event.preventDefault();
        go(key === 'ArrowLeft' ? 'previous' : 'next');
      }
    } else if (key === ' ' || key === 'Enter') {
      if (shouldHandleShortcut({ context, allowOnInteractiveTarget: false })) {
        event.preventDefault();

        if (key === ' ') {
          props.onClose();
        } else {
          openDocument();
        }
      }
    } else if (key === 't' || key === 'd') {
      if (shouldHandleShortcut({ context })) {
        event.preventDefault();
        focusControl({
          attribute: key === 't' ? QUICK_LOOK_TAGS_ATTRIBUTE : QUICK_LOOK_DATE_ATTRIBUTE,
        });
      }
    }
  }

  const navButtonClass = 'size-8';

  return (
    <Dialog
      open={props.documentId !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          props.onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[expanded]:(animate-in fade-in-0) data-[closed]:(animate-out fade-out-0)" />

        <Show when={getDocument()}>
          {(getCurrentDocument) => (
            <Dialog.Content
              ref={contentRef}
              aria-label={t('documents.quick-look.label', { name: getCurrentDocument().name })}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              onOpenAutoFocus={(event) => {
                // Focus the dialog itself: the key that opened it must not activate a button on key up
                event.preventDefault();
                contentRef?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                (lastDocumentId
                  ? getDocumentElement({ documentId: lastDocumentId })
                  : null
                )?.focus();
              }}
              class="fixed inset-0 z-50 flex flex-col overflow-hidden border bg-background text-foreground shadow-2xl outline-none md:(inset-x-[44px] inset-y-[28px] rounded-xl) data-[expanded]:(animate-in fade-in-0 zoom-in-95 duration-150) data-[closed]:(animate-out fade-out-0 zoom-out-95 duration-100)"
            >
              <header class="flex h-[60px] shrink-0 items-center gap-3 border-b px-4">
                <div class="size-9 shrink-0 overflow-hidden rounded-md">
                  <DocumentTypeTile document={getCurrentDocument()} size="sm" />
                </div>

                <div class="min-w-0 flex-1">
                  <h2 class="truncate text-sm font-bold" title={getCurrentDocument().name}>
                    {getCurrentDocument().name}
                  </h2>
                  <p class="truncate text-xs text-muted-foreground">
                    {[
                      getDocumentNameExtension({ name: getCurrentDocument().name })?.toUpperCase(),
                      formatBytes({ bytes: getCurrentDocument().originalSize, base: 1000 }),
                      getTerms().length > 0 && getMatchCount() > 0
                        ? t('documents.quick-look.match-count', {
                            count: getMatchCount(),
                            query: getTerms().join(' '),
                          })
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                <div class="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    class={navButtonClass}
                    aria-label={t('documents.quick-look.previous')}
                    disabled={getAdjacentDocument('previous') === undefined}
                    onClick={() => go('previous')}
                  >
                    <div class="i-tabler-chevron-left size-4" />
                  </Button>
                  <span class="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
                    {t('documents.quick-look.position', {
                      index: getIndex() + 1,
                      count: props.documents.length,
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    class={navButtonClass}
                    aria-label={t('documents.quick-look.next')}
                    disabled={getAdjacentDocument('next') === undefined}
                    onClick={() => go('next')}
                  >
                    <div class="i-tabler-chevron-right size-4" />
                  </Button>
                </div>

                <div class="hidden h-5 w-px bg-border sm:block" />

                <Button
                  variant="outline"
                  class="size-8 p-0 sm:h-8 sm:w-auto sm:px-3 sm:text-xs"
                  aria-label={t('documents.quick-look.open')}
                  onClick={openDocument}
                >
                  <div class="i-tabler-external-link size-4 sm:hidden" />
                  <span class="hidden sm:inline">{t('documents.quick-look.open')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class={navButtonClass}
                  aria-label={t('documents.quick-look.download')}
                  title={t('documents.quick-look.download')}
                  onClick={async () =>
                    downloadDocument({
                      organizationId: getCurrentDocument().organizationId,
                      documentId: getCurrentDocument().id,
                    })
                  }
                >
                  <div class="i-tabler-download size-4" />
                </Button>
                <Dialog.CloseButton
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent/50 focus-visible:(outline-none ring-1.5 ring-ring)"
                  aria-label={t('documents.quick-look.close')}
                >
                  <div class="i-tabler-x size-4" />
                </Dialog.CloseButton>
              </header>

              <div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
                <div class="relative flex h-[60vh] shrink-0 items-center justify-center bg-muted/60 p-4 md:h-auto md:min-w-0 md:flex-1 md:p-8">
                  <QuickLookViewer document={getCurrentDocument()} />

                  <Button
                    variant="outline"
                    size="icon"
                    class="absolute left-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 rounded-full shadow-md md:inline-flex"
                    aria-label={t('documents.quick-look.previous')}
                    disabled={getAdjacentDocument('previous') === undefined}
                    onClick={() => go('previous')}
                  >
                    <div class="i-tabler-chevron-left size-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    class="absolute right-3 top-1/2 z-10 hidden size-10 -translate-y-1/2 rounded-full shadow-md md:inline-flex"
                    aria-label={t('documents.quick-look.next')}
                    disabled={getAdjacentDocument('next') === undefined}
                    onClick={() => go('next')}
                  >
                    <div class="i-tabler-chevron-right size-5" />
                  </Button>
                </div>

                <aside class="shrink-0 border-t md:w-[340px] md:overflow-y-auto md:border-l md:border-t-0">
                  <Show when={getCurrentDocument().id} keyed>
                    <QuickLookSidePanel
                      document={getCurrentDocument()}
                      content={getContent()}
                      isContentLoading={documentQuery.isPending}
                      terms={getTerms()}
                    />
                  </Show>
                </aside>
              </div>

              <footer class="hidden h-[42px] shrink-0 items-center gap-5 border-t px-4 text-xs text-muted-foreground md:flex">
                <span class="flex items-center gap-1.5">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                  {t('documents.quick-look.hints.navigate')}
                </span>
                <span class="flex items-center gap-1.5">
                  <Kbd>T</Kbd>
                  {t('documents.quick-look.hints.tag')}
                </span>
                <span class="flex items-center gap-1.5">
                  <Kbd>D</Kbd>
                  {t('documents.quick-look.hints.date')}
                </span>
                <span class="flex items-center gap-1.5">
                  <Kbd>Enter</Kbd>
                  {t('documents.quick-look.hints.open')}
                </span>
                <span class="flex items-center gap-1.5">
                  <Kbd>Esc</Kbd>
                  {t('documents.quick-look.hints.close')}
                </span>
              </footer>
            </Dialog.Content>
          )}
        </Show>
      </Dialog.Portal>
    </Dialog>
  );
};
