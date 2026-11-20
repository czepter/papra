import type { Component } from 'solid-js';
import type { CustomPropertyValueItem } from '../custom-property-display.models';
import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { cn } from '@/modules/shared/style/cn';

// Each value filters the documents when a filter href is provided, else it is plain text
export const CustomPropertyValueLinks: Component<{
  items: CustomPropertyValueItem[];
  getFilterHref?: (term: string) => string;
  class?: string;
}> = (props) => {
  return (
    <For each={props.items}>
      {(item, getIndex) => (
        <>
          <Show when={getIndex() > 0}>{', '}</Show>
          <Show when={item.filterTerm !== undefined && props.getFilterHref} fallback={item.text}>
            <A
              href={props.getFilterHref!(item.filterTerm!)}
              class={cn('hover:underline', props.class)}
            >
              {item.text}
            </A>
          </Show>
        </>
      )}
    </For>
  );
};
