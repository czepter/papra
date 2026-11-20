import { Buffer } from 'node:buffer';
import { createNoopLogger } from '@crowlog/logger';
import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { createServer } from '../../app/server';
import { createTestServerDependencies } from '../../app/server.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { createDocumentsRepository } from '../../documents/documents.repository';
import { ORGANIZATION_ROLES } from '../../organizations/organizations.constants';
import { createReadableStream } from '../../shared/streams/readable-stream';
import { createInMemoryStorageService } from '../../storage/storage.test-utils';
import { createInMemoryTaskServices } from '../../tasks/tasks.test-utils';
import { createDocumentPreviewsRepository } from '../document-previews.repository';
import { generateDocumentPreviews } from '../document-previews.usecases';

const USER_ID = 'usr_111111111111111111111111';
const OTHER_USER_ID = 'usr_333333333333333333333333';
const ORGANIZATION_ID = 'org_222222222222222222222222';
const DOCUMENT_ID = 'doc_111111111111111111111111';
const TEXT_DOCUMENT_ID = 'doc_222222222222222222222222';
const WEBP_BYTES = Buffer.from('fake-webp-bytes');

async function createTestApp({ arePreviewsEnabled = true } = {}) {
  const { db } = await createInMemoryDatabase({
    users: [
      { id: USER_ID, email: 'user@example.com' },
      { id: OTHER_USER_ID, email: 'other@example.com' },
    ],
    organizations: [{ id: ORGANIZATION_ID, name: 'Org 1' }],
    organizationMembers: [
      { organizationId: ORGANIZATION_ID, userId: USER_ID, role: ORGANIZATION_ROLES.OWNER },
    ],
    documents: [
      {
        id: DOCUMENT_ID,
        organizationId: ORGANIZATION_ID,
        name: 'scan.pdf',
        originalName: 'scan.pdf',
        mimeType: 'application/pdf',
        originalStorageKey: `${ORGANIZATION_ID}/originals/${DOCUMENT_ID}.pdf`,
        originalSha256Hash: 'hash-pdf',
      },
      {
        id: TEXT_DOCUMENT_ID,
        organizationId: ORGANIZATION_ID,
        name: 'notes.txt',
        originalName: 'notes.txt',
        mimeType: 'text/plain',
        originalStorageKey: `${ORGANIZATION_ID}/originals/${TEXT_DOCUMENT_ID}.txt`,
        originalSha256Hash: 'hash-txt',
      },
    ],
  });
  const documentsStorageService = createInMemoryStorageService();
  const taskServices = createInMemoryTaskServices();
  await documentsStorageService.saveFile({
    storageKey: `${ORGANIZATION_ID}/originals/${DOCUMENT_ID}.pdf`,
    fileStream: createReadableStream({ content: 'pdf' }),
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
  });

  const { app } = createServer(
    createTestServerDependencies({
      db,
      documentsStorageService,
      taskServices,
      config: overrideConfig({
        env: 'test',
        documents: { previews: { isEnabled: arePreviewsEnabled } },
      }),
    }),
  );

  return {
    app,
    db,
    taskServices,
    documentsStorageService,
    generatePreviews: async (
      generate = async () => ({
        previews: (['thumb', 'card', 'preview'] as const).map((variant) => ({
          variant,
          buffer: WEBP_BYTES,
          mimeType: 'image/webp',
          width: 10,
          height: 14,
        })),
      }),
    ) =>
      generateDocumentPreviews({
        documentId: DOCUMENT_ID,
        organizationId: ORGANIZATION_ID,
        documentsRepository: createDocumentsRepository({ db }),
        documentPreviewsRepository: createDocumentPreviewsRepository({ db }),
        documentsStorageService,
        generatePreviews: generate,
        logger: createNoopLogger(),
      }),
  };
}

const previewUrl = (variant: string, documentId = DOCUMENT_ID) =>
  `/api/organizations/${ORGANIZATION_ID}/documents/${documentId}/previews/${variant}`;

describe('document previews e2e', () => {
  describe('get document preview', () => {
    test('when the previews of an existing document are not generated yet, the route answers not ready and schedules their generation, then serves the webp once generated', async () => {
      const { app, taskServices, generatePreviews } = await createTestApp();

      const notReadyResponse = await app.request(
        previewUrl('thumb'),
        {},
        { loggedInUserId: USER_ID },
      );

      expect(notReadyResponse.status).to.eql(503);
      expect(notReadyResponse.headers.get('Retry-After')).to.eql('3');
      expect(notReadyResponse.headers.get('Cache-Control')).to.eql('no-store');
      expect(await notReadyResponse.json()).to.eql({
        error: {
          code: 'document.preview_not_ready',
          message: 'The document preview is not ready yet, try again shortly.',
        },
      });
      expect(await taskServices.getJobCount()).to.eql({ count: 1 });

      await generatePreviews();

      const response = await app.request(previewUrl('thumb'), {}, { loggedInUserId: USER_ID });

      expect(response.status).to.eql(200);
      expect(response.headers.get('Content-Type')).to.eql('image/webp');
      expect(response.headers.get('Cache-Control')).to.eql('private, max-age=86400');
      expect(response.headers.get('Content-Length')).to.eql(String(WEBP_BYTES.byteLength));
      expect(response.headers.get('ETag')).to.eql('"hash-pdf-thumb"');
      expect(Buffer.from(await response.arrayBuffer())).to.eql(WEBP_BYTES);
    });

    test('a matching If-None-Match header is answered with a 304 without body', async () => {
      const { app, generatePreviews } = await createTestApp();
      await generatePreviews();

      const response = await app.request(
        previewUrl('card'),
        { headers: { 'If-None-Match': '"hash-pdf-card"' } },
        { loggedInUserId: USER_ID },
      );

      expect(response.status).to.eql(304);
      expect(response.headers.get('ETag')).to.eql('"hash-pdf-card"');
      expect(await response.text()).to.eql('');
    });

    test('document types without preview are answered with a distinct, non retryable error and no job is scheduled', async () => {
      const { app, taskServices } = await createTestApp();

      const response = await app.request(
        previewUrl('thumb', TEXT_DOCUMENT_ID),
        {},
        { loggedInUserId: USER_ID },
      );

      expect(response.status).to.eql(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).to.eql(
        'document.preview_unsupported',
      );
      expect(await taskServices.getJobCount()).to.eql({ count: 0 });
    });

    test('when previews are disabled, the route answers unsupported', async () => {
      const { app, taskServices } = await createTestApp({ arePreviewsEnabled: false });

      const response = await app.request(previewUrl('thumb'), {}, { loggedInUserId: USER_ID });

      expect(response.status).to.eql(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).to.eql(
        'document.preview_unsupported',
      );
      expect(await taskServices.getJobCount()).to.eql({ count: 0 });
    });

    test('when the generation failed twice, the route answers a failed error', async () => {
      const { app, generatePreviews } = await createTestApp();
      const failingGenerate = async () => {
        throw new Error('Corrupted file');
      };
      await generatePreviews(failingGenerate);
      await generatePreviews(failingGenerate);

      const response = await app.request(previewUrl('thumb'), {}, { loggedInUserId: USER_ID });

      expect(response.status).to.eql(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).to.eql(
        'document.preview_failed',
      );
    });

    test('the variant must be one of thumb, card or preview', async () => {
      const { app } = await createTestApp();

      const response = await app.request(previewUrl('huge'), {}, { loggedInUserId: USER_ID });

      expect(response.status).to.eql(400);
    });

    test('only members of the organization can get a preview', async () => {
      const { app, generatePreviews } = await createTestApp();
      await generatePreviews();

      const unauthenticatedResponse = await app.request(previewUrl('thumb'));
      const nonMemberResponse = await app.request(
        previewUrl('thumb'),
        {},
        { loggedInUserId: OTHER_USER_ID },
      );

      expect(unauthenticatedResponse.status).to.eql(401);
      expect(nonMemberResponse.status).to.eql(403);
    });

    test('the document unknown in the organization is not found', async () => {
      const { app } = await createTestApp();

      const response = await app.request(
        previewUrl('thumb', 'doc_999999999999999999999999'),
        {},
        { loggedInUserId: USER_ID },
      );

      expect(response.status).to.eql(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).to.eql(
        'document.not_found',
      );
    });
  });

  describe('document payload', () => {
    test('documents expose a preview status that follows the generation', async () => {
      const { app, generatePreviews } = await createTestApp();
      const getPreviewStatuses = async () => {
        const response = await app.request(
          `/api/organizations/${ORGANIZATION_ID}/documents`,
          {},
          { loggedInUserId: USER_ID },
        );
        const { documents } = (await response.json()) as {
          documents: { id: string; previewStatus: string }[];
        };

        return Object.fromEntries(documents.map(({ id, previewStatus }) => [id, previewStatus]));
      };

      expect(await getPreviewStatuses()).to.eql({
        [DOCUMENT_ID]: 'pending',
        [TEXT_DOCUMENT_ID]: 'unsupported',
      });

      await generatePreviews();

      expect(await getPreviewStatuses()).to.eql({
        [DOCUMENT_ID]: 'ready',
        [TEXT_DOCUMENT_ID]: 'unsupported',
      });

      const documentResponse = await app.request(
        `/api/organizations/${ORGANIZATION_ID}/documents/${DOCUMENT_ID}`,
        {},
        { loggedInUserId: USER_ID },
      );
      const { document } = (await documentResponse.json()) as {
        document: { previewStatus: string; originalStorageKey?: string };
      };
      expect(document.previewStatus).to.eql('ready');
    });
  });
});
