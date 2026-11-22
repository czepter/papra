import type { Component } from 'solid-js';
import type { TranslationKeys } from '@/modules/i18n/locales.types';
import { A, Navigate, useLocation, useSearchParams } from '@solidjs/router';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { useSession } from '@/modules/auth/composables/use-session.composable';
import { authPagesPaths } from '@/modules/auth/auth.constants';
import { useConfig } from '@/modules/config/config.provider';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { buildPathWithRedirect } from '@/modules/navigation/redirect';
import { asSingleParam } from '@/modules/shared/utils/query-params';
import { Button } from '@/modules/ui/components/button';
import { createToast } from '@/modules/ui/components/sonner';
import { AuthLayout } from '@/modules/ui/layouts/auth-layout.component';
import {
  getClientDisplayName,
  getRedirectHost,
  getScopeGroups,
  isSafeRedirectUrl,
} from '../oauth.models';
import { ScopeIcon, ScopeLabel } from '../components/scope-label';
import { fetchOauthPublicClient, submitOauthConsent } from '../oauth.services';

const ConsentCard: Component<{
  icon: string;
  title: string;
  description?: string;
  children?: any;
}> = (props) => (
  <div class="flex items-center justify-center p-4 sm:p-6 sm:pb-32">
    <div class="max-w-md w-full">
      <div class={`${props.icon} size-12 text-primary mb-2`} />
      <h1 class="text-xl font-bold break-words">{props.title}</h1>
      <Show when={props.description}>
        <p class="text-muted-foreground mt-1">{props.description}</p>
      </Show>
      {props.children}
    </div>
  </div>
);

export const OauthConsentPage: Component = () => {
  const { t } = useI18n();
  const { config } = useConfig();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { sessionQuery, getUser, getIsAuthenticated } = useSession();
  const [getIsRedirecting, setIsRedirecting] = createSignal(false);

  const getClientId = () => asSingleParam(searchParams.client_id);
  const getSignature = () => asSingleParam(searchParams.sig);
  const getRequestedScope = () => asSingleParam(searchParams.scope);
  const getRedirectUri = () => asSingleParam(searchParams.redirect_uri);

  const clientQuery = useQuery(() => ({
    queryKey: ['oauth', 'client', location.search],
    queryFn: async () => fetchOauthPublicClient({ clientId: getClientId() as string }),
    enabled:
      config.mcp.isEnabled && getIsAuthenticated() && Boolean(getClientId() && getSignature()),
    retry: false,
    // Each load of the page is a fresh authorization request
    gcTime: 0,
    staleTime: 0,
  }));

  const decisionMutation = useMutation(() => ({
    mutationFn: submitOauthConsent,
    onSuccess: ({ redirectUrl }) => {
      if (!isSafeRedirectUrl({ url: redirectUrl })) {
        createToast({ type: 'error', message: t('oauth-consent.error.submit') });
        return;
      }

      setIsRedirecting(true);
      window.location.href = redirectUrl;
    },
    onError: () => {
      createToast({ type: 'error', message: t('oauth-consent.error.submit') });
    },
  }));

  const getIsBusy = () => decisionMutation.isPending || getIsRedirecting();
  const getScopeGroupsToShow = () => getScopeGroups({ scope: getRequestedScope() });
  const getClientName = () => getClientDisplayName({ name: clientQuery.data?.client_name });
  const getHost = () => getRedirectHost({ redirectUri: getRedirectUri() });

  return (
    <AuthLayout>
      <Switch>
        <Match when={!config.mcp.isEnabled}>
          <ConsentCard
            icon="i-tabler-plug-off"
            title={t('oauth-consent.unavailable.title')}
            description={t('oauth-consent.unavailable.description')}
          >
            <Button as="a" href="/" class="mt-4" variant="outline">
              {t('oauth-consent.back-to-papra')}
            </Button>
          </ConsentCard>
        </Match>

        <Match when={sessionQuery.isLoading}>
          <div class="flex justify-center p-12">
            <div class="i-tabler-loader-2 animate-spin size-6 text-muted-foreground" />
          </div>
        </Match>

        <Match when={!getIsAuthenticated()}>
          {/* The signed query is kept as is: it is read back from the address bar once signed in */}
          <Navigate
            href={buildPathWithRedirect({
              path: authPagesPaths.login,
              redirectPath: `${location.pathname}${location.search}`,
            })}
          />
        </Match>

        <Match when={!getClientId() || !getSignature() || clientQuery.isError}>
          <ConsentCard
            icon="i-tabler-alert-triangle"
            title={t('oauth-consent.invalid.title')}
            description={t('oauth-consent.invalid.description')}
          >
            <Button as="a" href="/" class="mt-4" variant="outline">
              {t('oauth-consent.back-to-papra')}
            </Button>
          </ConsentCard>
        </Match>

        <Match when={clientQuery.isLoading}>
          <div class="flex justify-center p-12">
            <div class="i-tabler-loader-2 animate-spin size-6 text-muted-foreground" />
          </div>
        </Match>

        <Match when={clientQuery.data}>
          <ConsentCard icon="i-tabler-plug-connected" title={t('oauth-consent.title')}>
            <p class="text-muted-foreground mt-1">
              <span
                class="font-semibold text-foreground inline-block max-w-full truncate align-bottom"
                title={getClientName()}
              >
                {getClientName() ?? t('oauth-consent.unknown-application')}
              </span>{' '}
              {t('oauth-consent.description')}
            </p>

            <dl class="mt-4 text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <Show when={getHost()}>
                <dt class="text-muted-foreground">{t('oauth-consent.redirect-host')}</dt>
                <dd class="font-mono truncate" title={getHost()}>
                  {getHost()}
                </dd>
              </Show>
              <dt class="text-muted-foreground">{t('oauth-consent.account')}</dt>
              <dd class="truncate" title={getUser()?.email}>
                {getUser()?.email}
              </dd>
            </dl>

            <div class="mt-4 border rounded-lg bg-card p-4 flex flex-col gap-4">
              <h2 class="text-sm font-medium">{t('oauth-consent.scopes.title')}</h2>
              <For each={getScopeGroupsToShow()}>
                {(group) => (
                  <div>
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.section === 'connection'
                        ? t('oauth-consent.groups.connection')
                        : t(`api-keys.permissions.${group.section}.title` as TranslationKeys)}
                    </h3>
                    <ul class="mt-1 flex flex-col gap-1 text-sm">
                      <For each={group.scopes}>
                        {(item) => (
                          <li class="flex gap-2 items-start">
                            <ScopeIcon scope={item.scope} />
                            <ScopeLabel scope={item.scope} isKnown={item.isKnown} />
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
            </div>

            <p class="text-xs text-muted-foreground mt-3">{t('oauth-consent.revoke-hint')}</p>
            {/* A fixed internal path in a new tab: the pending decision stays on screen and nothing of the request leaks */}
            <p class="text-xs text-muted-foreground mt-1">
              {t('oauth-consent.revoke-later')}{' '}
              <A
                href="/mcp-settings"
                target="_blank"
                rel="noopener"
                class="text-primary hover:underline"
              >
                {t('oauth-consent.revoke-later-link')}
              </A>
            </p>

            {/* DOM order is the visual order at every width: Allow first, stacked on mobile, side by side from sm */}
            <div class="mt-4 flex flex-col sm:flex-row gap-2">
              <Button
                class="sm:flex-1"
                disabled={getIsBusy()}
                isLoading={getIsBusy()}
                onClick={() => decisionMutation.mutate({ accept: true })}
              >
                {t('oauth-consent.allow')}
              </Button>
              <Button
                variant="secondary"
                class="sm:flex-1"
                disabled={getIsBusy()}
                onClick={() => decisionMutation.mutate({ accept: false })}
              >
                {t('oauth-consent.deny')}
              </Button>
            </div>
          </ConsentCard>
        </Match>
      </Switch>
    </AuthLayout>
  );
};
