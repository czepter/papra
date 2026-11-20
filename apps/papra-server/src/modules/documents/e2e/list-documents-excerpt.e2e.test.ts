import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';

const USER_ID = 'usr_111111111111111111111111';
const ORGANIZATION_ID = 'org_222222222222222222222222';
const DOCUMENT_ID = 'doc_111111111111111111111111';

describe('documents e2e', () => {
  describe('list documents content excerpt', () => {
    test('the documents list exposes an excerpt of the extracted content but never the full content', async () => {
      const content = 'x'.repeat(1000);

      const { db } = await createInMemoryDatabase({
        users: [{ id: USER_ID, email: 'user@example.com' }],
        organizations: [{ id: ORGANIZATION_ID, name: 'Org 1' }],
        organizationMembers: [
          { organizationId: ORGANIZATION_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
        ],
        documents: [
          {
            id: DOCUMENT_ID,
            name: 'file.txt',
            content,
            organizationId: ORGANIZATION_ID,
            mimeType: 'text/plain',
            originalName: 'file.txt',
            createdBy: USER_ID,
            originalStorageKey: `documents/${DOCUMENT_ID}`,
            originalSha256Hash: 'hash',
            isDeleted: false,
          },
        ],
      });

      const { app } = createServer(
        createTestServerDependencies({ db, config: overrideConfig({ env: 'test' }) }),
      );

      const response = await app.request(
        `/api/organizations/${ORGANIZATION_ID}/documents`,
        {},
        { loggedInUserId: USER_ID },
      );
      const { documents } = (await response.json()) as {
        documents: { id: string; content?: string; contentExcerpt?: string }[];
      };

      expect(response.status).to.eql(200);
      expect(documents).to.have.length(1);
      expect(documents[0]).not.toHaveProperty('content');
      expect(documents[0]?.contentExcerpt).to.eql('x'.repeat(300));
    });
  });
});
