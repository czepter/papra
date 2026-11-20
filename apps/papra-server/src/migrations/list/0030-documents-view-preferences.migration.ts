import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

export const documentsViewPreferencesMigration = {
  name: 'documents-view-preferences',

  up: async ({ db }) => {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS "documents_view_preferences" (
        "created_at" integer NOT NULL,
        "updated_at" integer NOT NULL,
        "user_id" text NOT NULL,
        "organization_id" text NOT NULL,
        "preferences" text NOT NULL,
        PRIMARY KEY("user_id", "organization_id"),
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE cascade ON DELETE cascade
      )
    `);
  },

  down: async ({ db }) => {
    await db.run(sql`DROP TABLE IF EXISTS "documents_view_preferences"`);
  },
} satisfies Migration;
