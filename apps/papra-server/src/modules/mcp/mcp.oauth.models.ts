import type { Config } from '../config/config.types';
import { getClientBaseUrl, getMcpServerUrl, getServerBaseUrl } from '../config/config.models';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';
import {
  MCP_OAUTH_CLIENT_NAME_MAX_LENGTH,
  MCP_OAUTH_OFFLINE_ACCESS_SCOPE,
  MCP_OAUTH_REGISTRATION_MAX_CONTACTS,
  MCP_OAUTH_REGISTRATION_MAX_REDIRECT_URIS,
  MCP_OAUTH_REGISTRATION_MAX_URI_LENGTH,
  OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH,
} from './mcp.constants';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// Every URL is built from the configured base URLs, never from the request Host header
export function getMcpOauthUrls({ config }: { config: Config }) {
  const { serverBaseUrl } = getServerBaseUrl({ config });
  const { clientBaseUrl } = getClientBaseUrl({ config });
  const { mcpServerUrl } = getMcpServerUrl({ config });
  const serverRoot = serverBaseUrl.replace(/\/+$/, '');
  const clientRoot = clientBaseUrl.replace(/\/+$/, '');

  return {
    // better-auth is mounted on /api/auth, which makes it the issuer path
    issuer: `${serverRoot}/api/auth`,
    // The audience of the access tokens
    resource: mcpServerUrl,
    protectedResourceMetadataUrl: `${serverRoot}${OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH}/mcp`,
    // The consent page doubles as the login page: it sends signed-out users to the regular sign-in
    // and brings them back with the signed query untouched, see the consent page of the client
    consentPageUrl: `${clientRoot}/oauth/consent`,
  };
}

// 1:1 with the API key permissions, so that the tools' permission check is the only enforcement point
export const MCP_OAUTH_SCOPES = [...API_KEY_PERMISSIONS_VALUES, MCP_OAUTH_OFFLINE_ACCESS_SCOPE];

// Scopes of a token that mean something on /mcp, anything else (offline_access) grants nothing
export function getPermissionsFromOauthScopes({ scope }: { scope: string }) {
  const permissions = new Set<string>(API_KEY_PERMISSIONS_VALUES);

  return {
    permissions: scope.split(' ').filter((value) => permissions.has(value)),
  };
}

export function buildProtectedResourceMetadata({
  resource,
  issuer,
}: {
  resource: string;
  issuer: string;
}) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: API_KEY_PERMISSIONS_VALUES,
    bearer_methods_supported: ['header'],
    resource_name: 'Papra',
  };
}

export function buildWwwAuthenticateHeader({
  protectedResourceMetadataUrl,
  isInvalidToken = false,
}: {
  protectedResourceMetadataUrl: string;
  isInvalidToken?: boolean;
}) {
  return [
    'Bearer realm="papra"',
    ...(isInvalidToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${protectedResourceMetadataUrl}"`,
  ].join(', ');
}

export function isAllowedRedirectUri({ uri }: { uri: string }) {
  if (uri.length > MCP_OAUTH_REGISTRATION_MAX_URI_LENGTH || uri.includes('*')) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  if (url.hash !== '' || uri.includes('#') || url.username !== '' || url.password !== '') {
    return false;
  }

  if (url.protocol === 'https:') {
    return true;
  }

  return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname);
}

// Returns the first problem of an unauthenticated client registration body, undefined when it is acceptable
export function validateClientRegistrationBody({ body }: { body: unknown }) {
  if (typeof body !== 'object' || body === null) {
    return { error: 'invalid_client_metadata', description: 'Invalid registration body' };
  }

  const metadata = body as Record<string, unknown>;

  if (typeof metadata.client_name === 'string') {
    const name = metadata.client_name.trim();

    if (name.length > MCP_OAUTH_CLIENT_NAME_MAX_LENGTH) {
      return {
        error: 'invalid_client_metadata',
        description: `client_name must be at most ${MCP_OAUTH_CLIENT_NAME_MAX_LENGTH} characters`,
      };
    }
  }

  const redirectUris = metadata.redirect_uris;

  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MCP_OAUTH_REGISTRATION_MAX_REDIRECT_URIS
  ) {
    return {
      error: 'invalid_redirect_uri',
      description: `redirect_uris must hold between 1 and ${MCP_OAUTH_REGISTRATION_MAX_REDIRECT_URIS} URIs`,
    };
  }

  if (!redirectUris.every((uri) => typeof uri === 'string' && isAllowedRedirectUri({ uri }))) {
    return {
      error: 'invalid_redirect_uri',
      description:
        'redirect_uris must be https URIs, or http URIs on a loopback host, without fragment or wildcard',
    };
  }

  const postLogoutRedirectUris = metadata.post_logout_redirect_uris;
  if (
    postLogoutRedirectUris !== undefined &&
    (!Array.isArray(postLogoutRedirectUris) ||
      postLogoutRedirectUris.length > MCP_OAUTH_REGISTRATION_MAX_REDIRECT_URIS ||
      !postLogoutRedirectUris.every(
        (uri) => typeof uri === 'string' && isAllowedRedirectUri({ uri }),
      ))
  ) {
    return {
      error: 'invalid_client_metadata',
      description: 'post_logout_redirect_uris must follow the same rules as redirect_uris',
    };
  }

  const grantTypes = metadata.grant_types;
  if (
    grantTypes !== undefined &&
    (!Array.isArray(grantTypes) ||
      !grantTypes.every((grant) => grant === 'authorization_code' || grant === 'refresh_token'))
  ) {
    return {
      error: 'invalid_client_metadata',
      description: 'Only the authorization_code and refresh_token grants are supported',
    };
  }

  if (
    metadata.token_endpoint_auth_method !== undefined &&
    metadata.token_endpoint_auth_method !== 'none'
  ) {
    return {
      error: 'invalid_client_metadata',
      description: 'Only public clients (token_endpoint_auth_method none) can be registered',
    };
  }

  for (const key of [
    'client_uri',
    'logo_uri',
    'tos_uri',
    'policy_uri',
    'software_id',
    'software_version',
    'software_statement',
    'scope',
  ]) {
    const value = metadata[key];

    if (typeof value === 'string' && value.length > MCP_OAUTH_REGISTRATION_MAX_URI_LENGTH) {
      return { error: 'invalid_client_metadata', description: `${key} is too long` };
    }
  }

  const contacts = metadata.contacts;
  if (
    Array.isArray(contacts) &&
    (contacts.length > MCP_OAUTH_REGISTRATION_MAX_CONTACTS ||
      contacts.some((contact) => typeof contact === 'string' && contact.length > 320))
  ) {
    return { error: 'invalid_client_metadata', description: 'Too many or too long contacts' };
  }

  return undefined;
}
