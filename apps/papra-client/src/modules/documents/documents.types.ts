import type { DocumentCustomProperty } from '../custom-properties/custom-properties.types';
import type { Tag } from '../tags/tags.types';
import type { User } from '../users/users.types';
import type { DOCUMENT_ACTIVITY_EVENTS } from './documents.constants';
import type { DocumentPreviewStatus } from './document-previews.models';

export type Document = {
  id: string;
  organizationId: string;
  name: string;
  mimeType: string;
  originalSize: number;
  createdAt: Date;
  updatedAt?: Date;
  documentDate?: Date;
  isDeleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  content: string;
  notes?: string;
  tags: Tag[];
  customProperties?: DocumentCustomProperty[];
  // Not returned by the create and update endpoints, a missing status is treated as pending
  previewStatus?: DocumentPreviewStatus;
};

export type DocumentActivityEvent =
  (typeof DOCUMENT_ACTIVITY_EVENTS)[keyof typeof DOCUMENT_ACTIVITY_EVENTS];

export type DocumentActivity = {
  id: string;
  documentId: string;
  event: DocumentActivityEvent;
  eventData: Record<string, unknown>;
  userId?: string;
  createdAt: Date;
  updatedAt?: Date;
  tag?: Pick<Tag, 'id' | 'name' | 'color' | 'description'>;
  user?: Pick<User, 'id' | 'name'>;
};
