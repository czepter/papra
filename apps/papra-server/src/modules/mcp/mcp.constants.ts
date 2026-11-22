// Encoded (base64) size cap of an uploaded document, checked on the string length before decoding
export const MCP_UPLOAD_MAX_ENCODED_SIZE = 10 * 1024 * 1024;

// Request body cap of the /mcp endpoint: the encoded upload cap plus room for the JSON-RPC envelope
export const MCP_REQUEST_BODY_MAX_SIZE = 11 * 1024 * 1024;

export const MCP_SEARCH_DEFAULT_PAGE_SIZE = 25;
export const MCP_SEARCH_MAX_PAGE_SIZE = 100;

export const MCP_READ_CONTENT_DEFAULT_LIMIT = 20_000;
export const MCP_READ_CONTENT_MAX_LIMIT = 100_000;

export const MCP_UPLOAD_FILE_NAME_MAX_LENGTH = 255;
