import { API_KEY_PERMISSIONS } from '../api-keys/api-keys.constants';

export const OFFLINE_ACCESS_SCOPE = 'offline_access';

const knownPermissions = new Set<string>(
  API_KEY_PERMISSIONS.flatMap(({ permissions }) => [...permissions]),
);

export type ScopeGroup = {
  // A section of the API key permissions (organizations, documents...), or "connection" for the rest
  section: string;
  scopes: { scope: string; isKnown: boolean }[];
};

// Groups the requested scopes by resource, in the order of the API key permissions
export function getScopeGroups({ scope }: { scope: string | undefined }): ScopeGroup[] {
  const requested = new Set((scope ?? '').split(' ').filter((value) => value !== ''));

  const groups: ScopeGroup[] = API_KEY_PERMISSIONS.map(({ section, permissions }) => ({
    section,
    scopes: permissions
      .filter((permission) => requested.has(permission))
      .map((permission) => ({ scope: permission, isKnown: true })),
  })).filter(({ scopes }) => scopes.length > 0);

  const connectionScopes = [...requested]
    .filter((value) => !knownPermissions.has(value))
    .toSorted((a, b) => Number(b === OFFLINE_ACCESS_SCOPE) - Number(a === OFFLINE_ACCESS_SCOPE))
    .map((value) => ({ scope: value, isKnown: value === OFFLINE_ACCESS_SCOPE }));

  if (connectionScopes.length > 0) {
    groups.push({ section: 'connection', scopes: connectionScopes });
  }

  return groups;
}

// The host (with port) the authorization code is sent to, shown because anyone can register a client under any name
export function getRedirectHost({ redirectUri }: { redirectUri: string | undefined }) {
  if (!redirectUri) {
    return undefined;
  }

  try {
    return new URL(redirectUri).host || undefined;
  } catch {
    return undefined;
  }
}

// The server only issues redirects to registered http(s) URIs, this is a second guard before leaving the page
export function isSafeRedirectUrl({ url }: { url: string }) {
  try {
    const { protocol } = new URL(url);

    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function getClientDisplayName({ name }: { name: string | undefined | null }) {
  const trimmed = name?.trim();

  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
