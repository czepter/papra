import type { Context } from 'hono';
import type { RouteDefinitionContext } from '../app/server.types';
import { bearerAuth, StreamableHTTPTransport } from '@hono/mcp';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { bodyLimit } from 'hono/body-limit';
import { formatPublicErrorPayload } from '../shared/errors/errors';
import { API_KEY_PREFIX } from '../api-keys/api-keys.constants';
import { buildVerifyApiKeyToken } from './mcp.authentication';
import { MCP_REQUEST_BODY_MAX_SIZE } from './mcp.constants';
import { createMcpRequestBodyTooLargeError } from './mcp.errors';
import { buildVerifyOauthAccessToken } from './mcp.oauth';
import { buildWwwAuthenticateHeader, getMcpOauthUrls } from './mcp.oauth.models';
import { registerMcpTools } from './mcp.tools';

export const MCP_ROUTE_PATH = '/mcp';

// Same body for a missing and an invalid token, so the response does not reveal whether a key exists
const unauthorizedPayload = formatPublicErrorPayload({
  message: 'Unauthorized',
  code: 'auth.unauthorized',
});

export function registerMcpRoutes({ app, ...deps }: RouteDefinitionContext) {
  const { db, config, auth } = deps;
  const verifyApiKeyToken = buildVerifyApiKeyToken({ db });
  const verifyOauthAccessToken = buildVerifyOauthAccessToken({ auth, db, config });
  const { protectedResourceMetadataUrl } = getMcpOauthUrls({ config });

  // The challenge points MCP clients at the protected resource metadata, where they find the authorization server
  const challenge = buildWwwAuthenticateHeader({ protectedResourceMetadataUrl });
  const invalidTokenChallenge = buildWwwAuthenticateHeader({
    protectedResourceMetadataUrl,
    isInvalidToken: true,
  });

  app.all(
    MCP_ROUTE_PATH,
    bearerAuth({
      noAuthenticationHeader: {
        wwwAuthenticateHeader: challenge,
        message: unauthorizedPayload,
      },
      invalidAuthenticationHeader: {
        wwwAuthenticateHeader: challenge,
        message: unauthorizedPayload,
      },
      invalidToken: {
        wwwAuthenticateHeader: invalidTokenChallenge,
        message: unauthorizedPayload,
      },
      verifyToken: async (token, context: Context) => {
        // Papra API keys keep their own path, any other token is an OAuth access token
        const { authInfo } = token.startsWith(`${API_KEY_PREFIX}_`)
          ? await verifyApiKeyToken({ token })
          : await verifyOauthAccessToken({ token });

        if (!authInfo) {
          return false;
        }

        // Read by StreamableHTTPTransport and forwarded to the tool handlers as extra.authInfo
        context.set('auth', authInfo);
        return true;
      },
    }),
    // After the authentication, so an unauthenticated caller cannot make the server read a large body
    bodyLimit({
      maxSize: MCP_REQUEST_BODY_MAX_SIZE,
      onError: (context) =>
        context.json(formatPublicErrorPayload(createMcpRequestBodyTooLargeError()), 413),
    }),
    async (context) => {
      // Stateless mode: there is no server-initiated stream nor session to close
      if (context.req.method !== 'POST') {
        return context.json(
          {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed.' },
            id: null,
          },
          405,
          { Allow: 'POST' },
        );
      }

      // A server and transport pair per request: the transport remembers the request being handled,
      // so sharing one between concurrent callers could mix up their auth info.
      const server = new Server({ name: 'papra', version: config.version }, { capabilities: {} });
      registerMcpTools({ server, deps });

      // No sessionIdGenerator: the transport is stateless
      const transport = new StreamableHTTPTransport();
      await server.connect(transport);

      return transport.handleRequest(context);
    },
  );
}
