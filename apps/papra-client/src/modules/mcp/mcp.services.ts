import type { ConnectedApp } from './mcp.types';
import { apiClient } from '../shared/http/api-client';

export async function fetchConnectedApps() {
  const { connectedApps } = await apiClient<{
    connectedApps: {
      clientId: string;
      clientName: string | null;
      redirectHosts: string[];
      scopes: string[];
      authorizedAt: string;
      updatedAt: string;
      lastActiveAt: string | null;
    }[];
  }>({
    path: '/api/users/me/connected-apps',
  });

  return {
    connectedApps: connectedApps.map(
      (app): ConnectedApp => ({
        clientId: app.clientId,
        clientName: app.clientName ?? undefined,
        redirectHosts: app.redirectHosts,
        scopes: app.scopes,
        authorizedAt: new Date(app.authorizedAt),
        updatedAt: new Date(app.updatedAt),
        lastActiveAt: app.lastActiveAt ? new Date(app.lastActiveAt) : undefined,
      }),
    ),
  };
}

export async function revokeConnectedApp({ clientId }: { clientId: string }) {
  await apiClient({
    path: `/api/users/me/connected-apps/${encodeURIComponent(clientId)}`,
    method: 'DELETE',
  });
}
