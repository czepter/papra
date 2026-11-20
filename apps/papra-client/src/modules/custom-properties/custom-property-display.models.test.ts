import { describe, expect, test } from 'vitest';
import {
  formatCustomPropertyValue,
  getCustomPropertyColumnDefinitions,
  getCustomPropertyValueItems,
  getDocumentCustomPropertyDisplayValues,
} from './custom-property-display.models';

const labels = {
  yes: 'Yes',
  no: 'No',
  formatDate: (date: Date) => date.toISOString().slice(0, 10),
};

const property = (overrides: {
  key?: string;
  type?: any;
  value: unknown;
  displayOrder?: number;
}) => ({
  key: 'k',
  name: 'K',
  displayOrder: 0,
  type: 'text' as const,
  ...overrides,
});

describe('custom-property-display models', () => {
  describe('formatCustomPropertyValue', () => {
    const format = (type: string, value: unknown) =>
      formatCustomPropertyValue({ property: { type: type as any, value }, labels });

    test('text, number and boolean', () => {
      expect(format('text', 'hello')).to.equal('hello');
      expect(format('text', '  ')).to.equal(undefined);
      expect(format('number', 0)).to.equal('0');
      expect(format('number', null)).to.equal(undefined);
      expect(format('boolean', true)).to.equal('Yes');
      expect(format('boolean', false)).to.equal('No');
      expect(format('boolean', null)).to.equal(undefined);
    });

    test('date', () => {
      expect(format('date', '2024-03-05T10:00:00.000Z')).to.equal('2024-03-05');
      expect(format('date', 'nope')).to.equal(undefined);
      expect(format('date', null)).to.equal(undefined);
    });

    test('select and multi select render option names', () => {
      expect(format('select', { optionId: 'o1', name: 'Paid' })).to.equal('Paid');
      expect(format('select', null)).to.equal(undefined);
      expect(
        format('multi_select', [
          { optionId: 'o1', name: 'A' },
          { optionId: 'o2', name: 'B' },
        ]),
      ).to.equal('A, B');
      expect(format('multi_select', [])).to.equal(undefined);
    });

    test('relations render names, falling back to the email for users', () => {
      expect(
        format('user_relation', [
          { userId: 'u1', name: 'Ada', email: 'ada@x.io' },
          { userId: 'u2', name: null, email: 'bob@x.io' },
        ]),
      ).to.equal('Ada, bob@x.io');
      expect(format('document_relation', [{ documentId: 'd1', name: 'Invoice.pdf' }])).to.equal(
        'Invoice.pdf',
      );
      expect(format('document_relation', null)).to.equal(undefined);
    });
  });

  describe('getCustomPropertyValueItems', () => {
    const items = (type: string, value: unknown, key = 'k') =>
      getCustomPropertyValueItems({ property: { key, type: type as any, value }, labels });

    test('scalar types filter on their raw value', () => {
      expect(items('text', 'Finanzamt Jena', 'korrespondent')).to.eql([
        { text: 'Finanzamt Jena', filterTerm: 'korrespondent:"Finanzamt Jena"' },
      ]);
      expect(items('number', 12.5)).to.eql([{ text: '12.5', filterTerm: 'k:12.5' }]);
      expect(items('boolean', false)).to.eql([{ text: 'No', filterTerm: 'k:false' }]);
      expect(items('date', '2026-03-01T00:00:00.000Z')).to.eql([
        { text: '2026-03-01', filterTerm: 'k:"2026-03-01T00:00:00.000Z"' },
      ]);
    });

    test('select values filter on the option name', () => {
      expect(items('select', { optionId: 'o1', name: 'Rechnung' }, 'dokumenttyp')).to.eql([
        { text: 'Rechnung', filterTerm: 'dokumenttyp:Rechnung' },
      ]);
    });

    test('multi value types get one item per value', () => {
      expect(
        items('multi_select', [
          { optionId: 'o1', name: 'Red' },
          { optionId: 'o2', name: 'Dark Blue' },
        ]),
      ).to.eql([
        { text: 'Red', filterTerm: 'k:Red' },
        { text: 'Dark Blue', filterTerm: 'k:"Dark Blue"' },
      ]);
      expect(
        items('user_relation', [{ userId: 'usr_1', name: 'Ada', email: 'ada@example.com' }]),
      ).to.eql([{ text: 'Ada', filterTerm: 'k:usr_1' }]);
      expect(items('document_relation', [{ documentId: 'doc_1', name: 'Other doc' }])).to.eql([
        { text: 'Other doc', filterTerm: 'k:doc_1' },
      ]);
    });

    test('empty values have no item', () => {
      expect(items('text', '')).to.eql([]);
      expect(items('select', null)).to.eql([]);
      expect(items('multi_select', [])).to.eql([]);
    });
  });

  describe('getDocumentCustomPropertyDisplayValues', () => {
    test('skips empty values and orders by displayOrder', () => {
      const result = getDocumentCustomPropertyDisplayValues({
        document: {
          customProperties: [
            property({ key: 'b', value: 'second', displayOrder: 2 }),
            property({ key: 'c', value: null, displayOrder: 0 }),
            property({ key: 'a', type: 'boolean', value: true, displayOrder: 1 }),
          ],
        },
        labels,
      });

      expect(result.map(({ key, text }) => [key, text])).to.eql([
        ['a', 'Yes'],
        ['b', 'second'],
      ]);
    });
  });

  describe('getCustomPropertyColumnDefinitions', () => {
    test('keeps properties with a value on at least one document, ordered by displayOrder', () => {
      const result = getCustomPropertyColumnDefinitions({
        documents: [
          {
            customProperties: [
              property({ key: 'b', value: null, displayOrder: 1 }),
              property({ key: 'c', value: 'x', displayOrder: 2 }),
            ],
          },
          {
            customProperties: [
              property({ key: 'b', value: 'y', displayOrder: 1 }),
              property({ key: 'd', value: null, displayOrder: 0 }),
            ],
          },
        ],
        labels,
      });

      expect(result.map(({ key }) => key)).to.eql(['b', 'c']);
    });

    test('keeps pinned properties even without values, without duplicating the ones with values', () => {
      const result = getCustomPropertyColumnDefinitions({
        documents: [{ customProperties: [property({ key: 'b', value: 'x', displayOrder: 1 })] }],
        labels,
        pinnedDefinitions: [
          { key: 'a', name: 'A', type: 'text', displayOrder: 0 },
          { key: 'b', name: 'B', type: 'text', displayOrder: 1 },
        ],
      });

      expect(result.map(({ key }) => key)).to.eql(['a', 'b']);
    });
  });
});
