import type { Component } from 'solid-js';
import type { DocumentsView } from '../documents-view-preference.models';
import { Show } from 'solid-js';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { ToggleGroup, ToggleGroupItem } from '@/modules/ui/components/toggle-group';

export const DocumentsViewToggle: Component<{
  view: DocumentsView;
  onViewChange: (view: DocumentsView) => void;
  // Whether the current view has its own saved choice (a tag override)
  isSavedForTag?: boolean;
}> = (props) => {
  const { t } = useI18n();

  return (
    <div class="flex items-center gap-2">
      <Show when={props.isSavedForTag}>
        <span class="hidden text-xs text-muted-foreground sm:inline">
          {t('documents.view.saved-for-tag')}
        </span>
      </Show>

      <ToggleGroup
        variant="outline"
        size="sm"
        class="gap-0"
        value={props.view}
        onChange={(value) => {
          // Clicking the active item would unselect it, a view is always selected
          if (value === 'list' || value === 'grid') {
            props.onViewChange(value);
          }
        }}
        aria-label={t('documents.view.toggle-label')}
      >
        <ToggleGroupItem
          value="list"
          class="rounded-r-none"
          aria-label={t('documents.view.list')}
          title={t('documents.view.list')}
        >
          <div class="i-tabler-list size-4" />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="grid"
          class="rounded-l-none border-l-0"
          aria-label={t('documents.view.grid')}
          title={t('documents.view.grid')}
        >
          <div class="i-tabler-layout-grid size-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};
