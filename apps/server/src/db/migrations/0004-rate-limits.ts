import type { Kysely, Migration } from "kysely";

export const migration0004 = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema
      .createTable("rate_limits")
      .addColumn("key", "text", (c) => c.primaryKey())
      .addColumn("attempts", "integer", (c) => c.notNull())
      .addColumn("reset_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("rate_limits_reset_idx").on("rate_limits").column("reset_at").execute();
  },
  down: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema.dropTable("rate_limits").ifExists().execute();
  },
} satisfies Migration;
