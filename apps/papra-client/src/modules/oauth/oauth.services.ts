import { oauth2 } from '../auth/auth.services';

// The oauth provider client plugin adds the signed query of the current page to these POST requests
export async function fetchOauthPublicClient({ clientId }: { clientId: string }) {
  const { data, error } = await oauth2.publicClientPrelogin({ client_id: clientId });

  if (error || !data) {
    throw new Error(error?.message ?? 'Unable to load the application');
  }

  return data;
}

export async function submitOauthConsent({ accept }: { accept: boolean }) {
  const { data, error } = await oauth2.consent({ accept });

  if (error || !data?.url) {
    throw new Error(error?.message ?? 'Unable to submit the decision');
  }

  return { redirectUrl: data.url };
}
