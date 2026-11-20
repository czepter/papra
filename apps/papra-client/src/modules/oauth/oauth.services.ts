import { authFetch } from '../auth/auth.services';

export type OauthPublicClient = {
  client_id: string;
  client_name?: string;
};

type FetchResult<T> = { data: T | null; error: { message?: string; status?: number } | null };

// The oauth provider client plugin adds the signed query of the current page to these POST requests
export async function fetchOauthPublicClient({ clientId }: { clientId: string }) {
  const { data, error } = (await authFetch('/oauth2/public-client-prelogin', {
    method: 'POST',
    body: { client_id: clientId },
  })) as FetchResult<OauthPublicClient>;

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to load the application');
  }

  return data;
}

export async function submitOauthConsent({ accept }: { accept: boolean }) {
  const { data, error } = (await authFetch('/oauth2/consent', {
    method: 'POST',
    body: { accept },
  })) as FetchResult<{ redirect: boolean; url: string }>;

  if (error || !data?.url) {
    throw new Error(error?.message ?? 'Unable to submit the decision');
  }

  return { redirectUrl: data.url };
}
