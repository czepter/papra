import type { Accessor } from 'solid-js';
import type { DocumentsView, DocumentsViewPreferences } from './documents-view-preference.models';
import { createMemo, createSignal } from 'solid-js';
import { useI18n } from '../i18n/i18n.provider';
import { buildLocalStorageKey } from '../shared/signals/persistence/persistence.models';
import { createToast } from '../ui/components/sonner';
import { useCurrentUser } from '../users/composables/useCurrentUser';
import {
  applyViewEverywhere,
  hasTagViewOverride,
  parseStoredDocumentsViewPreferences,
  removeTagViewOverride,
  resolveDocumentsView,
  setDocumentsView,
} from './documents-view-preference.models';

// Stored per user and organization, only in this browser
export function buildDocumentsViewPreferencesStorageKey({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  return buildLocalStorageKey('documents-view', userId, organizationId);
}

function readPreferences({ key }: { key: string }) {
  try {
    return parseStoredDocumentsViewPreferences({ raw: window.localStorage.getItem(key) });
  } catch {
    return parseStoredDocumentsViewPreferences({ raw: undefined });
  }
}

function writePreferences({
  key,
  preferences,
}: {
  key: string;
  preferences: DocumentsViewPreferences;
}) {
  try {
    window.localStorage.setItem(key, JSON.stringify(preferences));
  } catch {}
}

// `getTagName` is the tag the documents are currently filtered by (only when it is the single filter)
export function createDocumentsViewPreference({
  getOrganizationId,
  getTagName,
}: {
  getOrganizationId: Accessor<string>;
  getTagName: Accessor<string | undefined>;
}) {
  const { t } = useI18n();
  const { user } = useCurrentUser();

  const getKey = createMemo(() =>
    buildDocumentsViewPreferencesStorageKey({
      userId: user.id,
      organizationId: getOrganizationId(),
    }),
  );

  // Cached in memory, the key changing (organization switch) reloads from the storage
  const [getState, setState] = createSignal<{
    key: string;
    preferences: DocumentsViewPreferences;
  }>();

  const getPreferences = () => {
    const state = getState();

    return state?.key === getKey() ? state.preferences : readPreferences({ key: getKey() });
  };

  const savePreferences = (preferences: DocumentsViewPreferences) => {
    const key = getKey();
    setState({ key, preferences });
    writePreferences({ key, preferences });
  };

  const getViewLabel = (view: DocumentsView) => t(`documents.view.${view}`);

  const setView = (view: DocumentsView) => {
    const preferences = getPreferences();
    const tagName = getTagName();

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
