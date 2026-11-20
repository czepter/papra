import type { ColumnDef, RowSelectionState } from '@tanstack/solid-table';
import type { Component, Setter } from 'solid-js';
import type { Document } from '@/modules/documents/documents.types';
import { safely } from '@corentinth/chisels';
import { useParams } from '@solidjs/router';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, createMemo, createSignal, on, Show, Suspense } from 'solid-js';
import { DocumentQuickLook } from '@/modules/documents/components/document-quick-look.component';
import {
  createdAtColumn,
  DocumentsPaginatedList,
  standardActionsColumn,
  tagsColumn,
} from '@/modules/documents/components/documents-list.component';
import { DocumentsViewToggle } from '@/modules/documents/components/documents-view-toggle.component';
import { createDocumentsViewPreference } from '@/modules/documents/documents-view-preference.composables';
import {
  createDocumentsKeyboardNavigation,
  getDocumentElement,
} from '@/modules/documents/documents-keyboard.composables';
import { useI18n } from '@/modules/i18n/i18n.provider';
import { createParamSynchronizedPagination } from '@/modules/shared/pagination/query-synchronized-pagination';
import { Button } from '@/modules/ui/components/button';
import { createToast } from '@/modules/ui/components/sonner';
import {
  getInboxQueryKey,
  invalidateInboxCountQuery,
  invalidateInboxQueries,
} from '../document-inbox.composables';
import { fetchInboxDocuments, markDocumentsAsReviewed } from '../document-inbox.services';

const NO_SEARCH_QUERY = '';

export const InboxPage: Component = () => {
  const params = useParams();
  const { t } = useI18n();
  const [getPagination, setPagination] = createParamSynchronizedPagination();
  const viewPreference = createDocumentsViewPreference({
    getOrganizationId: () => params.organizationId,
    getTagName: () => undefined,
  });
  const [getQuickLookId, setQuickLookId] = createSignal<string>();
  const [getRowSelection, setRowSelection] = createSignal<RowSelectionState>({});

  const inboxQuery = useQuery(() => ({
    queryKey: [
      ...getInboxQueryKey({ organizationId: params.organizationId }),
      'documents',
      getPagination(),
    ],
    queryFn: async () =>
      fetchInboxDocuments({ organizationId: params.organizationId, ...getPagination() }),
    placeholderData: keepPreviousData,
  }));

  // The list stays as it is while the quick look is open: reviewing a document (opening it is enough) removes it from the inbox,
  // but the keyboard navigation through the list must remain stable. It catches up once the quick look is closed.
  const getDocuments = createMemo<Document[]>(
    (previous) => (getQuickLookId() === undefined ? (inboxQuery.data?.documents ?? []) : previous),
    [],
  );
  const getDocumentsCount = createMemo<number>(
    (previous) =>
      getQuickLookId() === undefined ? (inboxQuery.data?.documentsCount ?? 0) : previous,
    0,
  );

  const keyboardNavigation = createDocumentsKeyboardNavigation({
    getDocuments,
    getView: viewPreference.getView,
    isEnabled: () => getQuickLookId() === undefined,
    onOpen: (document) => setQuickLookId(document.id),
  });

  function openQuickLook(document: { id: string }) {
    keyboardNavigation.setFocusedId(document.id);
    setQuickLookId(document.id);
  }

  function closeQuickLook() {
    setQuickLookId(undefined);
    void invalidateInboxQueries({ organizationId: params.organizationId });
  }

  const getSelectedIds = createMemo(() => {
    const selection = getRowSelection();

    return Object.keys(selection).filter((id) => selection[id]);
  });

  const setSelection: Setter<RowSelectionState> = (valueOrUpdater) =>
    setRowSelection(valueOrUpdater);

  const markAsDoneMutation = useMutation(() => ({
    mutationFn: async ({ documentIds }: { documentIds: string[] }) =>
      markDocumentsAsReviewed({ organizationId: params.organizationId, documentIds }),
    onSuccess: async () => {
      setRowSelection({});
      await invalidateInboxQueries({ organizationId: params.organizationId });
    },
    onError: () => {
      createToast({ type: 'error', message: t('inbox.actions.done.error') });
    },
  }));

  // The quick look keeps the list as it is, only the count follows
  async function markAsDoneFromQuickLook(document: Document) {
    const [, error] = await safely(
      markDocumentsAsReviewed({
        organizationId: document.organizationId,
        documentIds: [document.id],
      }),
    );

    if (error) {
      createToast({ type: 'error', message: t('inbox.actions.done.error') });
      return;
    }

    void invalidateInboxCountQuery({ organizationId: document.organizationId });
  }

  // Everything of the page was reviewed, falls back to the previous page
  createEffect(
    on(
      () => inboxQuery.data,
      (data) => {
        const { pageIndex, pageSize } = getPagination();

        if (data && data.documents.length === 0 && pageIndex > 0) {
          setPagination({ pageIndex: pageIndex - 1, pageSize });
        }
      },
    ),
  );

  const doneColumn: ColumnDef<Document> = {
    id: 'done',
    header: () => <span class="sr-only">{t('inbox.actions.done')}</span>,
    enableSorting: false,
    cell: (data) => (
      <div class="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={markAsDoneMutation.isPending}
          onClick={() => markAsDoneMutation.mutate({ documentIds: [data.row.original.id] })}
        >
          <div class="i-tabler-check size-4 mr-1.5" />
          {t('inbox.actions.done')}
        </Button>
      </div>
    ),
  };

  return (
    <div class="p-6 mt-4 pb-32">
      <Suspense>
        <h2 class="text-xl font-bold">{t('inbox.page.title')}</h2>
        <p class="text-muted-foreground mt-1 mb-6">{t('inbox.page.description')}</p>

        <Show
          when={inboxQuery.data !== undefined && getDocumentsCount() === 0}
          fallback={
            <>
              <div class="flex items-center gap-4">
                <div class="min-h-8 flex flex-1 items-center">
                  <Show
                    when={getSelectedIds().length > 0}
                    fallback={
                      <span class="text-sm text-muted-foreground">
                        {t('inbox.page.count', { count: getDocumentsCount() })}
                      </span>
                    }
                  >
                    <div class="flex flex-1 flex-wrap items-center gap-2 text-sm">
                      <span class="font-medium">
                        {t('documents.list.batch.selected-count', {
                          count: getSelectedIds().length,
                        })}
                      </span>

                      <div class="ml-auto flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={markAsDoneMutation.isPending}
                          onClick={() =>
                            markAsDoneMutation.mutate({ documentIds: getSelectedIds() })
                          }
                        >
                          <div class="i-tabler-checks size-4 mr-2" />
                          {t('inbox.actions.mark-as-done')}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-8"
                          onClick={() => setRowSelection({})}
                          disabled={markAsDoneMutation.isPending}
                          aria-label={t('documents.list.batch.clear')}
                        >
                          <div class="i-tabler-x size-4" />
                        </Button>
                      </div>
                    </div>
                  </Show>
                </div>

                <DocumentsViewToggle
                  view={viewPreference.getView()}
                  onViewChange={viewPreference.setView}
                />
              </div>

              <div class="mt-4">
                <DocumentsPaginatedList
                  documents={getDocuments()}
                  documentsCount={getDocumentsCount()}
                  getPagination={getPagination}
                  setPagination={setPagination}
                  enableBatchSelection
                  getRowSelection={getRowSelection}
                  setRowSelection={setSelection}
                  view={viewPreference.getView()}
                  focusedDocumentId={keyboardNavigation.getFocusedId()}
                  onQuickLook={openQuickLook}
                  onMarkDone={(document) =>
                    markAsDoneMutation.mutate({ documentIds: [document.id] })
                  }
                  extraColumns={[tagsColumn, createdAtColumn, doneColumn, standardActionsColumn]}
                />
              </div>
            </>
          }
        >
          <div class="flex flex-col items-center gap-3 py-16 text-center">
            <div class="i-tabler-inbox size-12 text-muted-foreground/60" />
            <h3 class="text-lg font-semibold">{t('inbox.empty.title')}</h3>
            <p class="max-w-md text-muted-foreground">{t('inbox.empty.description')}</p>
          </div>
        </Show>

        <DocumentQuickLook
          documents={getDocuments()}
          documentId={getQuickLookId()}
          searchQuery={NO_SEARCH_QUERY}
          onDocumentChange={(documentId) => {
            keyboardNavigation.setFocusedId(documentId);
            setQuickLookId(documentId);
            getDocumentElement({ documentId })?.scrollIntoView({ block: 'nearest' });
          }}
          onClose={closeQuickLook}
          onDone={(document) => void markAsDoneFromQuickLook(document)}
        />
      </Suspense>
    </div>
  );
};
