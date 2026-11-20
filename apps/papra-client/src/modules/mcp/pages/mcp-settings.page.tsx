import type { Component } from 'solid-js';
import { A } from '@solidjs/router';
import { Show } from 'solid-js';
import { useConfig } from '@/modules/config/config.provider';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { CopyButton } from '@/modules/shared/utils/copy';
import { Badge } from '@/modules/ui/components/badge';
import { ConnectedApps } from '../components/connected-apps';

export const McpSettingsPage: Component = () => {
  const { t } = useI18n();
  const { config } = useConfig();

  return (
    <div class="p-6 mt-12 pb-32 mx-auto max-w-xl w-full">
      <div class="border-b pb-4">
        <h1 class="text-2xl font-semibold mb-1">{t('mcp-settings.title')}</h1>
        <p class="text-muted-foreground">{t('mcp-settings.description')}</p>
      </div>

      <div class="bg-card rounded-lg border p-4 mt-6 flex flex-col gap-4">
        <div class="flex items-center gap-2">
          <div class="i-tabler-plug-connected text-primary size-5" />
          <h2 class="text-sm font-medium">{t('mcp-settings.status.label')}</h2>
          <Badge variant={config.mcp.isEnabled ? 'default' : 'secondary'} class="ml-auto">
            {config.mcp.isEnabled
              ? t('mcp-settings.status.enabled')
              : t('mcp-settings.status.disabled')}
          </Badge>
        </div>

        <Show
          when={config.mcp.isEnabled}
          fallback={<p class="text-sm text-muted-foreground">{t('mcp-settings.disabled-hint')}</p>}
        >
          <div>
            <label for="mcp-server-url" class="text-sm font-medium">
              {t('mcp-settings.url.label')}
            </label>
            <div class="mt-2 flex flex-col sm:flex-row gap-2">
              <input
                id="mcp-server-url"
                type="text"
                readOnly
                value={config.mcp.url}
                class="flex-1 min-w-0 rounded-md border bg-muted px-3 py-2 font-mono text-sm"
              />
              <CopyButton
                text={config.mcp.url}
                label={t('mcp-settings.url.copy')}
                copiedLabel={t('mcp-settings.url.copied')}
                variant="outline"
                class="shrink-0"
              />
            </div>
          </div>

          <div>
            <h3 class="text-sm font-medium">{t('mcp-settings.instructions.title')}</h3>

            <h4 class="mt-3 text-sm font-medium">{t('mcp-settings.instructions.oauth.title')}</h4>
            <ol class="mt-2 list-decimal pl-5 text-sm text-muted-foreground flex flex-col gap-1">
              <li>{t('mcp-settings.instructions.oauth.step-add-url')}</li>
              <li>{t('mcp-settings.instructions.oauth.step-approve')}</li>
            </ol>

            <h4 class="mt-4 text-sm font-medium">{t('mcp-settings.instructions.api-key.title')}</h4>
            <ol class="mt-2 list-decimal pl-5 text-sm text-muted-foreground flex flex-col gap-1">
              <li>
                {t('mcp-settings.instructions.api-key.step-create-key')}{' '}
                <A href="/api-keys" class="text-primary hover:underline">
                  {t('mcp-settings.instructions.api-key.api-keys-link')}
                </A>
              </li>
              <li>{t('mcp-settings.instructions.api-key.step-add-url')}</li>
              <li>{t('mcp-settings.instructions.api-key.step-send-key')}</li>
            </ol>
          </div>
        </Show>
      </div>

      <Show when={config.mcp.isEnabled}>
        <ConnectedApps />
      </Show>
    </div>
  );
};
