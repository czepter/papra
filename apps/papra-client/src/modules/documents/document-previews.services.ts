import type { DocumentPreviewVariant } from './document-previews.models';
import { buildTimeConfig } from '../config/config';
import { createConcurrencyLimiter } from '../shared/utils/concurrency';
import {
  getDocumentPreviewUrl as buildDocumentPreviewUrl,
  getPreviewRetryDelayMs,
  PREVIEW_MAX_ATTEMPTS,
} from './document-previews.models';

// Previews are loaded with a plain <img src>: the session cookie is sent along with the request
// (same-origin, or same-site when the API is on another subdomain), and the browser handles lazy loading and caching.
export function getDocumentPreviewUrl({
  organizationId,
  documentId,
  variant,
}: {
  organizationId: string;
  documentId: string;
  variant: DocumentPreviewVariant;
}) {
  return buildDocumentPreviewUrl({
    baseUrl: buildTimeConfig.baseApiUrl,
    organizationId,
    documentId,
    variant,
  });
}

type PreviewProbeResult =
  | { status: 'ready' }
  | { status: 'unavailable' }
  | { status: 'not-ready'; retryAfterSeconds?: number };

// An <img> cannot tell a 503 (generation scheduled, retry later) from a 404 (never retry), so previews that are
// still pending are requested with fetch to read the status code.
async function probeDocumentPreview({
  url,
  signal,
}: {
  url: string;
  signal: AbortSignal;
}): Promise<PreviewProbeResult> {
  try {
    const response = await fetch(url, { credentials: 'include', signal });

    if (response.ok) {
      // Only the status matters, the image itself is then loaded by the <img> from the http cache
      void response.body?.cancel();
      return { status: 'ready' };
    }

    if (response.status >= 500) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);

      return {
        status: 'not-ready',
        retryAfterSeconds: Number.isNaN(retryAfter) ? undefined : retryAfter,
      };
    }

    return { status: 'unavailable' };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    // Network error, treated as transient
    return { status: 'not-ready' };
  }
}

async function sleep({ ms, signal }: { ms: number; signal: AbortSignal }) {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// A page can list many documents with pending previews, only a few probes run at once
const probeLimiter = createConcurrencyLimiter({ maxConcurrency: 4 });

// Resolves once the preview is ready or known to be unavailable, retrying with backoff while generation is in progress.
// Gives up (unavailable) after a bounded number of attempts. Rejects when aborted.
export async function waitForDocumentPreview({
  url,
  signal,
}: {
  url: string;
  signal: AbortSignal;
}): Promise<'ready' | 'unavailable'> {
  for (let attempt = 0; attempt < PREVIEW_MAX_ATTEMPTS; attempt += 1) {
    signal.throwIfAborted();

    const result = await probeLimiter.run(async () => {
      signal.throwIfAborted();
      return probeDocumentPreview({ url, signal });
    });

    if (result.status !== 'not-ready') {
      return result.status;
    }

    await sleep({
      ms: getPreviewRetryDelayMs({
        attempt,
        retryAfterSeconds: result.retryAfterSeconds,
        jitter: Math.random() * 1000,
      }),
      signal,
    });
  }

  return 'unavailable';
}
