import type { Accessor } from 'solid-js';
import type { Document } from './documents.types';
import type { DocumentPreviewVariant } from './document-previews.models';
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { getInitialPreviewDisplayState } from './document-previews.models';
import { getDocumentPreviewUrl, waitForDocumentPreview } from './document-previews.services';

// Resolves what to render for a document preview variant:
// - ready: the url can be set on an <img>
// - loading: generation is pending, polled with backoff until ready or unavailable
// - unavailable: unsupported, failed, gave up waiting or the image failed to load, render a type tile
export function createDocumentPreview({
  getDocument,
  variant,
}: {
  getDocument: Accessor<Pick<Document, 'id' | 'organizationId' | 'previewStatus'>>;
  variant: DocumentPreviewVariant;
}) {
  const [getResolved, setResolved] = createSignal<'ready' | 'unavailable'>();
  const [getHasImageFailed, setHasImageFailed] = createSignal(false);

  const getUrl = createMemo(() =>
    getDocumentPreviewUrl({
      organizationId: getDocument().organizationId,
      documentId: getDocument().id,
      variant,
    }),
  );

  const getInitialState = createMemo(() =>
    getInitialPreviewDisplayState({ previewStatus: getDocument().previewStatus }),
  );

  createEffect(
    on(getUrl, (url) => {
      setResolved(undefined);
      setHasImageFailed(false);

      if (getInitialState() !== 'loading') {
        return;
      }

      const abortController = new AbortController();

      waitForDocumentPreview({ url, signal: abortController.signal })
        .then(setResolved)
        .catch(() => {
          // Aborted on cleanup
        });

      onCleanup(() => abortController.abort());
    }),
  );

  const getState = createMemo(() => {
    if (getHasImageFailed()) {
      return 'unavailable' as const;
    }

    const initialState = getInitialState();

    return initialState === 'loading' ? (getResolved() ?? 'loading') : initialState;
  });

  return {
    getUrl,
    getState,
    onImageError: () => setHasImageFailed(true),
  };
}
