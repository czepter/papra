import type { Component } from 'solid-js';
import type { DocumentTypeFamily } from '../document-previews.models';
import type { Document } from '../documents.types';
import { formatBytes } from '@corentinth/chisels';
import { Match, Show, Switch } from 'solid-js';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { cn } from '@/modules/shared/style/cn';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/modules/ui/components/hover-card';
import { Skeleton } from '@/modules/ui/components/skeleton';
import { createDocumentPreview } from '../document-previews.composables';
import { getDocumentTextExcerpt, getDocumentTypeFamily } from '../document-previews.models';
import { getDocumentIcon, getDocumentNameExtension } from '../document.models';

// Class names live in a tsx file, as UnoCSS does not extract utilities from .ts files
export const documentTypeFamilyBackgroundClass: Record<DocumentTypeFamily, string> = {
  pdf: 'bg-red-600',
  spreadsheet: 'bg-green-600',
  word: 'bg-blue-600',
  email: 'bg-purple-600',
  archive: 'bg-slate-600',
  image: 'bg-teal-600',
  other: 'bg-gray-500',
};

const HOVER_CARD_OPEN_DELAY_MS = 350;

// Placeholder used when a document has no preview: coloured per file type family, with the icon and extension
export const DocumentTypeTile: Component<{
  document: Pick<Document, 'name' | 'mimeType'>;
  size?: 'sm' | 'lg';
  class?: string;
}> = (props) => {
  const getExtension = () => getDocumentNameExtension({ name: props.document.name })?.slice(0, 5);
  const isLarge = () => props.size === 'lg';

  return (
    <div
      class={cn(
        'flex flex-col items-center justify-center text-white select-none',
        documentTypeFamilyBackgroundClass[getDocumentTypeFamily(props.document)],
        isLarge() ? 'size-full gap-1.5' : 'size-full gap-0.5',
        props.class,
      )}
    >
      <div
        class={cn(getDocumentIcon({ document: props.document }), isLarge() ? 'size-10' : 'size-4')}
      />

      <Show when={getExtension()}>
        {(getExt) => (
          <span
            class={cn(
              'font-semibold uppercase leading-none tracking-wide',
              isLarge() ? 'text-xs' : 'text-[8px]',
            )}
          >
            {getExt()}
          </span>
        )}
      </Show>
    </div>
  );
};

// Image of a preview variant, falling back to the type tile whenever there is no usable preview
export const DocumentPreviewImage: Component<{
  document: Document;
  variant: 'thumb' | 'card' | 'preview';
  tileSize?: 'sm' | 'lg';
  imageClass?: string;
}> = (props) => {
  const { t } = useI18n();
  const preview = createDocumentPreview({
    getDocument: () => props.document,
    variant: props.variant,
  });

  return (
    <Switch>
      <Match when={preview.getState() === 'ready'}>
        <img
          src={preview.getUrl()}
          alt={t('documents.preview.alt', { name: props.document.name })}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={preview.onImageError}
          class={cn('size-full object-cover object-top', props.imageClass)}
        />
      </Match>
      <Match when={preview.getState() === 'loading'}>
        <Skeleton class="size-full rounded-none" />
      </Match>
      <Match when={preview.getState() === 'unavailable'}>
        <DocumentTypeTile document={props.document} size={props.tileSize} />
      </Match>
    </Switch>
  );
};

const DocumentPreviewHoverCardContent: Component<{ document: Document }> = (props) => {
  const { t } = useI18n();
  const preview = createDocumentPreview({
    getDocument: () => props.document,
    variant: 'preview',
  });

  const getExtension = () => getDocumentNameExtension({ name: props.document.name });

  return (
    <>
      <Switch>
        <Match when={preview.getState() === 'ready'}>
          <div class="rounded border bg-white overflow-hidden max-h-80">
            <img
              src={preview.getUrl()}
              alt={t('documents.preview.alt', { name: props.document.name })}
              decoding="async"
              draggable={false}
              onError={preview.onImageError}
              class="w-full object-cover object-top"
            />
          </div>
        </Match>
        <Match when={preview.getState() === 'loading'}>
          <Skeleton class="h-40 w-full" />
        </Match>
        <Match when={preview.getState() === 'unavailable'}>
          <div class="rounded border bg-muted/50 p-2 flex flex-col gap-2">
            <Show when={getDocumentTextExcerpt({ content: props.document.content })}>
              {(getExcerpt) => (
                <p class="text-xs text-foreground/80 break-words whitespace-pre-line">
                  {getExcerpt()}
                </p>
              )}
            </Show>
            <p class="text-xs text-muted-foreground">{t('documents.preview.no-preview')}</p>
          </div>
        </Match>
      </Switch>

      <div class="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
        <div class={cn(getDocumentIcon({ document: props.document }), 'size-4 shrink-0')} />
        <span class="truncate">
          {[
            getExtension()?.toUpperCase(),
            formatBytes({ bytes: props.document.originalSize, base: 1000 }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
    </>
  );
};

// Portrait thumbnail of a document, 34x48. With `hoverCard`, hovering it (mouse only) opens a larger preview.
export const DocumentThumbnail: Component<{ document: Document; hoverCard?: boolean }> = (
  props,
) => {
  const frame = (
    <div class="relative h-48px w-34px shrink-0 overflow-hidden rounded-[4px] border bg-white shadow-sm">
      <DocumentPreviewImage document={props.document} variant="thumb" tileSize="sm" />
    </div>
  );

  return (
    <Show when={props.hoverCard} fallback={frame}>
      <HoverCard
        openDelay={HOVER_CARD_OPEN_DELAY_MS}
        closeDelay={100}
        placement="right-start"
        gutter={8}
      >
        <HoverCardTrigger as="div" class="shrink-0">
          {frame}
        </HoverCardTrigger>
        <HoverCardContent class="w-[256px] p-2">
          <DocumentPreviewHoverCardContent document={props.document} />
        </HoverCardContent>
      </HoverCard>
    </Show>
  );
};
