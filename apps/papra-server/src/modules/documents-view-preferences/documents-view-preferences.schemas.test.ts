import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import {
  MAX_TAG_VIEW_KEY_LENGTH,
  MAX_TAG_VIEWS_COUNT,
} from './documents-view-preferences.constants';
import { documentsViewPreferencesSchema } from './documents-view-preferences.schemas';

const isValid = (value: unknown) => v.safeParse(documentsViewPreferencesSchema, value).success;

describe('documents view preferences schemas', () => {
  test('valid preferences are accepted', () => {
    expect(isValid({ defaultView: 'grid', tagViews: {} })).to.eql(true);
    expect(isValid({ defaultView: 'list', tagViews: { invoices: 'grid', tax: 'list' } })).to.eql(
      true,
    );
  });

  test('unknown views, extra properties and missing properties are rejected', () => {
    expect(isValid({ defaultView: 'masonry', tagViews: {} })).to.eql(false);
    expect(isValid({ defaultView: 'list', tagViews: { invoices: 'masonry' } })).to.eql(false);
    expect(isValid({ defaultView: 'list', tagViews: {}, extra: true })).to.eql(false);
    expect(isValid({ defaultView: 'list' })).to.eql(false);
    expect(isValid({ tagViews: {} })).to.eql(false);
  });

  test('the number of tag views and the length of their keys are capped', () => {
    const tagViewsOfSize = (size: number) =>
      Object.fromEntries(Array.from({ length: size }, (_, index) => [`tag-${index}`, 'grid']));

    expect(isValid({ defaultView: 'list', tagViews: tagViewsOfSize(MAX_TAG_VIEWS_COUNT) })).to.eql(
      true,
    );
    expect(
      isValid({ defaultView: 'list', tagViews: tagViewsOfSize(MAX_TAG_VIEWS_COUNT + 1) }),
    ).to.eql(false);
    expect(
      isValid({ defaultView: 'list', tagViews: { ['a'.repeat(MAX_TAG_VIEW_KEY_LENGTH)]: 'grid' } }),
    ).to.eql(true);
    expect(
      isValid({
        defaultView: 'list',
        tagViews: { ['a'.repeat(MAX_TAG_VIEW_KEY_LENGTH + 1)]: 'grid' },
      }),
    ).to.eql(false);
    expect(isValid({ defaultView: 'list', tagViews: { '': 'grid' } })).to.eql(false);
  });
});
