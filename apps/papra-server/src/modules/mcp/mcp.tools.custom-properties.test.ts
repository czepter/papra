import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  customPropertyDefinitionsTable,
  documentCustomPropertyValuesTable,
} from '../custom-properties/custom-properties.table';
import { ids, setupMcpTest, snapshotDatabase, testId } from './mcp.test-utils';

type Db = Awaited<ReturnType<typeof setupMcpTest>>['db'];

const definitionNotFound = {
  error: {
    message: 'Custom property definition not found.',
    code: 'custom_property_definition.not_found',
  },
};
const documentNotFound = { error: { message: 'Document not found.', code: 'document.not_found' } };

const optionIds = {
  urgent: testId('cpso', 'labelone'),
  later: testId('cpso', 'labeltwo'),
};

async function getDefinition({
  db,
  propertyDefinitionId,
}: {
  db: Db;
  propertyDefinitionId: string;
}) {
  const [definition] = await db
    .select()
    .from(customPropertyDefinitionsTable)
    .where(eq(customPropertyDefinitionsTable.id, propertyDefinitionId));

  return definition;
}

async function countValues({ db }: { db: Db }) {
  return (await db.select().from(documentCustomPropertyValuesTable)).length;
}

describe('mcp custom property tools', () => {
  describe('list_custom_properties', () => {
    test('returns the definitions of the organization only, with the options of the select types', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'list_custom_properties',
        args: { organizationId: ids.orgA },
      });

      expect(isError).to.eql(false);
      expect(data.propertyDefinitions).to.have.length(8);
      expect(data.propertyDefinitions.map(({ type }: { type: string }) => type).sort()).to.eql([
        'boolean',
        'date',
        'document_relation',
        'multi_select',
        'number',
        'select',
        'text',
        'user_relation',
      ]);

      const select = data.propertyDefinitions.find(
        ({ id }: { id: string }) => id === ids.propSelect,
      );
      expect(
        select.options
          .map(({ id, name }: { id: string; name: string }) => ({ id, name }))
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
      ).to.eql([
        { id: ids.optionA2, name: 'Closed' },
        { id: ids.optionA1, name: 'Open' },
      ]);
      expect(JSON.stringify(data)).not.to.include('Secret status');
      expect(JSON.stringify(data)).not.to.include('Hidden');
    });
  });

  describe('get_custom_property', () => {
    test('returns one definition with its type and options', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'get_custom_property',
        args: { organizationId: ids.orgA, propertyDefinitionId: ids.propSelect },
      });

      expect(isError).to.eql(false);
      expect(data.definition).to.include({ id: ids.propSelect, type: 'select', name: 'Status' });
      expect(data.definition.options.map(({ name }: { name: string }) => name).sort()).to.eql([
        'Closed',
        'Open',
      ]);
    });

    test('a definition of another organization is not found and nothing of it is returned', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data, text } = await callTool({
        name: 'get_custom_property',
        args: { organizationId: ids.orgA, propertyDefinitionId: ids.propB },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(definitionNotFound);
      expect(text).not.to.include('Hidden');
    });
  });

  describe('get_document_custom_properties', () => {
    test('returns the values set on the document', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'get_document_custom_properties',
        args: { organizationId: ids.orgA, documentId: ids.docA1 },
      });

      expect(isError).to.eql(false);
      expect(data.customProperties).to.have.length(1);
      expect(data.customProperties[0]).to.include({
        propertyDefinitionId: ids.propText,
        key: 'reference',
        type: 'text',
        value: 'INV-1',
      });
    });

    test('a document without values gives an empty list', async () => {
      const { callTool } = await setupMcpTest();

      const { data } = await callTool({
        name: 'get_document_custom_properties',
        args: { organizationId: ids.orgA, documentId: ids.docA2 },
      });

      expect(data).to.eql({ customProperties: [] });
    });

    test('a document of another organization is not found: the values query takes the document id alone, so this check is the guard', async () => {
      const { callTool, db } = await setupMcpTest();
      await db.insert(documentCustomPropertyValuesTable).values({
        documentId: ids.docB1,
        propertyDefinitionId: ids.propB,
        textValue: 'leak',
        selectOptionId: ids.optionB1,
      });

      const { isError, data, text } = await callTool({
        name: 'get_document_custom_properties',
        args: { organizationId: ids.orgA, documentId: ids.docB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(text).not.to.include('Hidden');
    });
  });

  describe('create_custom_property', () => {
    test('creates a simple property', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_custom_property',
        args: {
          organizationId: ids.orgA,
          definition: {
            type: 'number',
            name: 'Quantity',
            description: 'How many',
            displayOrder: 3,
          },
        },
      });

      expect(isError).to.eql(false);
      expect(data.propertyDefinition).to.include({
        organizationId: ids.orgA,
        type: 'number',
        name: 'Quantity',
        key: 'quantity',
      });
      expect(
        await getDefinition({ db, propertyDefinitionId: data.propertyDefinition.id }),
      ).to.include({ organizationId: ids.orgA, displayOrder: 3 });
    });

    test('creates select and multi_select properties with their options', async () => {
      const { callTool } = await setupMcpTest();

      for (const type of ['select', 'multi_select']) {
        const created = await callTool({
          name: 'create_custom_property',
          args: {
            organizationId: ids.orgA,
            definition: {
              type,
              name: `Priority ${type}`,
              options: [{ name: 'High' }, { name: 'Low' }],
            },
          },
        });
        expect(created.isError, type).to.eql(false);

        const { data } = await callTool({
          name: 'get_custom_property',
          args: {
            organizationId: ids.orgA,
            propertyDefinitionId: created.data.propertyDefinition.id,
          },
        });
        expect(
          data.definition.options.map(({ name }: { name: string }) => name).sort(),
          type,
        ).to.eql(['High', 'Low']);
      }
    });

    test('creates the relation, date and boolean families', async () => {
      const { callTool } = await setupMcpTest();

      for (const type of ['user_relation', 'document_relation', 'date', 'boolean', 'text']) {
        const { isError, data } = await callTool({
          name: 'create_custom_property',
          args: { organizationId: ids.orgA, definition: { type, name: `Extra ${type}` } },
        });

        expect(isError, type).to.eql(false);
        expect(data.propertyDefinition.type).to.eql(type);
      }
    });

    test('refuses a select without options, an unknown type and a missing name', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      for (const definition of [
        { type: 'select', name: 'No options' },
        { type: 'select', name: 'Empty', options: [] },
        { type: 'unknown', name: 'x' },
        { type: 'text' },
      ]) {
        const { isError, text } = await callTool({
          name: 'create_custom_property',
          args: { organizationId: ids.orgA, definition },
        });

        expect(isError, JSON.stringify(definition)).to.eql(true);
        expect(text, JSON.stringify(definition)).to.include('Invalid arguments');
      }

      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('goes through the usecase with the config: the maximum number of properties per organization applies', async () => {
      // Organization A has 8 definitions
      const { callTool } = await setupMcpTest({
        config: { customProperties: { maxCustomPropertiesPerOrganization: 8 } },
      });

      const { isError, data } = await callTool({
        name: 'create_custom_property',
        args: { organizationId: ids.orgA, definition: { type: 'text', name: 'Over the limit' } },
      });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('custom_property_definition.organization_limit_reached');
    });
  });

  describe('update_custom_property', () => {
    test('updates the name and the description', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'update_custom_property',
        args: {
          organizationId: ids.orgA,
          propertyDefinitionId: ids.propText,
          changes: { name: 'Invoice number', description: 'The number' },
        },
      });

      expect(isError).to.eql(false);
      expect(data.propertyDefinition).to.include({
        id: ids.propText,
        name: 'Invoice number',
        description: 'The number',
      });
      expect(await getDefinition({ db, propertyDefinitionId: ids.propText })).to.include({
        name: 'Invoice number',
      });
    });

    test('updates the options of a select property', async () => {
      const { callTool } = await setupMcpTest();

      const { isError } = await callTool({
        name: 'update_custom_property',
        args: {
          organizationId: ids.orgA,
          propertyDefinitionId: ids.propSelect,
          changes: {
            name: 'Status',
            options: [
              { id: ids.optionA1, name: 'Opened' },
              { id: ids.optionA2, name: 'Closed' },
              { name: 'Archived' },
            ],
          },
        },
      });
      expect(isError).to.eql(false);

      const { data } = await callTool({
        name: 'get_custom_property',
        args: { organizationId: ids.orgA, propertyDefinitionId: ids.propSelect },
      });
      expect(data.definition.options.map(({ name }: { name: string }) => name).sort()).to.eql([
        'Archived',
        'Closed',
        'Opened',
      ]);
    });

    test('changes that do not fit the type give the public invalid update error', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'update_custom_property',
        args: {
          organizationId: ids.orgA,
          propertyDefinitionId: ids.propText,
          changes: { name: 12 },
        },
      });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('custom_property_definition.invalid_update');
    });

    test('changes must be an object', async () => {
      const { callTool } = await setupMcpTest();

      for (const changes of ['name', 12, null, ['name'], {}]) {
        const { isError, text } = await callTool({
          name: 'update_custom_property',
          args: { organizationId: ids.orgA, propertyDefinitionId: ids.propText, changes },
        });

        expect(isError, JSON.stringify(changes)).to.eql(true);
        expect(text, JSON.stringify(changes)).to.include('changes');
      }
    });

    test('a definition of another organization is not found and stays unchanged', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await getDefinition({ db, propertyDefinitionId: ids.propB });

      const { isError, data } = await callTool({
        name: 'update_custom_property',
        args: {
          organizationId: ids.orgA,
          propertyDefinitionId: ids.propB,
          changes: { name: 'Hijacked' },
        },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(definitionNotFound);
      expect(await getDefinition({ db, propertyDefinitionId: ids.propB })).to.eql(before);
    });
  });

  describe('delete_custom_property', () => {
    test('deletes the definition and the values set with it', async () => {
      const { callTool, db } = await setupMcpTest();
      expect(await countValues({ db })).to.eql(1);

      const { isError, data } = await callTool({
        name: 'delete_custom_property',
        args: { organizationId: ids.orgA, propertyDefinitionId: ids.propText },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ deleted: true });
      expect(await getDefinition({ db, propertyDefinitionId: ids.propText })).to.eql(undefined);
      expect(await countValues({ db })).to.eql(0);
    });

    test('a definition of another organization is not found and still exists', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_custom_property',
        args: { organizationId: ids.orgA, propertyDefinitionId: ids.propB },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(definitionNotFound);
      expect(await getDefinition({ db, propertyDefinitionId: ids.propB })).to.include({
        organizationId: ids.orgB,
      });
    });
  });

  describe('set_document_custom_property', () => {
    const set = ({
      propertyDefinitionId,
      value,
      documentId = ids.docA2,
    }: {
      propertyDefinitionId: string;
      value: unknown;
      documentId?: string;
    }) => ({
      name: 'set_document_custom_property',
      args: { organizationId: ids.orgA, documentId, propertyDefinitionId, value },
    });

    async function readValue({
      callTool,
      propertyDefinitionId,
      documentId = ids.docA2,
    }: {
      callTool: Awaited<ReturnType<typeof setupMcpTest>>['callTool'];
      propertyDefinitionId: string;
      documentId?: string;
    }) {
      const { data } = await callTool({
        name: 'get_document_custom_properties',
        args: { organizationId: ids.orgA, documentId },
      });

      return data.customProperties.find(
        (property: { propertyDefinitionId: string }) =>
          property.propertyDefinitionId === propertyDefinitionId,
      )?.value;
    }

    const happyCases: {
      type: string;
      propertyDefinitionId: string;
      value: unknown;
      expected: any;
    }[] = [
      { type: 'text', propertyDefinitionId: ids.propText, value: 'hello', expected: 'hello' },
      { type: 'number', propertyDefinitionId: ids.propNumber, value: 42.5, expected: 42.5 },
      {
        type: 'date',
        propertyDefinitionId: ids.propDate,
        value: '2024-03-15T00:00:00.000Z',
        expected: '2024-03-15T00:00:00.000Z',
      },
      { type: 'boolean', propertyDefinitionId: ids.propBoolean, value: true, expected: true },
      {
        type: 'select',
        propertyDefinitionId: ids.propSelect,
        value: ids.optionA2,
        expected: { optionId: ids.optionA2, name: 'Closed' },
      },
      {
        type: 'multi_select',
        propertyDefinitionId: ids.propMultiSelect,
        value: [optionIds.urgent, optionIds.later],
        expected: [
          { optionId: optionIds.urgent, name: 'Urgent' },
          { optionId: optionIds.later, name: 'Later' },
        ],
      },
      {
        type: 'user_relation',
        propertyDefinitionId: ids.propUserRelation,
        value: [ids.alice],
        expected: [{ userId: ids.alice }],
      },
      {
        type: 'document_relation',
        propertyDefinitionId: ids.propDocumentRelation,
        value: [ids.docA1],
        expected: [{ documentId: ids.docA1, name: 'Acme invoice' }],
      },
    ];

    for (const { type, propertyDefinitionId, value, expected } of happyCases) {
      test(`sets a ${type} value`, async () => {
        const { callTool } = await setupMcpTest();

        const { isError, data } = await callTool(set({ propertyDefinitionId, value }));

        expect(isError, JSON.stringify(data)).to.eql(false);
        expect(data).to.eql({ updated: true });

        const stored = await readValue({ callTool, propertyDefinitionId });
        if (Array.isArray(expected)) {
          // Lists come back in no guaranteed order: compare the ids, the first key of each item
          const firstValues = (items: Record<string, unknown>[]) =>
            items.map((item) => String(Object.values(item)[0])).sort((a, b) => a.localeCompare(b));

          expect(firstValues(stored)).to.eql(firstValues(expected as Record<string, unknown>[]));
        } else {
          expect(stored).to.eql(expected);
        }
      });
    }

    test('replaces the previous value', async () => {
      const { callTool } = await setupMcpTest();

      await callTool(
        set({ propertyDefinitionId: ids.propText, value: 'first', documentId: ids.docA1 }),
      );
      await callTool(
        set({ propertyDefinitionId: ids.propText, value: 'second', documentId: ids.docA1 }),
      );

      expect(
        await readValue({ callTool, propertyDefinitionId: ids.propText, documentId: ids.docA1 }),
      ).to.eql('second');
    });

    test('a value of the wrong type returns an error that names the expected type', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const wrong = [
        { propertyDefinitionId: ids.propText, value: 12, expects: ['text', 'string'] },
        {
          propertyDefinitionId: ids.propNumber,
          value: 'twelve',
          expects: ['number', 'finite number'],
        },
        {
          propertyDefinitionId: ids.propBoolean,
          value: 'yes',
          expects: ['boolean', 'true or false'],
        },
        {
          propertyDefinitionId: ids.propSelect,
          value: ['not-a-single-id'],
          expects: ['select', 'option id'],
        },
        {
          propertyDefinitionId: ids.propMultiSelect,
          value: optionIds.urgent,
          expects: ['multi_select', 'array of option ids'],
        },
        {
          propertyDefinitionId: ids.propDocumentRelation,
          value: ids.docA1,
          expects: ['document_relation', 'array of document ids'],
        },
      ];

      for (const { propertyDefinitionId, value, expects } of wrong) {
        const { isError, data } = await callTool(set({ propertyDefinitionId, value }));

        expect(isError, expects[0]).to.eql(true);
        expect(data.error.code, expects[0]).to.eql('custom_property_value.invalid');
        for (const expected of expects) {
          expect(data.error.message, expects[0]).to.include(expected);
        }
      }

      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a document of another organization is not found and no value is written', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool(
        set({ propertyDefinitionId: ids.propText, value: 'x', documentId: ids.docB1 }),
      );

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a definition of another organization is not found and no value is written', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool(
        set({ propertyDefinitionId: ids.propB, value: ids.optionB1 }),
      );

      expect(isError).to.eql(true);
      expect(data).to.eql(definitionNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a select option of another organization is refused and no value is written', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool(
        set({ propertyDefinitionId: ids.propSelect, value: ids.optionB1 }),
      );

      expect(isError).to.eql(true);
      expect(data.error.code).to.match(/option/);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a user_relation value with a user who is not a member of the organization is refused', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool(
        set({ propertyDefinitionId: ids.propUserRelation, value: [ids.alice, ids.bob] }),
      );

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('custom_property_value.user_not_found');
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a document_relation value pointing at a document of another organization is refused', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool(
        set({ propertyDefinitionId: ids.propDocumentRelation, value: [ids.docA1, ids.docB1] }),
      );

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('custom_property_value.related_document_not_found');
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a call without value is refused by the schema', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, text } = await callTool({
        name: 'set_document_custom_property',
        args: {
          organizationId: ids.orgA,
          documentId: ids.docA2,
          propertyDefinitionId: ids.propText,
        },
      });

      expect(isError).to.eql(true);
      expect(text).to.include('value');
    });

    test('the description tells the model to call get_custom_property first and lists the eight shapes', async () => {
      const { listTools } = await setupMcpTest();

      const tool = (await listTools()).find(({ name }) => name === 'set_document_custom_property');

      expect(tool?.description).to.include('get_custom_property');
      for (const type of [
        'text',
        'number',
        'date',
        'boolean',
        'select',
        'multi_select',
        'user_relation',
        'document_relation',
      ]) {
        expect(tool?.description).to.include(`${type}:`);
      }
    });
  });

  describe('delete_document_custom_property', () => {
    test('clears the value', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_document_custom_property',
        args: {
          organizationId: ids.orgA,
          documentId: ids.docA1,
          propertyDefinitionId: ids.propText,
        },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ deleted: true });
      expect(await countValues({ db })).to.eql(0);
    });

    test('a document of another organization is not found and its value is kept', async () => {
      const { callTool, db } = await setupMcpTest();
      await db.insert(documentCustomPropertyValuesTable).values({
        documentId: ids.docB1,
        propertyDefinitionId: ids.propB,
        selectOptionId: ids.optionB1,
      });
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool({
        name: 'delete_document_custom_property',
        args: { organizationId: ids.orgA, documentId: ids.docB1, propertyDefinitionId: ids.propB },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a definition of another organization is not found and nothing is deleted', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool({
        name: 'delete_document_custom_property',
        args: { organizationId: ids.orgA, documentId: ids.docA1, propertyDefinitionId: ids.propB },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(definitionNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });
  });
});
