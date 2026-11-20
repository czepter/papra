import type { Component } from 'solid-js';
import type { TranslationKeys } from '@/modules/i18n/locales.types';
import type { ConnectedApp } from '../mcp.types';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { ScopeIcon, ScopeLabel } from '@/modules/oauth/components/scope-label';
import {
  getClientDisplayName,
  getScopeGroups,
  isDestructiveScope,
} from '@/modules/oauth/oauth.models';
import { useConfirmModal } from '@/modules/shared/confirm';
import { isHttpErrorWithStatusCode } from '@/modules/shared/http/http-errors';
import { queryClient } from '@/modules/shared/query/query-client';
import { Button } from '@/modules/ui/components/button';
import { Skeleton } from '@/modules/ui/components/skeleton';
import { createToast } from '@/modules/ui/components/sonner';
import { fetchConnectedApps, revokeConnectedApp } from '../mcp.services';

const connectedAppsQueryKey = ['mcp', 'connected-apps'];

// Scopes shown before the "show all" toggle. Destructive scopes are always visible.
const COLLAPSED_SCOPES_COUNT = 3;

const ConnectedAppScopes: Component<{ scopes: string[] }> = (props) => {
  const { t } = useI18n();
  const [getIsExpanded, setIsExpanded] = createSignal(false);

  const getGroups = () => getScopeGroups({ scope: props.scopes.join(' ') });
  const getTotal = () => getGroups().reduce((total, group) => total + group.scopes.length, 0);

  // Flat position of each scope, to know which ones stay visible when collapsed
  const getVisibleScopes = () => {
    let position = 0;

    return new Set(
      getGroups()
        .flatMap(({ scopes }) => scopes)
        .filter(({ scope }) => {
          position += 1;

          return (
            getIsExpanded() ||
            position <= COLLAPSED_SCOPES_COUNT ||
            isDestructiveScope({ scope })
          );
        })
        .map(({ scope }) => scope),
    );
  };

  const getHiddenCount = () => getTotal() - getVisibleScopes().size;

  return (
    <div class="mt-3 flex flex-col gap-2">
      <For each={getGroups()}>
        {(group) => (
          <Show when={group.scopes.some(({ scope }) => getVisibleScopes().has(scope))}>
            <div>
              <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.section === 'connection'
                  ? t('oauth-consent.groups.connection')
                  : t(`api-keys.permissions.${group.section}.title` as TranslationKeys)}
              </h4>
              <ul class="mt-1 flex flex-col gap-1 text-sm">
                <For each={group.scopes.filter(({ scope }) => getVisibleScopes().has(scope))}>
                  {(item) => (
                    <li class="flex flex-wrap gap-x-2 gap-y-0.5 items-start">
                      <ScopeIcon scope={item.scope} />
                      <ScopeLabel scope={item.scope} isKnown={item.isKnown} />
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        )}
      </For>

      <Show when={getHiddenCount() > 0 || getIsExpanded()}>
        <Button
          variant="link"
          size="sm"
          class="self-start h-auto p-0"
          aria-expanded={getIsExpanded()}
          onClick={() => setIsExpanded(!getIsExpanded())}
        >
          {getIsExpanded()
            ? t('mcp-settings.connected-apps.permissions.show-less')
            : t('mcp-settings.connected-apps.permissions.show-all', { count: getTotal() })}
        </Button>
      </Show>
    </div>
  );
};

const ConnectedAppCard: Component<{ app: ConnectedApp }> = (props) => {
  const { t, formatDate, formatRelativeTime } = useI18n();
  const { confirm } = useConfirmModal();

  const getName = () =>
    getClientDisplayName({ name: props.app.clientName }) ??
    t('mcp-settings.connected-apps.unnamed');

  const revokeMutation = useMutation(() => ({
    mutationFn: revokeConnectedApp,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectedAppsQueryKey });
      createToast({ type: 'success', message: t('mcp-settings.connected-apps.revoke.success') });
    },
    onError: (error) => {
      // Already gone (revoked elsewhere): the list is stale, refresh it
      if (isHttpErrorWithStatusCode({ error, statusCode: 404 })) {
        void queryClient.invalidateQueries({ queryKey: connectedAppsQueryKey });
      }
      createToast({ type: 'error', message: t('mcp-settings.connected-apps.revoke.error') });
    },
  }));

  const handleRevoke = async () => {
    const confirmed = await confirm({
      title: t('mcp-settings.connected-apps.revoke.confirm.title', { name: getName() }),
      message: t('mcp-settings.connected-apps.revoke.confirm.message', { name: getName() }),
      confirmButton: {
        text: t('mcp-settings.connected-apps.revoke.confirm.confirm-button'),
        variant: 'destructive',
      },
      cancelButton: {
        text: t('mcp-settings.connected-apps.revoke.confirm.cancel-button'),
      },
    });

    if (!confirmed) {
      return;
    }

    revokeMutation.mutate({ clientId: props.app.clientId });
  };

  return (
    <li class="bg-card rounded-lg border p-4">
      <div class="flex items-start gap-3">
        <div class="rounded-lg bg-muted p-2 shrink-0">
          <div class="i-tabler-plug-connected text-primary size-5" aria-hidden="true" />
        </div>

        <div class="flex-1 min-w-0">
          {/* The name and the hosts come from open client registration: plain text only, never a link */}
          <h3 class="text-sm font-medium leading-tight truncate" title={getName()}>
            <bdi>{getName()}</bdi>
          </h3>
          <Show when={props.app.redirectHosts.length > 0}>
            <p
              class="text-muted-foreground text-xs font-mono truncate mt-0.5"
              title={props.app.redirectHosts.join(', ')}
            >
              {props.app.redirectHosts.join(', ')}
            </p>
          </Show>
        </div>

        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          isLoading={revokeMutation.isPending}
          aria-label={t('mcp-settings.connected-apps.revoke.label', { name: getName() })}
          onClick={handleRevoke}
        >
          {t('mcp-settings.connected-apps.revoke.button')}
        </Button>
      </div>

      <p class="mt-3 text-xs text-muted-foreground">
        {t('mcp-settings.connected-apps.authorized', {
          date: formatDate(props.app.authorizedAt),
        })}
        <Show when={props.app.lastActiveAt}>
          {(getLastActiveAt) => (
            <>
              {' · '}
              <span
                title={formatDate(getLastActiveAt(), { dateStyle: 'short', timeStyle: 'long' })}
              >
                {t('mcp-settings.connected-apps.last-active', {
                  date: formatRelativeTime(getLastActiveAt()),
                })}
              </span>
            </>
          )}
        </Show>
      </p>

      <ConnectedAppScopes scopes={props.app.scopes} />
    </li>
  );
};

export const ConnectedApps: Component = () => {
  const { t } = useI18n();

  const query = useQuery(() => ({
    queryKey: connectedAppsQueryKey,
    queryFn: fetchConnectedApps,
    retry: false,
  }));

  return (
    <section class="mt-6" aria-labelledby="connected-apps-title">
      <div class="border-b pb-4">
        <h2 id="connected-apps-title" class="text-lg font-semibold mb-1">
          {t('mcp-settings.connected-apps.title')}
        </h2>
        <p class="text-sm text-muted-foreground">{t('mcp-settings.connected-apps.description')}</p>
      </div>

      <Switch>
        <Match when={query.isError}>
          <div class="mt-4 rounded-lg border border-destructive/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p class="text-sm flex-1">{t('mcp-settings.connected-apps.error')}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('mcp-settings.connected-apps.retry')}
            </Button>
          </div>
        </Match>

        <Match when={query.isLoading}>
          <div class="mt-4 flex flex-col gap-2" aria-busy="true">
            <Skeleton class="h-24 w-full" />
            <Skeleton class="h-24 w-full" />
          </div>
        </Match>

        <Match when={query.data && query.data.connectedApps.length === 0}>
          <div class="mt-4 rounded-lg border border-dashed p-6 text-center">
            <div class="i-tabler-plug-off size-8 text-muted-foreground mx-auto" aria-hidden="true" />
            <p class="mt-2 text-sm font-medium">{t('mcp-settings.connected-apps.empty.title')}</p>
            <p class="mt-1 text-sm text-muted-foreground">
              {t('mcp-settings.connected-apps.empty.description')}
            </p>
          </div>
        </Match>

        <Match when={query.data}>
          <ul class="mt-4 flex flex-col gap-2">
            <For each={query.data?.connectedApps}>{(app) => <ConnectedAppCard app={app} />}</For>
          </ul>
        </Match>
      </Switch>
    </section>
  );
};
