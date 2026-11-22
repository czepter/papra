import type { McpToolDefinition } from './mcp.tools.types';
import {
  createCustomPropertyTool,
  deleteCustomPropertyTool,
  deleteDocumentCustomPropertyTool,
  getCustomPropertyTool,
  getDocumentCustomPropertiesTool,
  listCustomPropertiesTool,
  setDocumentCustomPropertyTool,
  updateCustomPropertyTool,
} from './tools/custom-properties.mcp-tools';
import {
  getDocumentTool,
  readDocumentContentTool,
  searchDocumentsTool,
  updateDocumentTool,
  uploadDocumentTool,
} from './tools/documents.mcp-tools';
import { enrichDocumentTool } from './tools/enrichment.mcp-tools';
import { listOrganizationsTool, pingTool } from './tools/organizations.mcp-tools';
import {
  addDocumentTagTool,
  createTagTool,
  deleteTagTool,
  listTagsTool,
  removeDocumentTagTool,
  updateTagTool,
} from './tools/tags.mcp-tools';

// Every tool is one entry. The permission check, the argument parsing, the organization membership
// check and the error mapping are done for all of them by executeMcpTool in mcp.tools.ts.
export const mcpTools: McpToolDefinition[] = [
  pingTool,
  listOrganizationsTool,
  searchDocumentsTool,
  getDocumentTool,
  readDocumentContentTool,
  updateDocumentTool,
  uploadDocumentTool,
  listTagsTool,
  createTagTool,
  updateTagTool,
  deleteTagTool,
  addDocumentTagTool,
  removeDocumentTagTool,
  listCustomPropertiesTool,
  getCustomPropertyTool,
  createCustomPropertyTool,
  updateCustomPropertyTool,
  deleteCustomPropertyTool,
  getDocumentCustomPropertiesTool,
  setDocumentCustomPropertyTool,
  deleteDocumentCustomPropertyTool,
  enrichDocumentTool,
];
