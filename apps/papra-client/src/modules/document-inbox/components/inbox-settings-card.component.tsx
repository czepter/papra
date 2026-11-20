import type { Component } from 'solid-js';
import type { TranslationKeys } from '@/modules/i18n/locales.types';
import type { InboxMode } from '../document-inbox.constants';
import { safely } from '@corentinth/chisels';
import { useQueryClient } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { getOrganizationSettingsQueryOptions } from '@/modules/organizations/organizations.queries';
import { updateOrganizationSettings } from '@/modules/organizations/organizations.services';
import { useI18nApiErrors } from '@/modules/shared/http/composables/i18n-api-errors';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/modules/ui/components/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/ui/components/select';
import { createToast } from '@/modules/ui/components/sonner';
import { INBOX_MODES } from '../document-inbox.constants';
import { invalidateInboxQueries } from '../document-inbox.composables';

const modeLabelKeys: Record<InboxMode, TranslationKeys> = {
  shared: 'organization.settings.inbox.mode.shared.label',
  per_user: 'organization.settings.inbox.mode.per-user.label',
};

const modeDescriptionKeys: Record<InboxMode, TranslationKeys> = {
  shared: 'organization.settings.inbox.mode.shared.description',
  per_user: 'organization.settings.inbox.mode.per-user.description',
};

export const InboxSettingsCard: Component<{
  organizationId: string;
  mode: InboxMode;
  // Only owners can change the organization settings
  canEdit: boolean;
}> = (props) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { getErrorMessage } = useI18nApiErrors();

  const changeMode = async (mode: InboxMode | null) => {
    if (mode === null || mode === props.mode) {
      return;
    }

    const [, error] = await safely(
      updateOrganizationSettings({
        organizationId: props.organizationId,
        organizationSettingsPartials: { inbox: { mode } },
      }),
    );

    if (error) {
      createToast({ type: 'error', message: getErrorMessage({ error }) });
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries(
        getOrganizationSettingsQueryOptions({ organizationId: props.organizationId }),
      ),
      // The content of the inbox depends on the mode
      invalidateInboxQueries({ organizationId: props.organizationId }),
    ]);
  };

  return (
    <Card>
      <CardHeader class="border-b">
        <CardTitle>{t('organization.settings.inbox.title')}</CardTitle>
        <CardDescription>{t('organization.settings.inbox.description')}</CardDescription>
      </CardHeader>

      <CardContent class="pt-6 flex flex-col gap-3">
        <Select<InboxMode>
          value={props.mode}
          onChange={changeMode}
          options={[...INBOX_MODES]}
          disallowEmptySelection
          disabled={!props.canEdit}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {t(modeLabelKeys[itemProps.item.rawValue])}
            </SelectItem>
          )}
        >
          <SelectTrigger class="w-full sm:w-64" aria-label={t('organization.settings.inbox.title')}>
            <SelectValue<InboxMode>>
              {(state) => t(modeLabelKeys[state.selectedOption()])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>

        <p class="text-sm text-muted-foreground">{t(modeDescriptionKeys[props.mode])}</p>

        <Show when={!props.canEdit}>
          <p class="text-sm text-muted-foreground">{t('organization.settings.inbox.only-owner')}</p>
        </Show>
      </CardContent>
    </Card>
  );
};
