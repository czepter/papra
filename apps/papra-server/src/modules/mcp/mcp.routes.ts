import type { Context } from 'hono';
import type { RouteDefinitionContext } from '../app/server.types';
import { bearerAuth, StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatPublicErrorPayload } from '../shared/errors/errors';
import { buildVerifyApiKeyToken } from './mcp.authentication';
import { registerMcpTools } from './mcp.tools';

export const MCP_ROUTE_PATH = '/mcp';

// Plain bearer challenge: no OAuth metadata route is served yet, so no resource_metadata is advertised
const BEARER_CHALLENGE = 'Bearer realm="papra"';

// Same body for a missing and an invalid token, so the response does not reveal whether a key exists
const unauthorizedPayload = formatPublicErrorPayload({
  message: 'Unauthorized',
  code: 'auth.unauthorized',
});

export function registerMcpRoutes({ app, db, config }: RouteDefinitionContext) {
  const verifyApiKeyToken = buildVerifyApiKeyToken({ db });

  app.all(
    MCP_ROUTE_PATH,
    bearerAuth({
      noAuthenticationHeader: {
        wwwAuthenticateHeader: BEARER_CHALLENGE,
        message: unauthorizedPayload,
      },
      invalidAuthenticationHeader: {
        wwwAuthenticateHeader: BEARER_CHALLENGE,
        message: unauthorizedPayload,
      },
      invalidToken: {
        wwwAuthenticateHeader: 'Bearer realm="papra", error="invalid_token"',
        message: unauthorizedPayload,
      },
      verifyToken: async (token, context: Context) => {
        const { authInfo } = await verifyApiKeyToken({ token });

        if (!authInfo) {
          return false;
        }

        // Read by StreamableHTTPTransport and forwarded to the tool handlers as extra.authInfo
        context.set('auth', authInfo);
        return true;
      },
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
      const server = new McpServer({ name: 'papra', version: config.version });
      registerMcpTools({ server, db });

      // No sessionIdGenerator: the transport is stateless
      const transport = new StreamableHTTPTransport();
      await server.connect(transport);

      return transport.handleRequest(context);
    },
  );
}
