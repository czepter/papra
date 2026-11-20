import type { InboxMode } from '../../document-inbox/document-inbox.types';
import type { organizationSettingsTable } from './organization-settings.tables';

export type OrganizationSettings = {
  ai: {
    autoTagging: {
      isEnabled: boolean;
      canCreateNewTags: boolean;
      maxTags: number;
      modelId?: string;
    };
  };
  inbox: {
    mode: InboxMode;
  };
};

export type DbUpdatableOrganizationSettings = Pick<
  typeof organizationSettingsTable.$inferInsert,
  | 'aiAutoTaggingEnabled'
  | 'aiAutoTaggingCanCreateNewTags'
  | 'aiAutoTaggingMaxTags'
  | 'aiAutoTaggingModelId'
  | 'inboxMode'
>;
