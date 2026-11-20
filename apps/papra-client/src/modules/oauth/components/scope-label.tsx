import type { Component } from 'solid-js';
import type { TranslationKeys } from '@/modules/i18n/locales.types';
import { Show } from 'solid-js';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { isDestructiveScope } from '../oauth.models';

// The plain language label of a scope. Destructive scopes carry a visible text cue next to it,
// so the meaning never relies on colour alone.
export const ScopeLabel: Component<{ scope: string; isKnown: boolean }> = (props) => {
  const { t } = useI18n();

  return (
    <>
      <span class="break-words min-w-0">
        {props.isKnown ? t(`oauth-consent.scopes.${props.scope}` as TranslationKeys) : props.scope}
      </span>
      <Show when={isDestructiveScope({ scope: props.scope })}>
        <span class="shrink-0 rounded-sm border border-destructive/40 text-destructive px-1 text-[0.7rem] leading-4 font-medium uppercase tracking-wide">
          {t('oauth-consent.scopes.destructive-cue')}
        </span>
      </Show>
    </>
  );
};

export const ScopeIcon: Component<{ scope: string }> = (props) => (
  <div
    class={
      isDestructiveScope({ scope: props.scope })
        ? 'i-tabler-trash size-4 text-destructive mt-0.5 shrink-0'
        : 'i-tabler-check size-4 text-primary mt-0.5 shrink-0'
    }
    aria-hidden="true"
  />
);
