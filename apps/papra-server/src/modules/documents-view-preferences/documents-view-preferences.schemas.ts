import * as v from 'valibot';
import {
  DOCUMENTS_VIEWS,
  MAX_TAG_VIEW_KEY_LENGTH,
  MAX_TAG_VIEWS_COUNT,
} from './documents-view-preferences.constants';

export const documentsViewSchema = v.picklist(DOCUMENTS_VIEWS);

export const documentsViewPreferencesSchema = v.strictObject({
  defaultView: documentsViewSchema,
  tagViews: v.pipe(
    v.record(
      v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TAG_VIEW_KEY_LENGTH)),
      documentsViewSchema,
    ),
    v.check(
      (tagViews) => Object.keys(tagViews).length <= MAX_TAG_VIEWS_COUNT,
      `At most ${MAX_TAG_VIEWS_COUNT} tag views are allowed`,
    ),
  ),
});
