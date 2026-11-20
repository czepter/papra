import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Database } from '../app/database/database.types';
import { API_KEY_PERMISSIONS } from '../api-keys/api-keys.constants';
import { createOrganizationsRepository } from '../organizations/organizations.repository';
import { getUserIdFromAuthInfo } from './mcp.authentication';

function toolError({ message }: { message: string }): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function registerMcpTools({ server, db }: { server: McpServer; db: Database }) {
  server.registerTool(
    'ping',
    {
      description: 'Check that the connection to the Papra MCP server works. Returns "pong".',
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  );

  server.registerTool(
    'list_organizations',
    {
      description:
        'List the organizations the authenticated user is a member of. Requires the organizations:read API key permission.',
      annotations: { readOnlyHint: true },
    },
    async ({ authInfo }): Promise<CallToolResult> => {
      // The user comes from the verified API key only, never from tool arguments
      const { userId } = getUserIdFromAuthInfo({ authInfo });

      if (userId === undefined) {
        return toolError({ message: 'Unauthorized' });
      }

      if (!authInfo?.scopes.includes(API_KEY_PERMISSIONS.ORGANIZATIONS.READ)) {
        return toolError({
          message: `The API key is missing the ${API_KEY_PERMISSIONS.ORGANIZATIONS.READ} permission`,
        });
      }

      const organizationsRepository = createOrganizationsRepository({ db });
      const { organizations } = await organizationsRepository.getUserOrganizations({ userId });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              organizations: organizations.map(({ id, name }) => ({ id, name })),
            }),
          },
        ],
      };
    },
  );
}
