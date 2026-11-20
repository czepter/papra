import type { INBOX_MODES } from './document-inbox.constants';

export type InboxMode = (typeof INBOX_MODES)[keyof typeof INBOX_MODES];
