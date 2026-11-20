export const DOCUMENT_REVIEW_ID_PREFIX = 'doc_rev';

export const INBOX_MODES = {
  SHARED: 'shared',
  PER_USER: 'per_user',
} as const;

export const INBOX_MODES_LIST = [INBOX_MODES.SHARED, INBOX_MODES.PER_USER] as const;

export const DEFAULT_INBOX_MODE = INBOX_MODES.SHARED;

export const MAX_REVIEWED_DOCUMENTS_PER_REQUEST = 100;
