import type { ApiDependencies } from '../app/server.types';
import { defineApiRoute } from '../api/api.routes';
import {
  getConnectedAppsContract,
  revokeConnectedAppContract,
} from './mcp.connected-apps.api.contracts';
import { createMcpConnectedAppsRepository } from './mcp.connected-apps.repository';
import { revokeConnectedApp } from './mcp.connected-apps.usecases';

export function buildMcpConnectedAppsApiRoutes(deps: ApiDependencies) {
  return [setupGetConnectedAppsRoute(deps), setupRevokeConnectedAppRoute(deps)];
}

// Session only: no apiKeyPermissions, so an API key is refused the way key management is
function setupGetConnectedAppsRoute({ resolveAuthenticationContext, db }: ApiDependencies) {
  return defineApiRoute({
    contract: getConnectedAppsContract,
    resolveContext: resolveAuthenticationContext(),
    handler: async ({ context: { userId } }) => {
      const mcpConnectedAppsRepository = createMcpConnectedAppsRepository({ db });
      const { connectedApps } = await mcpConnectedAppsRepository.getUserConnectedApps({ userId });

      return {
        status: 200,
        contentType: 'application/json',
        body: {
          connectedApps: connectedApps.map((app) => ({
            clientId: app.clientId,
            clientName: app.clientName,
            redirectHosts: app.redirectHosts,
            scopes: app.scopes,
            authorizedAt: app.authorizedAt.toISOString(),
            updatedAt: app.updatedAt.toISOString(),
            lastActiveAt: app.lastActiveAt?.toISOString() ?? null,
          })),
        },
      };
    },
  });
}

function setupRevokeConnectedAppRoute({ resolveAuthenticationContext, db }: ApiDependencies) {
  return defineApiRoute({
    contract: revokeConnectedAppContract,
    resolveContext: resolveAuthenticationContext(),
    handler: async ({ context: { userId }, params: { clientId } }) => {
      const mcpConnectedAppsRepository = createMcpConnectedAppsRepository({ db });

      await revokeConnectedApp({ userId, clientId, mcpConnectedAppsRepository });

      return { status: 204 };
    },
  });
}
