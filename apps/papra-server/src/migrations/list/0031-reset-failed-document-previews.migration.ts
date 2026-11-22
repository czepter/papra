import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

// PDFs with embedded images (all scanned documents) failed to render until the pdf canvas factory was fixed.
// Their previews are given back their attempts, so they are generated again the next time they are requested.
export const resetFailedDocumentPreviewsMigration = {
  name: 'reset-failed-document-previews',

  up: async ({ db }) => {
    await db.run(sql`
      UPDATE "document_previews" SET "failed_attempts_count" = 0 WHERE "status" = 'failed'
    `);
  },

  down: async () => {
    // Nothing to restore, the previous attempt counts are not meaningful anymore
  },
} satisfies Migration;
