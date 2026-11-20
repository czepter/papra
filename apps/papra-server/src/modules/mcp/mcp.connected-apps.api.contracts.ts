import * as v from 'valibot';
import { errorResponseDefinition } from '../api/api.contracts.errors';
import { defineApiContract } from '../api/api.contracts';
import { isoDateStringSchema } from '../api/api.schemas';
import { connectedAppNotFoundErrorDefinition } from './mcp.errors';

export const getConnectedAppsContract = defineApiContract({
  operationId: 'getConnectedApps',
  path: '/api/users/me/connected-apps',
  method: 'GET',
  responses: {
    200: {
      description:
        'Returns the OAuth clients (MCP apps) the current user has approved. Session authentication only.',
      content: {
        'application/json': {
          schema: v.object({
            connectedApps: v.array(
              v.object({
                clientId: v.string(),
                clientName: v.nullable(v.string()),
                redirectHosts: v.array(v.string()),
                scopes: v.array(v.string()),
                authorizedAt: isoDateStringSchema,
                updatedAt: isoDateStringSchema,
                lastActiveAt: v.nullable(isoDateStringSchema),
              }),
            ),
          }),
        },
      },
    },
  },
});

export const revokeConnectedAppContract = defineApiContract({
  operationId: 'revokeConnectedApp',
  path: '/api/users/me/connected-apps/:clientId',
  method: 'DELETE',
  request: {
    params: v.strictObject({
      clientId: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    }),
  },
  responses: {
    204: {
      description:
        'Removes the consent and the tokens of the current user for this app. Other users of the same app are not affected. Session authentication only.',
      content: {},
    },
    ...errorResponseDefinition(connectedAppNotFoundErrorDefinition),
  },
});
