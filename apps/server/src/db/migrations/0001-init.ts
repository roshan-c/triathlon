/**
 * Initial schema for Triathlon v2.
 *
 * Migration files are immutable once released and are the schema source of
 * truth. The configured SQLite database is opened in WAL mode with foreign
 * keys enabled; all timestamps are UTC ISO-8601 strings.
 */

import type { Kysely, Migration } from "kysely";
import { sql } from "kysely";

export const migration0001 = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    // ---- Identity ----
    await db.schema
      .createTable("users")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("email", "text", (c) => c.notNull().unique())
      .addColumn("display_name", "text", (c) => c.notNull())
      .addColumn("password_hash", "text", (c) => c.notNull())
      .addColumn("is_instance_admin", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("is_suspended", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("instance_meta")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("owner_user_id", "text")
      .addColumn("timezone", "text", (c) => c.notNull().defaultTo("UTC"))
      .addColumn("bootstrap_closed_at", "text")
      .execute();

    await db.schema
      .createTable("bootstrap_codes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("code_hash", "text", (c) => c.notNull().unique())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .addColumn("used_at", "text")
      .execute();

    await db.schema
      .createTable("reset_codes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("code_hash", "text", (c) => c.notNull().unique())
      .addColumn("user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .addColumn("used_at", "text")
      .execute();

    await db.schema
      .createTable("sessions")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("token_hash", "text", (c) => c.notNull().unique())
      .addColumn("user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .addColumn("revoked_at", "text")
      .addColumn("last_used_at", "text")
      .execute();
    await db.schema
      .createIndex("sessions_user_idx")
      .on("sessions")
      .columns(["user_id"])
      .execute();

    await db.schema
      .createTable("automations")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("owner_user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("access_keys")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("owner_type", "text", (c) => c.notNull()) // user | automation
      .addColumn("owner_user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("automation_id", "text")
      .addColumn("scope", "text", (c) => c.notNull()) // project | instance
      .addColumn("project_id", "text")
      .addColumn("secret_hash", "text", (c) => c.notNull().unique())
      .addColumn("expires_at", "text")
      .addColumn("revoked_at", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("last_used_at", "text")
      .execute();
    await db.schema
      .createIndex("access_keys_owner_idx")
      .on("access_keys")
      .columns(["owner_user_id", "scope"])
      .execute();

    // ---- Audit ----
    await db.schema
      .createTable("audit_log")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("request_id", "text", (c) => c.notNull())
      .addColumn("occurred_at", "text", (c) => c.notNull())
      .addColumn("actor_user_id", "text")
      .addColumn("actor_automation_id", "text")
      .addColumn("actor_key_id", "text")
      .addColumn("client_header", "text")
      .addColumn("operation", "text", (c) => c.notNull())
      .addColumn("target_type", "text")
      .addColumn("target_id", "text")
      .addColumn("result", "text", (c) => c.notNull()) // ok | error
      .addColumn("detail", "text")
      .execute();
    await db.schema
      .createIndex("audit_occurred_idx")
      .on("audit_log")
      .columns(["occurred_at"])
      .execute();

    // ---- Projects ----
    await db.schema
      .createTable("projects")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("timezone", "text", (c) => c.notNull())
      .addColumn("created_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("owner_user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("deleted_at", "text")
      .addColumn("purged_at", "text")
      .execute();

    await db.schema
      .createTable("project_members")
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("added_at", "text", (c) => c.notNull())
      .addColumn("added_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("removed_at", "text")
      .addColumn("removed_by", "text")
      .addPrimaryKeyConstraint("project_members_pk", ["project_id", "user_id"])
      .execute();

    await db.schema
      .createTable("columns")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("category", "text", (c) => c.notNull()) // not_started | started | done
      .addColumn("position", "integer", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex("columns_project_pos_idx")
      .on("columns")
      .columns(["project_id", "position"])
      .execute();

    await db.schema
      .createTable("invitations")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("code_hash", "text", (c) => c.notNull().unique())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("created_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text")
      .addColumn("revoked_at", "text")
      .execute();

    // ---- Work ----
    await db.schema
      .createTable("tickets")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("number", "integer", (c) => c.notNull())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("description_md", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("points", "integer")
      .addColumn("priority", "text", (c) => c.notNull().defaultTo("medium"))
      .addColumn("assignee_id", "text")
      .addColumn("column_id", "text", (c) =>
        c.notNull().references("columns.id").onDelete("restrict"),
      )
      .addColumn("position", "integer", (c) => c.notNull())
      .addColumn("revision", "integer", (c) => c.notNull().defaultTo(1))
      .addColumn("resource_version", "integer", (c) => c.notNull().defaultTo(1))
      .addColumn("labels_json", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("parent_id", "text")
      .addColumn("created_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("deleted_at", "text")
      .execute();
    await db.schema
      .createIndex("tickets_project_number_idx")
      .on("tickets")
      .columns(["project_id", "number"])
      .unique()
      .execute();
    await db.schema
      .createIndex("tickets_project_column_pos_idx")
      .on("tickets")
      .columns(["project_id", "column_id", "position"])
      .execute();
    await db.schema
      .createIndex("tickets_project_assignee_idx")
      .on("tickets")
      .columns(["project_id", "assignee_id"])
      .execute();

    await db.schema
      .createTable("ticket_links")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("blocker_id", "text", (c) =>
        c.notNull().references("tickets.id").onDelete("cascade"),
      )
      .addColumn("blocked_id", "text", (c) =>
        c.notNull().references("tickets.id").onDelete("cascade"),
      )
      .addColumn("created_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex("ticket_links_pair_idx")
      .on("ticket_links")
      .columns(["blocker_id", "blocked_id"])
      .unique()
      .execute();
    await db.schema
      .createIndex("ticket_links_blocked_idx")
      .on("ticket_links")
      .columns(["blocked_id"])
      .execute();

    await db.schema
      .createTable("comments")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("ticket_id", "text", (c) =>
        c.notNull().references("tickets.id").onDelete("cascade"),
      )
      .addColumn("author_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("body", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex("comments_ticket_idx")
      .on("comments")
      .columns(["ticket_id", "created_at"])
      .execute();

    await db.schema
      .createTable("review_records")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("ticket_id", "text", (c) =>
        c.notNull().references("tickets.id").onDelete("cascade"),
      )
      .addColumn("revision", "integer", (c) => c.notNull())
      .addColumn("requested_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("requested_at", "text", (c) => c.notNull())
      .addColumn("decided_by", "text")
      .addColumn("decided_at", "text")
      .addColumn("decision", "text") // approved | rejected
      .addColumn("comment", "text")
      .execute();
    await db.schema
      .createIndex("review_records_ticket_rev_idx")
      .on("review_records")
      .columns(["ticket_id", "revision", "requested_at"])
      .execute();

    await db.schema
      .createTable("activity")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("seq", "integer", (c) => c.notNull())
      .addColumn("occurred_at", "text", (c) => c.notNull())
      .addColumn("actor_user_id", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("actor_display_name", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("actor_automation_id", "text")
      .addColumn("type", "text", (c) => c.notNull())
      .addColumn("target_type", "text")
      .addColumn("target_id", "text")
      .addColumn("payload_json", "text", (c) => c.notNull().defaultTo("{}"))
      .execute();
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

    // ---- Planning ----
    await db.schema
      .createTable("sprints")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("project_id", "text", (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("planned_start", "text")
      .addColumn("planned_end", "text")
      .addColumn("state", "text", (c) => c.notNull().defaultTo("planned"))
      .addColumn("activated_at", "text")
      .addColumn("completed_at", "text")
      .addColumn("created_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("deleted_at", "text")
      .execute();
    await db.schema
      .createIndex("sprints_project_state_idx")
      .on("sprints")
      .columns(["project_id", "state"])
      .execute();

    await db.schema
      .createTable("sprint_members")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("sprint_id", "text", (c) =>
        c.notNull().references("sprints.id").onDelete("cascade"),
      )
      .addColumn("ticket_id", "text", (c) =>
        c.notNull().references("tickets.id").onDelete("cascade"),
      )
      .addColumn("added_at", "text", (c) => c.notNull())
      .addColumn("added_by", "text", (c) =>
        c.notNull().references("users.id").onDelete("cascade"),
      )
      .addColumn("removed_at", "text")
      .addColumn("removed_by", "text")
      .execute();
    await db.schema
      .createIndex("sprint_members_sprint_idx")
      .on("sprint_members")
      .columns(["sprint_id", "ticket_id"])
      .execute();

    await db.schema
      .createTable("sprint_snapshots")
      .addColumn("sprint_id", "text", (c) =>
        c.notNull().references("sprints.id").onDelete("cascade"),
      )
      .addColumn("payload_json", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();

    // ---- Idempotency ----
    await db.schema
      .createTable("idempotency")
      .addColumn("key", "text", (c) => c.notNull())
      .addColumn("fingerprint", "text", (c) => c.notNull())
      .addColumn("input_hash", "text", (c) => c.notNull())
      .addColumn("result_json", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("idempotency_pk", ["key", "fingerprint"])
      .execute();

    // Seed the single instance-meta row while bootstrap is still open.
    await sql`insert into instance_meta (id, owner_user_id, timezone, bootstrap_closed_at)
              values (1, null, 'UTC', null)`.execute(db);
  },
  down: async (db: Kysely<unknown>): Promise<void> => {
    for (const table of [
      "idempotency",
      "sprint_snapshots",
      "sprint_members",
      "sprints",
      "activity",
      "review_records",
      "comments",
      "ticket_links",
      "tickets",
      "columns",
      "project_members",
      "projects",
      "audit_log",
      "invitations",
      "access_keys",
      "automations",
      "sessions",
      "reset_codes",
      "bootstrap_codes",
      "instance_meta",
      "users",
    ]) {
      await db.schema.dropTable(table).ifExists().execute();
    }
  },
} satisfies Migration;

export const MIGRATIONS = {
  "0001-init": migration0001,
} satisfies Record<string, Migration>;

/** Name of the newest migration this build knows about. */
export const LATEST_MIGRATION = "0001-init";