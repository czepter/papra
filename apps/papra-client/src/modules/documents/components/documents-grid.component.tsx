import type { Row } from '@tanstack/solid-table';
import type { Component } from 'solid-js';
import type { Document } from '../documents.types';
import { formatBytes } from '@corentinth/chisels';
import { A } from '@solidjs/router';
import { For, Match, Show, Switch } from 'solid-js';
import { RelativeTime } from '@/modules/i18n/components/RelativeTime';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { cn } from '@/modules/shared/style/cn';
import { TagLink } from '@/modules/tags/components/tag.component';
import { Checkbox, CheckboxControl } from '@/modules/ui/components/checkbox';
import { Skeleton } from '@/modules/ui/components/skeleton';
import { createDocumentPreview } from '../document-previews.composables';
import { getDocumentTextExcerpt, isImageDocument } from '../document-previews.models';
import { getDocumentNameExtension, getDocumentNameWithoutExtension } from '../document.models';
import { DOCUMENT_ID_ATTRIBUTE } from '../documents-keyboard.composables';
import { DocumentTypeTile } from './document-thumbnail.component';

// Controls revealed on hover (always visible on devices without hover, and when keyboard focused)
const revealOnHoverClass =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100';

const DocumentCardPreview: Component<{ document: Document }> = (props) => {
  const preview = createDocumentPreview({
    getDocument: () => props.document,
    variant: 'card',
  });

  const getAlt = () => props.document.name;

  return (
    <Switch>
      <Match when={preview.getState() === 'ready' && isImageDocument(props.document)}>
        <img
          src={preview.getUrl()}
          alt={getAlt()}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={preview.onImageError}
          class="size-full object-cover"
        />
      </Match>

      <Match when={preview.getState() === 'ready'}>
        {/* Sheet of paper pinned to the top of the area and cropped at the bottom */}
        <div class="absolute inset-x-[14px] top-[12px] bottom-0 overflow-hidden rounded-t-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)]">
          <img
            src={preview.getUrl()}
            alt={getAlt()}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={preview.onImageError}
            class="w-full object-cover object-top"
          />
        </div>
      </Match>

      <Match when={preview.getState() === 'loading'}>
        <Skeleton class="size-full rounded-none bg-muted-foreground/10" />
      </Match>

      <Match when={preview.getState() === 'unavailable'}>
        <div class="flex size-full flex-col items-center justify-center gap-2.5 px-3">
          <div class="h-[72px] w-[56px] shrink-0 overflow-hidden rounded-[4px] shadow-sm">
            <DocumentTypeTile document={props.document} size="lg" />
          </div>

          <Show when={getDocumentTextExcerpt({ content: props.document.contentExcerpt })}>
            {(getExcerpt) => (
              <p class="line-clamp-4 break-words text-center text-[11px] leading-snug text-muted-foreground">
                {getExcerpt()}
              </p>
            )}
          </Show>
        </div>
      </Match>
    </Switch>
  );
};

const DocumentCard: Component<{
  document: Document;
  isSelected: boolean;
  isSelectionEnabled: boolean;
  isFocused: boolean;
  onToggleSelected: (value: boolean) => void;
  onQuickLook?: (document: Document) => void;
  // Shows a "Done" control on the card (inbox)
  onMarkDone?: (document: Document) => void;
}> = (props) => {
  const { t } = useI18n();

  const getExtension = () => getDocumentNameExtension({ name: props.document.name });

  return (
    <div
      {...{ [DOCUMENT_ID_ATTRIBUTE]: props.document.id }}
      tabIndex={-1}
      class={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border bg-card outline-none transition duration-150 hover:(-translate-y-px shadow-md)',
        props.isSelected && 'ring-2 ring-primary border-primary',
        props.isFocused && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <div class="relative h-[196px] shrink-0 overflow-hidden bg-muted">
        <DocumentCardPreview document={props.document} />

        <Show when={props.isSelectionEnabled}>
          <Checkbox
            checked={props.isSelected}
            onChange={props.onToggleSelected}
            aria-label={t('documents.list.select.row')}
            class={cn(
              'absolute left-2 top-2 z-10 rounded-md bg-background/90 p-1 shadow-sm',
              !props.isSelected && revealOnHoverClass,
            )}
          >
            <CheckboxControl />
          </Checkbox>
        </Show>

        <Show when={props.onMarkDone}>
          {(getOnMarkDone) => (
            <button
              type="button"
              class={cn(
                'absolute right-2 bottom-2 z-10 flex h-7 items-center justify-center gap-1 rounded-md bg-background/90 px-2 text-xs font-medium text-foreground shadow-sm hover:bg-background',
                revealOnHoverClass,
              )}
              aria-label={t('inbox.actions.done')}
              title={t('inbox.actions.done')}
              onClick={() => getOnMarkDone()(props.document)}
            >
              <div class="i-tabler-check size-4" />
              {t('inbox.actions.done')}
            </button>
          )}
        </Show>

        <Show when={props.onQuickLook}>
          {(getOnQuickLook) => (
            <button
              type="button"
              class={cn(
                'absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm hover:bg-background',
                revealOnHoverClass,
              )}
              aria-label={t('documents.grid.quick-look')}
              title={t('documents.grid.quick-look')}
              onClick={() => getOnQuickLook()(props.document)}
            >
              <div class="i-tabler-eye size-4" />
            </button>
          )}
        </Show>
      </div>

      <div class="flex min-w-0 flex-col gap-1 border-t p-3">
        {/* The link stretches over the whole card, controls and tags sit above it */}
        <A
          href={`/organizations/${props.document.organizationId}/documents/${props.document.id}`}
          class="block truncate text-sm font-semibold after:absolute after:inset-0 after:content-['']"
          title={props.document.name}
        >
          {getDocumentNameWithoutExtension({ name: props.document.name })}
        </A>

        <div class="truncate text-xs text-muted-foreground">
          <RelativeTime date={props.document.documentDate ?? props.document.createdAt} />
          <Show when={getExtension()}>
            {(getExt) => (
              <>
                {' '}
                · <span class="uppercase">{getExt()}</span>
              </>
            )}
          </Show>
          {' · '}
          {formatBytes({ bytes: props.document.originalSize, base: 1000 })}
        </div>

        <div class="relative z-10 flex h-6 flex-nowrap items-center gap-1 overflow-hidden">
          <For each={props.document.tags}>
            {(tag) => (
              <TagLink
                {...tag}
                organizationId={props.document.organizationId}
                class="shrink-0 px-2 py-0.5 text-xs text-muted-foreground"
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export const DocumentsGrid: Component<{
  rows: Row<Document>[];
  enableSelection?: boolean;
  // Document highlighted by the keyboard navigation
  focusedDocumentId?: string;
  onQuickLook?: (document: Document) => void;
  onMarkDone?: (document: Document) => void;
}> = (props) => {
  return (
    <div class="grid grid-cols-2 gap-[18px] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <For each={props.rows}>
        {(row) => (
          <DocumentCard
            document={row.original}
            isSelected={row.getIsSelected()}
            isSelectionEnabled={props.enableSelection ?? false}
            isFocused={props.focusedDocumentId === row.original.id}
            onToggleSelected={(value) => row.toggleSelected(value)}
            onQuickLook={props.onQuickLook}
            onMarkDone={props.onMarkDone}
          />
        )}
      </For>
    </div>
  );
};
