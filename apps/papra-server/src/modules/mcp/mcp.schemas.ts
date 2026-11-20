import type { JsonSchema } from '@valibot/to-json-schema';
import type { GenericSchema } from 'valibot';
import { toJsonSchema } from '@valibot/to-json-schema';

export type ToolInputJsonSchema = JsonSchema & { type: 'object' };

/*
 * Builds the JSON Schema advertised in tools/list from a valibot schema.
 * It is advisory only: the arguments of a call are always parsed with the valibot schema itself.
 *
 * - errorMode 'ignore' and typeMode 'input': actions the converter cannot express (trim, toUpperCase,
 *   toDate) are skipped and the schema describes what the caller sends, not what the handler receives.
 * - `override` replaces the generated fragment of a top-level property whose conversion lost information.
 */
export function toToolInputJsonSchema({
  schema,
  override = {},
}: {
  schema: GenericSchema;
  override?: Record<string, JsonSchema>;
}): ToolInputJsonSchema {
  const { $schema: _$schema, ...jsonSchema } = toJsonSchema(schema, {
    errorMode: 'ignore',
    typeMode: 'input',
  });

  if (jsonSchema.type !== 'object') {
    throw new Error('A tool input schema must be an object schema');
  }

  return {
    ...jsonSchema,
    type: 'object',
    properties: { ...jsonSchema.properties, ...override },
  };
}
