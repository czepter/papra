import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Database } from '../app/database/database.types';
import { API_KEY_TOKEN_REGEX } from '../api-keys/api-keys.constants';
import { createApiKeysRepository } from '../api-keys/api-keys.repository';
import { getApiKey } from '../api-keys/api-keys.usecases';

export const MCP_API_KEY_CLIENT_ID = 'papra-api-key';

export function buildAuthInfo({
  userId,
  apiKeyId,
  permissions,
}: {
  userId: string;
  apiKeyId: string;
  permissions: string[];
}): AuthInfo {
  return {
    // The raw token is deliberately not kept: nothing downstream needs it, and it must never end up in logs.
    token: '',
    clientId: MCP_API_KEY_CLIENT_ID,
    scopes: permissions,
    extra: { userId, apiKeyId },
  };
}

export function getUserIdFromAuthInfo({ authInfo }: { authInfo: AuthInfo | undefined }) {
  const userId = authInfo?.extra?.userId;

  return { userId: typeof userId === 'string' ? userId : undefined };
}

// Only Papra API keys are accepted, session cookies and other bearer tokens are not.
export function buildVerifyApiKeyToken({ db }: { db: Database }) {
  const apiKeyRepository = createApiKeysRepository({ db });

  return async ({ token }: { token: string }): Promise<{ authInfo: AuthInfo | undefined }> => {
    if (!API_KEY_TOKEN_REGEX.test(token)) {
      return { authInfo: undefined };
    }

    const { apiKey } = await getApiKey({ token, apiKeyRepository });

    if (!apiKey) {
      return { authInfo: undefined };
    }

    return {
      authInfo: buildAuthInfo({
        userId: apiKey.userId,
        apiKeyId: apiKey.id,
        permissions: apiKey.permissions,
      }),
    };
  };
}
