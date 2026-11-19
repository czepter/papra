import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

export const documentPreviewsMigration = {
  name: 'document-previews',

  up: async ({ db }) => {
    await db.batch([
      db.run(sql`
        CREATE TABLE IF NOT EXISTS "document_previews" (
          "id" text PRIMARY KEY NOT NULL,
          "created_at" integer NOT NULL,
          "updated_at" integer NOT NULL,
          "document_id" text NOT NULL,
          "variant" text NOT NULL,
          "status" text NOT NULL,
          "failed_attempts_count" integer DEFAULT 0 NOT NULL,
          "storage_key" text,
          "mime_type" text,
          "size" integer,
          "width" integer,
          "height" integer,
          "file_encryption_key_wrapped" text,
          "file_encryption_kek_version" text,
          "file_encryption_algorithm" text,
          FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE cascade ON DELETE cascade
        )
      `),
      db.run(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "document_previews_document_id_variant_unique" ON "document_previews" ("document_id", "variant")`,
      ),
    ]);
  },

  down: async ({ db }) => {
    await db.batch([db.run(sql`DROP TABLE IF EXISTS "document_previews"`)]);
  },
} satisfies Migration;
