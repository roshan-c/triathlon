/**
 * Kysely database types.
 *
 * The migration files under db/migrations are the schema source of truth;
 * these types mirror them and are checked in. Regenerate with
 * `npm run db:codegen` when the schema changes (see README).
 */

import type { Kysely } from "kysely";

export type BoolInt = 0 | 1;
export type ColumnCategory = "not_started" | "started" | "done";
export type KeyScope = "project" | "instance";
export type SprintState = "planned" | "active" | "completed";
export type ReviewDecision = "approved" | "rejected";

export interface UsersTable {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_instance_admin: BoolInt;
  is_suspended: BoolInt;
  created_at: string;
}

export interface InstanceMetaTable {
  id: number; // always 1
  owner_user_id: string | null;
  timezone: string;
  bootstrap_closed_at: string | null;
}

export interface BootstrapCodesTable {
  id: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface ResetCodesTable {
  id: string;
  code_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface SessionsTable {
  id: string;
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface AutomationsTable {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

export interface AccessKeysTable {
  id: string;
  name: string;
  owner_type: "user" | "automation";
  owner_user_id: string;
  automation_id: string | null;
  scope: KeyScope;
  project_id: string | null;
  secret_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface InvitationsTable {
  id: string;
  code_hash: string;
  project_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface AuditLogTable {
  id: string;
  request_id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_automation_id: string | null;
  actor_key_id: string | null;
  client_header: string | null;
  operation: string;
  target_type: string | null;
  target_id: string | null;
  result: "ok" | "error";
  detail: string | null;
}

export interface ProjectsTable {
  id: string;
  name: string;
  timezone: string;
  created_by: string;
  owner_user_id: string;
  created_at: string;
  deleted_at: string | null;
  purged_at: string | null;
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  added_at: string;
  added_by: string;
  removed_at: string | null;
  removed_by: string | null;
}

export interface ColumnsTable {
  id: string;
  project_id: string;
  name: string;
  category: ColumnCategory;
  position: number;
  created_at: string;
}

export interface TicketsTable {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description_md: string;
  points: number | null;
  priority: "low" | "medium" | "high";
  assignee_id: string | null;
  column_id: string;
  position: number;
  revision: number;
  resource_version: number;
  labels_json: string; // JSON array of strings
  parent_id: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface TicketLinksTable {
  id: string;
  project_id: string;
  blocker_id: string;
  blocked_id: string;
  created_by: string;
  created_at: string;
}

export interface CommentsTable {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface ReviewRecordsTable {
  id: string;
  ticket_id: string;
  revision: number;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision: ReviewDecision | null;
  comment: string | null;
}

export interface ActivityTable {
  id: string;
  project_id: string;
  /** Monotonic per-project event sequence. */
  seq: number;
  occurred_at: string;
  actor_user_id: string;
  actor_display_name: string;
  actor_automation_id: string | null;
  type: string;
  target_type: string | null;
  target_id: string | null;
  payload_json: string;
}

export interface SprintsTable {
  id: string;
  project_id: string;
  name: string;
  planned_start: string | null;
  planned_end: string | null;
  state: SprintState;
  activated_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface SprintMembersTable {
  id: string;
  sprint_id: string;
  ticket_id: string;
  added_at: string;
  added_by: string;
  removed_at: string | null;
  removed_by: string | null;
}

export interface SprintSnapshotsTable {
  sprint_id: string;
  payload_json: string;
  created_at: string;
}

export interface IdempotencyTable {
  key: string;
  fingerprint: string; // credential + method + route
  input_hash: string;
  result_json: string;
  created_at: string;
}

export interface Database {
  users: UsersTable;
  instance_meta: InstanceMetaTable;
  bootstrap_codes: BootstrapCodesTable;
  reset_codes: ResetCodesTable;
  sessions: SessionsTable;
  automations: AutomationsTable;
  access_keys: AccessKeysTable;
  invitations: InvitationsTable;
  audit_log: AuditLogTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  columns: ColumnsTable;
  tickets: TicketsTable;
  ticket_links: TicketLinksTable;
  comments: CommentsTable;
  review_records: ReviewRecordsTable;
  activity: ActivityTable;
  sprints: SprintsTable;
  sprint_members: SprintMembersTable;
  sprint_snapshots: SprintSnapshotsTable;
  idempotency: IdempotencyTable;
}

export type Db = Kysely<Database>;