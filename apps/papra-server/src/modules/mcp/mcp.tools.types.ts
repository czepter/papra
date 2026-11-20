import type { JsonSchema } from '@valibot/to-json-schema';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type * as v from 'valibot';
import type { ApiKeyPermissions } from '../api-keys/api-keys.types';
import type { RouteDefinitionContext } from '../app/server.types';

export type McpToolDependencies = Omit<RouteDefinitionContext, 'app'>;

export type McpToolDefinition = {
  name: string;
  description: string;
  input: v.GenericSchema;
  // The key must hold every listed permission, the same rule as the REST routes
  permissions: ApiKeyPermissions[];
  annotations: ToolAnnotations;
  // Replaces the generated JSON Schema of top-level properties the converter cannot express
  jsonSchemaOverride?: Record<string, JsonSchema>;
  handler: (args: { input: any; userId: string; deps: McpToolDependencies }) => Promise<unknown>;
};

// Keeps the input type of the handler tied to the input schema of the entry
export function defineMcpTool<const Schema extends v.GenericSchema>(tool: {
  name: string;
  description: string;
  input: Schema;
  permissions: ApiKeyPermissions[];
  annotations: ToolAnnotations;
  jsonSchemaOverride?: Record<string, JsonSchema>;
  handler: (args: {
    input: v.InferOutput<Schema>;
    userId: string;
    deps: McpToolDependencies;
  }) => Promise<unknown>;
}): McpToolDefinition {
  return tool;
}

// Annotations are hints for clients only, no check relies on them
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true };
export const ADDITIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};
export const IDEMPOTENT_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};
export const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};
