import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

export const documentInboxMigration = {
  name: 'document-inbox',

  up: async ({ db }) => {
    await db.batch([
      db.run(sql`
        CREATE TABLE IF NOT EXISTS "document_reviews" (
          "id" text PRIMARY KEY NOT NULL,
          "created_at" integer NOT NULL,
          "updated_at" integer NOT NULL,
          "organization_id" text NOT NULL,
          "document_id" text NOT NULL,
          "user_id" text,
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE cascade ON DELETE cascade,
          FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE cascade ON DELETE cascade,
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade
        )
      `),
      db.run(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "document_reviews_document_id_user_id_unique" ON "document_reviews" ("document_id", "user_id")`,
      ),
      db.run(
        sql`CREATE INDEX IF NOT EXISTS "document_reviews_organization_id_document_id_index" ON "document_reviews" ("organization_id", "document_id")`,
      ),
    ]);

    // Existing documents are considered reviewed (system review, no user), so the inbox starts empty for existing installs
    // The NOT EXISTS keeps the migration idempotent if it is replayed
    await db.run(sql`
      INSERT INTO "document_reviews" ("id", "created_at", "updated_at", "organization_id", "document_id", "user_id")
      SELECT 'doc_rev_' || lower(hex(randomblob(12))), CAST(unixepoch('subsec') * 1000 AS integer), CAST(unixepoch('subsec') * 1000 AS integer), "organization_id", "id", NULL
      FROM "documents"
      WHERE NOT EXISTS (
        SELECT 1 FROM "document_reviews" WHERE "document_reviews"."document_id" = "documents"."id" AND "document_reviews"."user_id" IS NULL
      )
    `);

    const tableInfo = await db.run(sql`PRAGMA table_info(organization_settings)`);

    if (!tableInfo.rows.some((row) => row.name === 'inbox_mode')) {
      await db.run(sql`ALTER TABLE "organization_settings" ADD COLUMN "inbox_mode" text`);
    }
  },

  down: async ({ db }) => {
    await db.batch([
      db.run(sql`DROP TABLE IF EXISTS "document_reviews"`),
      db.run(sql`ALTER TABLE "organization_settings" DROP COLUMN "inbox_mode"`),
    ]);
  },
} satisfies Migration;
