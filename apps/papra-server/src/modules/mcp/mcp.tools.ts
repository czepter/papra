import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as v from 'valibot';
import type { McpToolDefinition, McpToolDependencies } from './mcp.tools.types';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { getDotPath, safeParse } from 'valibot';
import { createOrganizationsRepository } from '../organizations/organizations.repository';
import { ensureUserIsInOrganization } from '../organizations/organizations.usecases';
import { formatPublicErrorPayload, isCustomError } from '../shared/errors/errors';
import { createLogger } from '../shared/logger/logger';
import { getUserIdFromAuthInfo } from './mcp.authentication';
import { mcpTools } from './mcp.tools.catalogue';
import { toToolInputJsonSchema } from './mcp.schemas';

const logger = createLogger({ namespace: 'mcp:tools' });

// Built once at module load, only the registration on the per-request server is repeated
const toolsList = mcpTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: toToolInputJsonSchema({ schema: tool.input, override: tool.jsonSchemaOverride }),
  annotations: tool.annotations,
}));

const toolsByName = new Map(mcpTools.map((tool) => [tool.name, tool]));

function textResult({
  text,
  isError = false,
}: {
  text: string;
  isError?: boolean;
}): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) };
}

function toolError({ message }: { message: string }) {
  return textResult({ text: message, isError: true });
}

// Issue paths and messages only: no stack, and valibot truncates the received values it quotes
function formatValidationIssues({ issues }: { issues: v.BaseIssue<unknown>[] }) {
  const lines = issues.map((issue) => {
    const path = getDotPath(issue);
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return `Invalid arguments. ${lines.join('; ')}`;
}

export async function executeMcpTool({
  tool,
  args,
  authInfo,
  deps,
}: {
  tool: McpToolDefinition;
  args: unknown;
  authInfo: AuthInfo | undefined;
  deps: McpToolDependencies;
}): Promise<CallToolResult> {
  // 1. The user comes from the verified API key only, never from tool arguments
  const { userId } = getUserIdFromAuthInfo({ authInfo });

  if (userId === undefined) {
    return toolError({ message: 'Unauthorized' });
  }

  // 2. Same rule as the REST routes: the key must hold every permission, checked before any database read
  const scopes = authInfo?.scopes ?? [];
  const missingPermissions = tool.permissions.filter((permission) => !scopes.includes(permission));

  if (missingPermissions.length > 0) {
    return toolError({
      message: `The API key is missing the ${missingPermissions.join(', ')} permission${missingPermissions.length > 1 ? 's' : ''}`,
    });
  }

  // 3. Parse the arguments with the valibot schema, the JSON Schema of tools/list is advisory only
  const parseResult = safeParse(tool.input, args ?? {});

  if (!parseResult.success) {
    return toolError({ message: formatValidationIssues({ issues: parseResult.issues }) });
  }

  const input: unknown = parseResult.output;

  try {
    // 4. Membership is checked on every call, so removing a member takes effect at once
    if (typeof input === 'object' && input !== null && 'organizationId' in input) {
      await ensureUserIsInOrganization({
        userId,
        organizationId: String(input.organizationId),
        organizationsRepository: createOrganizationsRepository({ db: deps.db }),
      });
    }

    // 5. Handler
    const result = await tool.handler({ input, userId, deps });

    return textResult({ text: typeof result === 'string' ? result : JSON.stringify(result) });
  } catch (error) {
    // 6. Public errors reach the model as they reach REST clients, everything else stays in the server log
    if (isCustomError(error) && !error.isInternal) {
      return toolError({ message: JSON.stringify(formatPublicErrorPayload(error)) });
    }

    logger.error({ error, toolName: tool.name }, 'MCP tool failed');

    return toolError({ message: 'An error occurred' });
  }
}

// McpServer.registerTool only accepts zod schemas, so the low-level handlers publish the JSON Schemas generated from valibot
export function registerMcpTools({ server, deps }: { server: Server; deps: McpToolDependencies }) {
  server.registerCapabilities({ tools: {} });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsList }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { authInfo }) => {
    const tool = toolsByName.get(params.name);

    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
    }

    return executeMcpTool({ tool, args: params.arguments, authInfo, deps });
  });
}
