import type { Context, RouteDefinitionContext } from '../app/server.types';
import { checkRateLimit } from '../app/rate-limit/rate-limit.usecases';
import { scopeKvStoreForRateLimit } from '../app/rate-limit/rate-limit.kv-store';
import { joinKeyParts } from '../kv-store/kv-store.models';
import { isNil } from '../shared/utils';
import {
  MCP_OAUTH_REGISTRATION_RATE_LIMIT_GLOBAL,
  MCP_OAUTH_REGISTRATION_RATE_LIMIT_PER_IP,
  OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH,
  OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH,
} from './mcp.constants';
import { getAuthServerMetadataHandler } from './mcp.oauth';
import { buildProtectedResourceMetadata, getMcpOauthUrls } from './mcp.oauth.models';

export const OAUTH_REGISTER_PATH = '/api/auth/oauth2/register';

const METADATA_CACHE_CONTROL = 'public, max-age=15, stale-while-revalidate=15';

function getClientIp({ context, headers }: { context: Context; headers: string[] }) {
  for (const header of headers) {
    const value = context.req.header(header)?.split(',')[0]?.trim();

    if (!isNil(value) && value !== '') {
      return value;
    }
  }

  return 'unknown';
}

// Registered before the better-auth catch-all, so that the metadata and the registration guard come first
export function registerMcpOauthRoutes({ app, config, auth, kvStore }: RouteDefinitionContext) {
  const { issuer, resource } = getMcpOauthUrls({ config });
  const authServerMetadataHandler = getAuthServerMetadataHandler({ auth });
  const rateLimitKvStore = scopeKvStoreForRateLimit({ kvStore });

  // Authorization server metadata, at every location a client probes: the root (RFC 8414 without path),
  // the path-issuer form of RFC 8414 and under the issuer itself. The body is the plugin's, built from the configured base URL.
  for (const path of [
    OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH,
    `${OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH}/api/auth`,
    '/api/auth/.well-known/oauth-authorization-server',
  ]) {
    app.get(path, async (context) => authServerMetadataHandler(context.req.raw));
  }

  // The same document at the bare path and at the resource-specific path (RFC 9728)
  for (const path of [
    OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH,
    `${OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH}/mcp`,
  ]) {
    app.get(path, async (context) => {
      context.header('Cache-Control', METADATA_CACHE_CONTROL);

      return context.json(buildProtectedResourceMetadata({ resource, issuer }));
    });
  }

  // Open registration: limited per client address and globally
  app.post(OAUTH_REGISTER_PATH, async (context, next) => {
    const ip = getClientIp({ context, headers: config.auth.ipAddressHeaders });

    await checkRateLimit({
      ...MCP_OAUTH_REGISTRATION_RATE_LIMIT_PER_IP,
      key: joinKeyParts(['oauth-client-registration', 'ip', ip]),
      kvStore: rateLimitKvStore,
    });
    await checkRateLimit({
      ...MCP_OAUTH_REGISTRATION_RATE_LIMIT_GLOBAL,
      key: joinKeyParts(['oauth-client-registration', 'global']),
      kvStore: rateLimitKvStore,
    });

    return next();
  });
}
