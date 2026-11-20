import { safely } from '@corentinth/chisels';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { createEffect, createSignal, untrack } from 'solid-js';
import { queryClient } from '../shared/query/query-client';
import { useI18n } from '../i18n/i18n.provider';
import { useI18nApiErrors } from '../shared/http/composables/i18n-api-errors';
import { createToast } from '../ui/components/sonner';
import {
  fetchInboxCount,
  markDocumentsAsReviewed,
  moveDocumentToInbox,
} from './document-inbox.services';

export const getInboxQueryKey = ({ organizationId }: { organizationId: string }) =>
  ['organizations', organizationId, 'inbox'] as const;

export const getInboxCountQueryOptions = ({ organizationId }: { organizationId: string }) =>
  queryOptions({
    queryKey: [...getInboxQueryKey({ organizationId }), 'count'],
    queryFn: async () => fetchInboxCount({ organizationId }),
  });

export function useInboxCount({ getOrganizationId }: { getOrganizationId: () => string }) {
  return useQuery(() => getInboxCountQueryOptions({ organizationId: getOrganizationId() }));
}

// Refreshes the inbox lists and the count
export async function invalidateInboxQueries({ organizationId }: { organizationId: string }) {
  return queryClient.invalidateQueries({ queryKey: getInboxQueryKey({ organizationId }) });
}

// Refreshes the count only, used while the inbox list must stay stable (quick look navigation)
export async function invalidateInboxCountQuery({ organizationId }: { organizationId: string }) {
  return queryClient.invalidateQueries(getInboxCountQueryOptions({ organizationId }));
}

// Opening a document reviews it: called once each time the target changes, fire and forget
export function createMarkAsReviewedOnView({
  getTarget,
}: {
  getTarget: () => { organizationId: string; documentId: string } | undefined;
}) {
  let lastKey: string | undefined;

  createEffect(() => {
    const target = getTarget();

    if (target === undefined) {
      lastKey = undefined;
      return;
    }

    const key = `${target.organizationId}:${target.documentId}`;

    if (key === lastKey) {
      return;
    }

    lastKey = key;

    untrack(() => {
      void safely(
        markDocumentsAsReviewed({
          organizationId: target.organizationId,
          documentIds: [target.documentId],
        }),
      ).then(([, error]) => {
        if (!error) {
          void invalidateInboxCountQuery({ organizationId: target.organizationId });
        }
      });
    });
  });
}

export function useMoveDocumentToInbox() {
  const { t } = useI18n();
  const { getErrorMessage } = useI18nApiErrors();
  const [getIsMoving, setIsMoving] = createSignal(false);

  return {
    getIsMoving,
    moveToInbox: async ({
      organizationId,
      documentId,
    }: {
      organizationId: string;
      documentId: string;
    }) => {
      setIsMoving(true);
      const [, error] = await safely(moveDocumentToInbox({ organizationId, documentId }));
      setIsMoving(false);

      if (error) {
        createToast({ type: 'error', message: getErrorMessage({ error }) });
        return;
      }

      await invalidateInboxQueries({ organizationId });
      createToast({ type: 'success', message: t('inbox.actions.move-to-inbox.success') });
    },
  };
}
