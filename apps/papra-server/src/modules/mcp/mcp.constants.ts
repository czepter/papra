// Encoded (base64) size cap of an uploaded document, checked on the string length before decoding
export const MCP_UPLOAD_MAX_ENCODED_SIZE = 10 * 1024 * 1024;

// Request body cap of the /mcp endpoint: the encoded upload cap plus room for the JSON-RPC envelope
export const MCP_REQUEST_BODY_MAX_SIZE = 11 * 1024 * 1024;

export const MCP_SEARCH_DEFAULT_PAGE_SIZE = 25;
export const MCP_SEARCH_MAX_PAGE_SIZE = 100;

export const MCP_READ_CONTENT_DEFAULT_LIMIT = 20_000;
export const MCP_READ_CONTENT_MAX_LIMIT = 100_000;

export const MCP_UPLOAD_FILE_NAME_MAX_LENGTH = 255;

// OAuth (MCP clients connecting without an API key)
// Access tokens are stateless JWTs: revoking a refresh token cannot recall one already issued, so the lifetime is short
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;

export const MCP_OAUTH_OFFLINE_ACCESS_SCOPE = 'offline_access';

// Dynamic client registration is open (unauthenticated), so its inputs are capped and the endpoint rate limited
export const MCP_OAUTH_CLIENT_NAME_MAX_LENGTH = 100;
export const MCP_OAUTH_REGISTRATION_MAX_REDIRECT_URIS = 10;
export const MCP_OAUTH_REGISTRATION_MAX_URI_LENGTH = 2048;
export const MCP_OAUTH_REGISTRATION_MAX_CONTACTS = 10;
export const MCP_OAUTH_REGISTRATION_RATE_LIMIT_PER_IP = { maxHits: 10, window: { hours: 1 } };
export const MCP_OAUTH_REGISTRATION_RATE_LIMIT_GLOBAL = { maxHits: 100, window: { hours: 1 } };

export const OAUTH_PROTECTED_RESOURCE_WELL_KNOWN_PATH = '/.well-known/oauth-protected-resource';
export const OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH = '/.well-known/oauth-authorization-server';
