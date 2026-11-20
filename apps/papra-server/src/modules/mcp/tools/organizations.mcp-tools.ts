import * as v from 'valibot';
import { createOrganizationsRepository } from '../../organizations/organizations.repository';
import { defineMcpTool, READ_ONLY_ANNOTATIONS } from '../mcp.tools.types';

export const pingTool = defineMcpTool({
  name: 'ping',
  description: 'Check that the connection to the Papra MCP server works. Returns "pong".',
  // Not strict: clients may send extra keys, none of them is used
  input: v.object({}),
  permissions: [],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async () => 'pong',
});

export const listOrganizationsTool = defineMcpTool({
  name: 'list_organizations',
  description:
    'List the organizations the authenticated user is a member of. Every other tool needs the id of one of them as organizationId. Requires the organizations:read API key permission.',
  // Not strict: a user id passed by a client is ignored, the user comes from the API key
  input: v.object({}),
  permissions: ['organizations:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ userId, deps }) => {
    const organizationsRepository = createOrganizationsRepository({ db: deps.db });
    const { organizations } = await organizationsRepository.getUserOrganizations({ userId });

    return { organizations: organizations.map(({ id, name }) => ({ id, name })) };
  },
});
