import { createErrorFactory } from '../shared/errors/errors';

export const createMcpInvalidBase64Error = createErrorFactory({
  message: 'contentBase64 is not valid standard base64 (alphabet A-Z a-z 0-9 + /, padded with =).',
  code: 'mcp.invalid_base64',
  statusCode: 400,
});

export const createMcpRequestBodyTooLargeError = createErrorFactory({
  message: 'The request body is too large.',
  code: 'mcp.request_body_too_large',
  statusCode: 413,
});

export const connectedAppNotFoundErrorDefinition = {
  message: 'Connected app not found',
  code: 'mcp.connected_app_not_found',
  statusCode: 404,
} as const;

export const createConnectedAppNotFoundError = createErrorFactory(
  connectedAppNotFoundErrorDefinition,
);
