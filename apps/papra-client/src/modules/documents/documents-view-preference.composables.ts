import type { Accessor } from 'solid-js';
import type { DocumentsView, DocumentsViewPreferences } from './documents-view-preference.models';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { useI18n } from '../i18n/i18n.provider';
import { useI18nApiErrors } from '../shared/http/composables/i18n-api-errors';
import { queryClient } from '../shared/query/query-client';
import { createToast } from '../ui/components/sonner';
import { useCurrentUser } from '../users/composables/useCurrentUser';
import {
  applyViewEverywhere,
  defaultDocumentsViewPreferences,
  hasTagViewOverride,
  removeTagViewOverride,
  resolveDocumentsView,
  setDocumentsView,
} from './documents-view-preference.models';
import {
  fetchDocumentsViewPreferences,
  saveDocumentsViewPreferences,
} from './documents-view-preference.services';

// `getTagName` is the tag the documents are currently filtered by (only when it is the single filter)
export function createDocumentsViewPreference({
  getOrganizationId,
  getTagName,
}: {
  getOrganizationId: Accessor<string>;
  getTagName: Accessor<string | undefined>;
}) {
  const { t } = useI18n();
  const { getErrorMessage } = useI18nApiErrors();
  const { user } = useCurrentUser();

  // Stored on the server per user and organization, so it follows the user across devices
  const getQueryOptions = () => {
    const organizationId = getOrganizationId();

    return {
      queryKey: ['documents-view-preferences', user.id, organizationId],
      queryFn: async () => (await fetchDocumentsViewPreferences({ organizationId })).preferences,
    };
  };

  const query = useQuery(() => getQueryOptions());

  // The default view is displayed until the stored preferences are loaded
  const getPreferences = (): DocumentsViewPreferences =>
    query.data ?? defaultDocumentsViewPreferences;

  const saveMutation = useMutation(() => ({
    // Saves are sent one after the other so the last one wins on the server
    scope: { id: `documents-view-preferences:${user.id}:${getOrganizationId()}` },
    mutationFn: async ({
      organizationId,
      preferences,
    }: {
      organizationId: string;
      preferences: DocumentsViewPreferences;
    }) => saveDocumentsViewPreferences({ organizationId, preferences }),
    // Optimistic update, the toggle is instant
    onMutate: async ({ organizationId, preferences }) => {
      const queryKey = ['documents-view-preferences', user.id, organizationId];

      await queryClient.cancelQueries({ queryKey });
      const previousPreferences = queryClient.getQueryData<DocumentsViewPreferences>(queryKey);
      queryClient.setQueryData(queryKey, preferences);

      return { queryKey, previousPreferences };
    },
    onError: (error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previousPreferences);
      }

      createToast({ message: getErrorMessage({ error }), type: 'error' });
    },
  }));

  const savePreferences = (preferences: DocumentsViewPreferences) => {
    saveMutation.mutate({ organizationId: getOrganizationId(), preferences });
  };

  const getViewLabel = (view: DocumentsView) => t(`documents.view.${view}`);

  // Without the stored preferences, saving would overwrite them with the defaults
  const loadPreferences = async () => {
    try {
      return await queryClient.ensureQueryData(getQueryOptions());
    } catch (error) {
      createToast({ message: getErrorMessage({ error }), type: 'error' });

      return undefined;
    }
  };

  const setView = async (view: DocumentsView) => {
    const tagName = getTagName();
    const preferences = await loadPreferences();

    if (!preferences) {
      return;
    }

    const nextPreferences = setDocumentsView({ preferences, tagName, view });
    savePreferences(nextPreferences);

    const isNewOverride =
      tagName !== undefined &&
      !hasTagViewOverride({ preferences, tagName }) &&
      hasTagViewOverride({ preferences: nextPreferences, tagName });

    if (!isNewOverride || tagName === undefined) {
      return;
    }

    createToast({
      message: t('documents.view.toast.title', { view: getViewLabel(view), tag: tagName }),
      description: t('documents.view.toast.description', {
        defaultView: getViewLabel(preferences.defaultView),
      }),
      action: {
        label: t('documents.view.toast.everywhere', { view: getViewLabel(view) }),
        onClick: () =>
          savePreferences(applyViewEverywhere({ preferences: getPreferences(), tagName, view })),
      },
      cancel: {
        label: t('documents.view.toast.undo'),
        onClick: () =>
          savePreferences(removeTagViewOverride({ preferences: getPreferences(), tagName })),
      },
    });
  };

  return {
    getView: () => resolveDocumentsView({ preferences: getPreferences(), tagName: getTagName() }),
    hasTagOverride: () =>
      hasTagViewOverride({ preferences: getPreferences(), tagName: getTagName() }),
    setView,
  };
}
