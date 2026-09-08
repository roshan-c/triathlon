/**
 * Activity outlives the domain resources it describes. Remove the project
 * foreign key so purging a project cannot cascade into its immutable history.
 */

import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

export const migration0002 = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    await sql`
      create table activity_next (
        id text primary key,
        project_id text not null,
        seq integer not null,
        occurred_at text not null,
        actor_user_id text not null references users(id) on delete restrict,
        actor_display_name text not null default '',
        actor_automation_id text,
        type text not null,
        target_type text,
        target_id text,
        payload_json text not null default '{}'
      )
    `.execute(db);
    await sql`
      insert into activity_next
      select id, project_id, seq, occurred_at, actor_user_id,
             actor_display_name, actor_automation_id, type, target_type,
             target_id, payload_json
      from activity
    `.execute(db);
    await db.schema.dropTable("activity").execute();
    await sql`alter table activity_next rename to activity`.execute(db);
    await db.schema
      .createIndex("activity_project_seq_idx")
      .on("activity")
      .columns(["project_id", "seq"])
      .unique()
      .execute();
    await db.schema
      .createIndex("activity_project_time_idx")
      .on("activity")
      .columns(["project_id", "occurred_at"])
      .execute();
  },
  down: async (): Promise<void> => {
    throw new Error("0002-permanent-activity is forward-only");
  },
} satisfies Migration;
