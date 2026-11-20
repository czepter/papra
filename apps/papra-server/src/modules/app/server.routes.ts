import type { RouteDefinitionContext } from './server.types';
import { registerAdminRoutes } from '../admin/admin.routes';
import { registerApiKeysRoutes } from '../api-keys/api-keys.routes';
import { registerCustomPropertiesRoutes } from '../custom-properties/custom-properties.routes';
import { registerDocumentShareLinksRoutes } from '../document-share-links/document-share-links.routes';
import { registerDocumentViewsRoutes } from '../document-views/document-views.routes';
import { registerDocumentActivityRoutes } from '../documents/document-activity/document-activity.routes';
import { registerDocumentsBatchRoutes } from '../documents/documents-batch/documents-batch.routes';
import { registerDocumentsRoutes } from '../documents/documents.routes';
import { registerDocumentInboxRoutes } from '../document-inbox/document-inbox.routes';
import { registerDocumentsViewPreferencesRoutes } from '../documents-view-preferences/documents-view-preferences.routes';
import { registerDocumentPreviewsRoutes } from '../document-previews/document-previews.routes';
import { registerIntakeEmailsRoutes } from '../intake-emails/intake-emails.routes';
import { registerInvitationsRoutes } from '../invitations/invitations.routes';
import { registerOrganizationsRoutes } from '../organizations/organizations.routes';
import { registerPlanEntitlementsRoutes } from '../plan-entitlements/plan-entitlements.routes';
import { registerSubscriptionsRoutes } from '../subscriptions/subscriptions.routes';
import { registerTaggingRulesRoutes } from '../tagging-rules/tagging-rules.routes';
import { registerWebhooksRoutes } from '../webhooks/webhooks.routes';
import { registerAuthRoutes } from './auth/auth.routes';
import { registerMcpRoutes } from '../mcp/mcp.routes';
import { registerMcpOauthRoutes } from '../mcp/mcp.oauth.routes';
import { registerOrganizationSettingsRoutes } from '../organizations/organization-settings/organization-settings.routes';

export function registerRoutes(context: RouteDefinitionContext) {
  // Before the auth routes: the OAuth metadata and the registration guard must precede the /api/auth/* catch-all
  if (context.config.mcp.enabled) {
    registerMcpOauthRoutes(context);
  }

  registerAuthRoutes(context);
  registerIntakeEmailsRoutes(context);
  registerSubscriptionsRoutes(context);
  registerOrganizationsRoutes(context);
  registerOrganizationSettingsRoutes(context);
  // Before the documents routes: `documents/view-preferences` must not be captured by `documents/:documentId`
  registerDocumentsViewPreferencesRoutes(context);
  // Same reason for `documents/inbox` and `documents/reviews`
  registerDocumentInboxRoutes(context);
  registerDocumentsRoutes(context);
  registerDocumentsBatchRoutes(context);
  registerDocumentPreviewsRoutes(context);
  registerDocumentViewsRoutes(context);
  registerTaggingRulesRoutes(context);
  registerApiKeysRoutes(context);
  registerWebhooksRoutes(context);
  registerInvitationsRoutes(context);
  registerDocumentActivityRoutes(context);
  registerCustomPropertiesRoutes(context);
  registerDocumentShareLinksRoutes(context);
  registerPlanEntitlementsRoutes(context);
  registerAdminRoutes(context);

  if (context.config.mcp.enabled) {
    registerMcpRoutes(context);
  }
}
