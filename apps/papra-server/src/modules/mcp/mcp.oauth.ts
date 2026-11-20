import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Config } from '../config/config.types';
import type { Database } from '../app/database/database.types';
import { oauthProvider, oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { oauthClientsTable, oauthConsentsTable } from '../app/auth/auth.oauth.tables';
import { usersTable } from '../users/users.table';
import { createLogger } from '../shared/logger/logger';
import {
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
} from './mcp.constants';
import { buildAuthInfo } from './mcp.authentication';
import {
  getMcpOauthUrls,
  getPermissionsFromOauthScopes,
  MCP_OAUTH_SCOPES,
  validateClientRegistrationBody,
} from './mcp.oauth.models';

const logger = createLogger({ namespace: 'mcp:oauth' });

// The only algorithm of the jwt plugin keys (its default), pinned so a token cannot pick another one
const ACCESS_TOKEN_ALGORITHM = 'EdDSA';

// Rejects an unacceptable dynamic client registration before the plugin stores anything
function createRegistrationGuardPlugin() {
  return {
    id: 'papra-oauth-registration-guard',
    hooks: {
      before: [
        {
          matcher: (context: { path?: string }) => context.path === '/oauth2/register',
          handler: createAuthMiddleware(async (context) => {
            const problem = validateClientRegistrationBody({ body: context.body });

            if (problem) {
              throw new APIError('BAD_REQUEST', {
                error: problem.error,
                error_description: problem.description,
              });
            }
          }),
        },
      ],
    },
  };
}

// Plugins registered only when the MCP server is enabled
export function buildMcpOauthPlugins({ config }: { config: Config }) {
  const { issuer, resource, consentPageUrl } = getMcpOauthUrls({ config });

  return [
    jwt({
      jwt: { issuer },
      // The jwt plugin would otherwise attach a session token to every get-session response
      disableSettingJwtHeader: true,
    }),
    createRegistrationGuardPlugin(),
    oauthProvider({
      // The consent page checks the session itself and sends signed-out users to the sign-in first
      loginPage: consentPageUrl,
      consentPage: consentPageUrl,
      scopes: MCP_OAUTH_SCOPES,
      validAudiences: [resource],
      allowDynamicClientRegistration: true,
      // The consent page verifies the signed authorization request this way before it shows the client
      allowPublicClientPrelogin: true,
      allowUnauthenticatedClientRegistration: true,
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      codeExpiresIn: MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
      // The metadata is served by Papra at the root paths MCP clients probe
      silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
    }),
  ];
}

type OauthAuth = {
  api: {
    getJwks: (options: Record<string, never>) => Promise<{ keys: unknown[] }>;
    getOAuthServerConfig: (...args: never[]) => unknown;
  };
};

export function getAuthServerMetadataHandler({ auth }: { auth: unknown }) {
  return oauthProviderAuthServerMetadata(
    auth as Parameters<typeof oauthProviderAuthServerMetadata>[0],
  );
}

// Verifies an OAuth access token presented to /mcp: signature (local JWKS, no HTTP call), expiry, issuer and
// audience (exactly the /mcp URL), then that the user, the client and the user's consent still exist.
export function buildVerifyOauthAccessToken({
  auth,
  db,
  config,
}: {
  auth: unknown;
  db: Database;
  config: Config;
}) {
  const { issuer, resource } = getMcpOauthUrls({ config });

  return async ({ token }: { token: string }): Promise<{ authInfo: AuthInfo | undefined }> => {
    try {
      // A JWT only: opaque tokens (issued when no resource is requested) carry no audience
      if (
        token.split('.').length !== 3 ||
        decodeProtectedHeader(token).alg !== ACCESS_TOKEN_ALGORITHM
      ) {
        return { authInfo: undefined };
      }

      const jwks = await (auth as OauthAuth).api.getJwks({});
      const { payload } = await jwtVerify(
        token,
        createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]),
        { issuer, audience: resource, algorithms: [ACCESS_TOKEN_ALGORITHM] },
      );

      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const { sub: userId, azp: clientId, scope } = payload;

      if (
        audiences.length !== 1 ||
        audiences[0] !== resource ||
        typeof userId !== 'string' ||
        typeof clientId !== 'string' ||
        typeof scope !== 'string'
      ) {
        return { authInfo: undefined };
      }

      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, userId));

      const [client] = await db
        .select({ disabled: oauthClientsTable.disabled })
        .from(oauthClientsTable)
        .where(eq(oauthClientsTable.clientId, clientId));

      const [consent] = await db
        .select({ id: oauthConsentsTable.id, createdAt: oauthConsentsTable.createdAt })
        .from(oauthConsentsTable)
        .where(
          and(eq(oauthConsentsTable.clientId, clientId), eq(oauthConsentsTable.userId, userId)),
        );

      if (!user || !client || client.disabled || !consent) {
        return { authInfo: undefined };
      }

      // A token issued before the current consent was given belongs to an approval that was revoked since:
      // approving the app again must not revive it. Both values have one second resolution.
      const { iat } = payload;
      if (
        typeof iat !== 'number' ||
        !consent.createdAt ||
        iat < Math.floor(consent.createdAt.getTime() / 1000)
      ) {
        return { authInfo: undefined };
      }

      const { permissions } = getPermissionsFromOauthScopes({ scope });

      return {
        authInfo: buildAuthInfo({ userId, clientId, permissions, authType: 'oauth' }),
      };
    } catch (error) {
      // Expired, malformed or wrongly signed tokens end up here. Never log the token itself.
      logger.debug(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'OAuth access token rejected',
      );

      return { authInfo: undefined };
    }
  };
}
