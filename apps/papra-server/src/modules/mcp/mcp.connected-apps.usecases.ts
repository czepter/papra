import type { McpConnectedAppsRepository } from './mcp.connected-apps.repository';
import { createConnectedAppNotFoundError } from './mcp.errors';

export async function revokeConnectedApp({
  userId,
  clientId,
  mcpConnectedAppsRepository,
}: {
  userId: string;
  clientId: string;
  mcpConnectedAppsRepository: McpConnectedAppsRepository;
}) {
  const { hasRevoked } = await mcpConnectedAppsRepository.revokeUserConnectedApp({ userId, clientId });

  // Same answer for an unknown client and for a client only another user approved
  if (!hasRevoked) {
    throw createConnectedAppNotFoundError();
  }
}
