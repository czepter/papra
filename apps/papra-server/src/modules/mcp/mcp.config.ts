import type { ConfigDefinition } from 'figue';
import { booleanishSchema } from '../config/config.schemas';

export const mcpConfig = {
  enabled: {
    doc: 'Whether the MCP (Model Context Protocol) server is enabled. When enabled, MCP clients can connect to the /mcp endpoint of the server, authenticating with an API key sent as a bearer token or, through OAuth, by signing in to Papra and approving the access. This also turns the OAuth authorization server for MCP clients (dynamic client registration, authorize, token and revoke endpoints under /api/auth/oauth2 and the /.well-known metadata) on or off',
    schema: booleanishSchema,
    default: true,
    env: 'MCP_SERVER_ENABLED',
  },
} as const satisfies ConfigDefinition;
