import type { ConfigDefinition } from 'figue';
import { booleanishSchema } from '../config/config.schemas';

export const mcpConfig = {
  enabled: {
    doc: 'Whether the MCP (Model Context Protocol) server is enabled. When enabled, MCP clients can connect to the /mcp endpoint of the server, authenticating with an API key sent as a bearer token',
    schema: booleanishSchema,
    default: true,
    env: 'MCP_SERVER_ENABLED',
  },
} as const satisfies ConfigDefinition;
