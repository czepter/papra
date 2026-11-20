import { describe, expect, test } from 'vitest';
import { createInMemoryDatabase } from '../../app/database/database.test-utils';
import { overrideConfig } from '../../config/config.test-utils';
import { createReadableStream } from '../../shared/streams/readable-stream';
import { createInMemoryStorageService } from '../../storage/storage.test-utils';
import { createInMemoryTaskServices } from '../../tasks/tasks.test-utils';
import { documentPreviewsTable } from '../document-previews.table';
import { registerGenerateDocumentPreviewsTask } from './generate-document-previews.task';

async function setup({ isEnabled = true } = {}) {
  const { db } = await createInMemoryDatabase({
    organizations: [{ id: 'org_1', name: 'Org 1' }],
    documents: [
      {
        id: 'doc_1',
        organizationId: 'org_1',
        name: 'image.png',
        originalName: 'image.png',
        mimeType: 'image/png',
        originalStorageKey: 'org_1/originals/doc_1.png',
        originalSha256Hash: 'hash',
      },
    ],
  });
  const taskServices = createInMemoryTaskServices();
  const documentsStorageService = createInMemoryStorageService();

  await registerGenerateDocumentPreviewsTask({
    db,
    taskServices,
    documentsStorageService,
    config: overrideConfig({ documents: { previews: { isEnabled } } }),
  });

  return { db, taskServices, documentsStorageService };
}

describe('generate document previews task', () => {
  test('the task is not registered when previews are disabled', async () => {
    const { taskServices } = await setup({ isEnabled: false });

    expect(
      taskServices.getTaskRegistry().getTask({ taskName: 'generate-document-previews' })
        .taskDefinition,
    ).to.eql(undefined);
  });

  test('running the task for a document whose file is not renderable remembers the failure instead of throwing', async () => {
    const { db, taskServices, documentsStorageService } = await setup();
    await documentsStorageService.saveFile({
      storageKey: 'org_1/originals/doc_1.png',
      fileStream: createReadableStream({ content: 'not an image' }),
      fileName: 'image.png',
      mimeType: 'image/png',
    });
    const { taskDefinition } = taskServices
      .getTaskRegistry()
      .getTaskOrThrow({ taskName: 'generate-document-previews' });

    await taskDefinition.handler({
      data: { documentId: 'doc_1', organizationId: 'org_1' },
      context: { workerId: 'test' },
    });

    expect(
      (await db.select().from(documentPreviewsTable)).map(({ status, failedAttemptsCount }) => [
        status,
        failedAttemptsCount,
      ]),
    ).to.eql([
      ['failed', 1],
      ['failed', 1],
      ['failed', 1],
    ]);
  });
});
