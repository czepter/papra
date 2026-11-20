import type { Migration } from '../migrations.types';
import { sql } from 'drizzle-orm';

export const userPinnedTagsMigration = {
  name: 'user-pinned-tags',

  up: async ({ db }) => {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS "user_pinned_tags" (
        "created_at" integer NOT NULL,
        "user_id" text NOT NULL,
        "organization_id" text NOT NULL,
        "tag_id" text NOT NULL,
        "position" integer NOT NULL,
        PRIMARY KEY ("user_id", "tag_id"),
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE cascade ON DELETE cascade,
        FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON UPDATE cascade ON DELETE cascade
      );
    `);

    await db.run(sql`
      CREATE INDEX IF NOT EXISTS "user_pinned_tags_user_org_position_index" ON "user_pinned_tags" ("user_id", "organization_id", "position");
    `);
  },

  down: async ({ db }) => {
    await db.run(sql`DROP TABLE IF EXISTS "user_pinned_tags"`);
  },
} satisfies Migration;
