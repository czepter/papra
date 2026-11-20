import type { Database } from '../../app/database/database.types';
import type { Config } from '../../config/config.types';
import type { StorageService } from '../../storage/storage.services';
import type { TaskServices } from '../../tasks/tasks.services';
import { createDocumentsRepository } from '../../documents/documents.repository';
import { GENERATE_DOCUMENT_PREVIEWS_TASK_NAME } from '../document-previews.constants';
import { createDocumentPreviewsRepository } from '../document-previews.repository';
import { generateDocumentPreviews } from '../document-previews.usecases';

export async function registerGenerateDocumentPreviewsTask({
  taskServices,
  db,
  documentsStorageService,
  config,
}: {
  taskServices: TaskServices;
  db: Database;
  documentsStorageService: StorageService;
  config: Config;
}) {
  if (!config.documents.previews.isEnabled) {
    return;
  }

  taskServices.registerTask({
    taskName: GENERATE_DOCUMENT_PREVIEWS_TASK_NAME,
    handler: async ({ data }) => {
      // TODO: remove type cast
      const { documentId, organizationId } = data as { documentId: string; organizationId: string };

      await generateDocumentPreviews({
        documentId,
        organizationId,
        documentsRepository: createDocumentsRepository({ db }),
        documentPreviewsRepository: createDocumentPreviewsRepository({ db }),
        documentsStorageService,
      });
    },
  });
}
