import type { JsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { updateDocumentBodySchema } from '../documents/documents.schemas';
import { tagColorSchema, tagNameSchema } from '../tags/tags.schemas';
import { toToolInputJsonSchema } from './mcp.schemas';
import { DOCUMENT_DATE_JSON_SCHEMA } from './tools/documents.mcp-tools';

// Just enough of JSON Schema for the override fragments: anyOf, type string and type null
function matchesFragment({ fragment, value }: { fragment: JsonSchema; value: unknown }): boolean {
  const typeOf = (candidate: unknown) => (candidate === null ? 'null' : typeof candidate);

  if (fragment.anyOf) {
    return fragment.anyOf.some(
      (branch) => typeof branch === 'object' && branch.type === typeOf(value),
    );
  }

  return fragment.type === typeOf(value);
}

describe('mcp schemas', () => {
  describe('toToolInputJsonSchema', () => {
    test('converts the actions the converter cannot express instead of throwing', () => {
      const schema = v.strictObject({
        name: tagNameSchema,
        color: tagColorSchema,
        date: v.optional(v.nullable(v.pipe(v.string(), v.toDate()))),
      });

      const jsonSchema = toToolInputJsonSchema({ schema });

      expect(jsonSchema.type).to.eql('object');
      expect(jsonSchema.required).to.eql(['name', 'color']);
      expect(jsonSchema.properties?.name).to.include({ type: 'string', maxLength: 64 });
      expect(jsonSchema.additionalProperties).to.eql(false);
      // The converter leaves a nullable string for the toDate pipe
      expect(jsonSchema.properties?.date).to.eql({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    });

    test('does not emit the $schema keyword, the type is always object', () => {
      const jsonSchema = toToolInputJsonSchema({ schema: v.object({}) });

      expect(jsonSchema).not.to.have.property('$schema');
      expect(jsonSchema.type).to.eql('object');
    });

    test('nests a variant under a key, the top level stays an object', () => {
      const schema = v.strictObject({
        definition: v.variant('type', [
          v.object({ type: v.literal('a'), name: v.string() }),
          v.object({ type: v.literal('b'), count: v.number() }),
        ]),
      });

      const jsonSchema = toToolInputJsonSchema({ schema });

      expect(jsonSchema.type).to.eql('object');
      expect(jsonSchema.properties?.definition).to.have.property('oneOf');
    });

    test('a schema that is not an object at the top level is refused', () => {
      const variant = v.variant('type', [v.object({ type: v.literal('a') })]);

      expect(() => toToolInputJsonSchema({ schema: variant })).to.throw('object schema');
    });

    test('an override replaces the generated fragment of its property only', () => {
      const schema = v.strictObject({ a: v.string(), b: v.string() });

      const jsonSchema = toToolInputJsonSchema({ schema, override: { b: { type: 'number' } } });

      expect(jsonSchema.properties).to.eql({ a: { type: 'string' }, b: { type: 'number' } });
      expect(jsonSchema.required).to.eql(['a', 'b']);
    });
  });

  describe('the documentDate override of update_document', () => {
    const acceptedByValibot = ['2024-01-31', '2024-01-31T10:00:00Z', null];
    const rejectedByValibot = [12, true, {}];

    test('accepts every value the valibot schema accepts', () => {
      for (const documentDate of acceptedByValibot) {
        expect(
          v.safeParse(updateDocumentBodySchema, { documentDate }).success,
          JSON.stringify(documentDate),
        ).to.eql(true);
        expect(
          matchesFragment({ fragment: DOCUMENT_DATE_JSON_SCHEMA, value: documentDate }),
        ).to.eql(true);
      }
    });

    test('rejects the values the valibot schema rejects', () => {
      for (const documentDate of rejectedByValibot) {
        expect(
          v.safeParse(updateDocumentBodySchema, { documentDate }).success,
          JSON.stringify(documentDate),
        ).to.eql(false);
        expect(
          matchesFragment({ fragment: DOCUMENT_DATE_JSON_SCHEMA, value: documentDate }),
        ).to.eql(false);
      }
    });
  });
});
