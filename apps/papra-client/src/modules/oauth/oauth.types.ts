export type OauthPublicClient = {
  client_id: string;
  client_name?: string;
};

export type OauthFetchResult<T> = {
  data: T | null;
  error: { message?: string; status?: number } | null;
};

export type OauthProviderActions = {
  // POST /oauth2/consent
  consent: (body: {
    accept: boolean;
  }) => Promise<OauthFetchResult<{ redirect: boolean; url: string }>>;
  // POST /oauth2/public-client-prelogin: verifies the signed authorization request, then returns the public client fields
  publicClientPrelogin: (body: {
    client_id: string;
  }) => Promise<OauthFetchResult<OauthPublicClient>>;
};
