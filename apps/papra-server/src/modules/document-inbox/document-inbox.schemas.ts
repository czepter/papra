import * as v from 'valibot';
import { documentIdSchema } from '../documents/documents.schemas';
import { MAX_REVIEWED_DOCUMENTS_PER_REQUEST } from './document-inbox.constants';

export const markDocumentsAsReviewedBodySchema = v.strictObject({
  documentIds: v.pipe(
    v.array(documentIdSchema),
    v.minLength(1),
    v.maxLength(MAX_REVIEWED_DOCUMENTS_PER_REQUEST),
  ),
});
