export const INBOX_MODES = ['shared', 'per_user'] as const;

export type InboxMode = (typeof INBOX_MODES)[number];
