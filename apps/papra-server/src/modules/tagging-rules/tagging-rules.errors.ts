import { createErrorFactory } from '../shared/errors/errors';

export const createTaggingRuleNotFoundError = createErrorFactory({
  message: 'Tagging rule not found',
  code: 'tagging-rules.not-found',
  statusCode: 404,
});
