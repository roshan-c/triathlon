/**
 * Work module.
 *
 * Owns: tickets with per-project sequential numbers, explicit positions and
 * atomic board reordering, comments, structured Activity history, blocking
 * and parent-of relationships, ticket revisions and review records, Move /
 * Resolve / Reopen, soft deletion and restoration, ticket purge, and the
 * Frontier calculation.
 *
 * The public seam is WorkService. `workMutations` are narrow trx-scoped
 * helpers for the Projects module's atomic member-removal and column-deletion
 * commands; do not call them from HTTP.
 */

import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";
import type { Database as DbSchema } from "../db/types.js";
import type { ColumnCategory } from "../db/types.js";
import type { Db } from "../db/types.js";
import { domainError } from "../errors.js";
import type { Clock } from "../time.js";
import type { Ids } from "../ids.js";
import type { Json } from "./context.js";
import type { RequestContext } from "./context.js";
import { requireOpenProject as requireOpenProjectSeam } from "./projects.js";
import type { Column, ProjectsSeam } from "./projects.js";
import { runCommand } from "./tx.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_BYTES = 64 * 1024;
export const MAX_LABELS = 50;
export const MAX_LABEL_LENGTH = 50;
export const MAX_POINTS = 10_000;
export const MAX_COMMENT_BYTES = 64 * 1024;

export type Priority = "low" | "medium" | "high";

export interface Ticket {
  id: string;
  projectId: string;
  number: number;
  title: string;
  descriptionMd: string;
  points: number | null;
  priority: Priority;
  assigneeId: string | null;
  columnId: string;
  position: number;
  revision: number;
  resourceVersion: number;
  labels: string[];
  parentId: string | null;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
  category: ColumnCategory;
}

export interface TicketSummary {
  id: string;
  projectId: string;
  number: number;
  title: string;
  points: number | null;
  priority: Priority;
  labels: string[];
  assigneeId: string | null;
  columnId: string;
  position: number;
  revision: number;
  resourceVersion: number;
  createdAt: string;
  deletedAt: string | null;
  category: ColumnCategory;
}

export interface TicketRef {
  id: string;
  number: number;
  title: string;
  category: ColumnCategory;
  deleted: boolean;
}

export interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type ReviewStateName = "unreviewed" | "requested" | "approved" | "rejected";

export interface ReviewState {
  revision: number;
  state: ReviewStateName;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface TicketDetail {
  ticket: Ticket;
  comments: Comment[];
  review: ReviewState;
  blockers: TicketRef[];
  blockedBy: TicketRef[];
  children: TicketRef[];
  parent: TicketRef | null;
}

export interface ActivityEntry {
  id: string;
  projectId: string;
  seq: number;
  occurredAt: string;
  actorUserId: string;
  actorDisplayName: string;
  actorAutomationId: string | null;
  type: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, Json>;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateTicketInput {
  title: string;
  descriptionMd?: string;
  points?: number;
  priority?: Priority;
  labels?: string[];
  assigneeId?: string;
  parentId?: string;
  blockerIds?: string[];
  columnId?: string;
}

export interface TicketChanges {
  title?: string;
  descriptionMd?: string;
  /** undefined = unchanged; null = unset; number = set. */
  points?: number | null;
  priority?: Priority;
  /** undefined = unchanged; null = unset; array = replace. */
  labels?: string[] | null;
  /** undefined = unchanged; null = unset; string = set. */
  assigneeId?: string | null;
  /** undefined = unchanged; null = unset; string = set. */
  parentId?: string | null;
}

export interface MoveInput {
  columnId: string;
  position: number;
}

export interface TicketFilter {
  /** Query predicate: state of the ticket, not a stored status field. */
  visibility?: "open" | "closed" | "deleted";
  columnId?: string;
  assigneeId?: string;
  label?: string;
  cursor?: string;
  limit?: number;
}

export interface TicketCore {
  id: string;
  number: number;
  title: string;
  points: number | null;
  priority: Priority;
  labels: string[];
  assigneeId: string | null;
  columnId: string;
  position: number;
  category: ColumnCategory;
  deletedAt: string | null;
  createdAt: string;
}

/** Narrow seam consumed by Planning: ticket facts for metrics. */
export interface WorkSeam {
  ticketCore(projectId: string, ticketId: string, trx?: Kysely<DbSchema>): Promise<TicketCore | null>;
}

/** Trx-scoped helpers for the Projects module's atomic commands. */
export interface WorkMutations {
  unassignOpenTickets(
    trx: Transaction<DbSchema>,
    projectId: string,
    userId: string,
    _now: string,
  ): Promise<number>;
  moveColumnTickets(
    trx: Transaction<DbSchema>,
    projectId: string,
    fromColumnId: string,
    toColumnId: string,
  ): Promise<number>;
}

export interface WorkService {
  createTicket(ctx: RequestContext, projectId: string, input: CreateTicketInput): Promise<Ticket>;
  getTicketDetail(ctx: RequestContext, projectId: string, ref: string): Promise<TicketDetail | null>;
  listTickets(ctx: RequestContext, projectId: string, filter: TicketFilter): Promise<Paged<TicketSummary>>;
  updateTicket(
    ctx: RequestContext,
    projectId: string,
    ref: string,
    expectedVersion: number,
    changes: TicketChanges,
  ): Promise<Ticket>;
  moveTicket(
    ctx: RequestContext,
    projectId: string,
    ref: string,
    expectedVersion: number,
    input: MoveInput,
  ): Promise<Ticket>;
  addComment(ctx: RequestContext, projectId: string, ref: string, body: string): Promise<Comment>;
  addBlockers(
    ctx: RequestContext,
    projectId: string,
    ref: string,
    blockerIds: string[],
  ): Promise<Ticket>;
  removeBlocker(ctx: RequestContext, projectId: string, ref: string, blockerId: string): Promise<Ticket>;
  requestReview(ctx: RequestContext, projectId: string, ref: string): Promise<ReviewState>;
  decideReview(
    ctx: RequestContext,
    projectId: string,
    ref: string,
    decision: "approved" | "rejected",
    comment?: string,
  ): Promise<ReviewState>;
  resolveTicket(ctx: RequestContext, projectId: string, ref: string, expectedVersion: number, comment: string): Promise<Ticket>;
  reopenTicket(
    ctx: RequestContext,
    projectId: string,
    ref: string,
    expectedVersion: number,
    input: { columnId: string; comment?: string },
  ): Promise<Ticket>;
  deleteTicket(ctx: RequestContext, projectId: string, ref: string, expectedVersion: number): Promise<Ticket>;
  restoreTicket(ctx: RequestContext, projectId: string, ref: string): Promise<Ticket>;
  purgeTicket(ctx: RequestContext, projectId: string, ref: string): Promise<void>;
  frontier(ctx: RequestContext, projectId: string, opts: { cursor?: string; limit?: number }): Promise<Paged<TicketSummary>>;
  activity(ctx: RequestContext, projectId: string, opts: { cursor?: string; limit?: number }): Promise<Paged<ActivityEntry>>;
}

export interface WorkDeps {
  db: Db;
  clock: Clock;
  ids: Ids;
  projects: ProjectsSeam;
}

type JsonValue = Json;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
    throw domainError(
      "VALIDATION_FAILED",
      `Title must be between 1 and ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return trimmed;
}

function validateDescription(md: string): string {
  if (Buffer.byteLength(md, "utf8") > MAX_DESCRIPTION_BYTES) {
    throw domainError(
      "VALIDATION_FAILED",
      `Description must be at most ${MAX_DESCRIPTION_BYTES / 1024} KiB`,
    );
  }
  return md;
}

function validatePoints(points: number): number {
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
    throw domainError(
      "VALIDATION_FAILED",
      `Points must be a non-negative integer up to ${MAX_POINTS}`,
    );
  }
  return points;
}

function validatePriority(p: Priority): Priority {
  if (p !== "low" && p !== "medium" && p !== "high") {
    throw domainError("VALIDATION_FAILED", "Priority must be low, medium, or high");
  }
  return p;
}

function validateLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().toLowerCase();
    if (label.length === 0) continue;
    if (label.length > MAX_LABEL_LENGTH) {
      throw domainError(
        "VALIDATION_FAILED",
        `Labels may be at most ${MAX_LABEL_LENGTH} characters`,
      );
    }
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  if (out.length > MAX_LABELS) {
    throw domainError("VALIDATION_FAILED", `At most ${MAX_LABELS} labels`);
  }
  return out;
}

function validateBody(body: string, what: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw domainError("VALIDATION_FAILED", `${what} must not be empty`);
  }
  if (Buffer.byteLength(trimmed, "utf8") > MAX_COMMENT_BYTES) {
    throw domainError(
      "VALIDATION_FAILED",
      `${what} must be at most ${MAX_COMMENT_BYTES / 1024} KiB`,
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Work mutations (Projects module seam)
// ---------------------------------------------------------------------------

export const workMutations: WorkMutations = {
  unassignOpenTickets: async (trx, projectId, userId, _now) => {
    const doneSub = trx
      .selectFrom("columns")
      .select("id")
      .where("project_id", "=", projectId)
      .where("category", "=", "done");
    const rows = await trx
      .selectFrom("tickets")
      .select(["id"])
      .where("project_id", "=", projectId)
      .where("assignee_id", "=", userId)
      .where("deleted_at", "is", null)
      .where("column_id", "not in", doneSub)
      .execute();
    for (const row of rows) {
      // Assignment is reviewable material: bump revision and resource version.
      await trx
        .updateTable("tickets")
        .set((eb) => ({
          assignee_id: null,
          revision: eb("revision", "+", 1),
          resource_version: eb("resource_version", "+", 1),
        }))
        .where("id", "=", row.id)
        .execute();
    }
    return rows.length;
  },
  moveColumnTickets: async (trx, projectId, fromColumnId, toColumnId) => {
    const base = await trx
      .selectFrom("tickets")
      .select((eb) => eb.fn.max<number>("position").as("m"))
      .where("project_id", "=", projectId)
      .where("column_id", "=", toColumnId)
      .executeTakeFirst();
    let position = (base?.m ?? -1) + 1;
    const rows = await trx
      .selectFrom("tickets")
      .select(["id"])
      .where("project_id", "=", projectId)
      .where("column_id", "=", fromColumnId)
      .orderBy("position")
      .execute();
    for (const row of rows) {
      const p = position++;
      await trx
        .updateTable("tickets")
        .set((eb) => ({
          column_id: toColumnId,
          position: p,
          resource_version: eb("resource_version", "+", 1),
        }))
        .where("id", "=", row.id)
        .execute();
    }
    return rows.length;
  },
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createWorkService(deps: WorkDeps): WorkSeam & WorkService {
  const { db, clock, ids } = deps;
  const nowIso = (): string => clock.now().toISOString();

  interface TicketRow {
    id: string;
    project_id: string;
    number: number;
    title: string;
    description_md: string;
    points: number | null;
    priority: string;
    assignee_id: string | null;
    column_id: string;
    position: number;
    revision: number;
    resource_version: number;
    labels_json: string;
    parent_id: string | null;
    created_by: string;
    created_at: string;
    deleted_at: string | null;
    category: string;
  }

  function toTicket(row: TicketRow): Ticket {
    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number,
      title: row.title,
      descriptionMd: row.description_md,
      points: row.points,
      // SAFETY: tickets.priority is written only with Priority literals.
      priority: row.priority as Priority,
      assigneeId: row.assignee_id,
      columnId: row.column_id,
      position: row.position,
      revision: row.revision,
      resourceVersion: row.resource_version,
      // SAFETY: the column stores only literals written by this module.
      labels: JSON.parse(row.labels_json) as string[],
      parentId: row.parent_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      // SAFETY: the column stores only literals written by this module.
      category: row.category as ColumnCategory,
    };
  }

  function toSummary(row: TicketRow): TicketSummary {
    const t = toTicket(row);
    return {
      id: t.id,
      projectId: t.projectId,
      number: t.number,
      title: t.title,
      points: t.points,
      priority: t.priority,
      labels: t.labels,
      assigneeId: t.assigneeId,
      columnId: t.columnId,
      position: t.position,
      revision: t.revision,
      resourceVersion: t.resourceVersion,
      createdAt: t.createdAt,
      deletedAt: t.deletedAt,
      category: t.category,
    };
  }

  const ticketBase = () =>
    db
      .selectFrom("tickets")
      .innerJoin("columns", "columns.id", "tickets.column_id")
      .select([
        "tickets.id",
        "tickets.project_id",
        "tickets.number",
        "tickets.title",
        "tickets.description_md",
        "tickets.points",
        "tickets.priority",
        "tickets.assignee_id",
        "tickets.column_id",
        "tickets.position",
        "tickets.revision",
        "tickets.resource_version",
        "tickets.labels_json",
        "tickets.parent_id",
        "tickets.created_by",
        "tickets.created_at",
        "tickets.deleted_at",
        "columns.category",
      ]);

  const requireOpenProject = (
    ctx: RequestContext,
    projectId: string,
    trx?: Kysely<DbSchema>,
  ): Promise<void> => requireOpenProjectSeam(deps.projects, ctx, projectId, trx);

  async function resolveRef(
    trx: Kysely<DbSchema>,
    projectId: string,
    ref: string,
  ): Promise<{ id: string; number: number }> {
    const trimmed = ref.trim();
    const numberOnly = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    let row: { id: string; number: number } | undefined;
    if (isUuid) {
      row = await trx
        .selectFrom("tickets")
        .select(["id", "number"])
        .where("project_id", "=", projectId)
        .where("id", "=", trimmed)
        .executeTakeFirst();
    } else if (/^\d+$/.test(numberOnly)) {
      row = await trx
        .selectFrom("tickets")
        .select(["id", "number"])
        .where("project_id", "=", projectId)
        .where("number", "=", Number.parseInt(numberOnly, 10))
        .executeTakeFirst();
    }
    if (!row) throw domainError("NOT_FOUND", "Ticket not found");
    return row;
  }

  async function loadTicketRow(
    trx: Kysely<DbSchema>,
    projectId: string,
    ticketId: string,
  ): Promise<TicketRow> {
    const row = await trx
      .selectFrom("tickets")
      .innerJoin("columns", "columns.id", "tickets.column_id")
      .selectAll("tickets")
      .select("columns.category")
      .where("tickets.project_id", "=", projectId)
      .where("tickets.id", "=", ticketId)
      .executeTakeFirst();
    if (!row) throw domainError("NOT_FOUND", "Ticket not found");
    // SAFETY: the column stores only literals written by this module.
    return row as TicketRow;
  }

  async function requireVersion(
    trx: Kysely<DbSchema>,
    ticketId: string,
    expected: number,
  ): Promise<void> {
    const row = await trx
      .selectFrom("tickets")
      .select("resource_version")
      .where("id", "=", ticketId)
      .executeTakeFirstOrThrow();
    if (row.resource_version !== expected) {
      throw domainError(
        "VERSION_CONFLICT",
        `Resource version ${expected} is stale; current version is ${row.resource_version}`,
      );
    }
  }

  async function columnById(
    trx: Kysely<DbSchema>,
    projectId: string,
    columnId: string,
  ): Promise<Column> {
    const row = await trx
      .selectFrom("columns")
      .selectAll()
      .where("id", "=", columnId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (!row) throw domainError("NOT_FOUND", "Column not found");
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      // SAFETY: the column stores only literals written by this module.
      category: row.category as ColumnCategory,
      position: row.position,
      createdAt: row.created_at,
    };
  }

  async function columnCount(
    trx: Kysely<DbSchema>,
    projectId: string,
    columnId: string,
  ): Promise<number> {
    const row = await trx
      .selectFrom("tickets")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("project_id", "=", projectId)
      .where("column_id", "=", columnId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row?.c ?? 0;
  }

  /** Slot a ticket into a column at an explicit position, shifting others. */
  async function insertAtPosition(
    trx: Kysely<DbSchema>,
    projectId: string,
    columnId: string,
    position: number,
    ticketId: string,
  ): Promise<number> {
    const count = await columnCount(trx, projectId, columnId);
    const target = Math.max(0, Math.min(position, count));
    await trx
      .updateTable("tickets")
      .set((eb) => ({ position: eb("position", "+", 1) }))
      .where("project_id", "=", projectId)
      .where("column_id", "=", columnId)
      .where("position", ">=", target)
      .where("id", "!=", ticketId)
      .where("deleted_at", "is", null)
      .execute();
    return target;
  }

  /** Remove a ticket's slot, closing the gap in its current column. */
  async function removeFromColumn(
    trx: Kysely<DbSchema>,
    projectId: string,
    columnId: string,
    position: number,
    ticketId: string,
  ): Promise<void> {
    await trx
      .updateTable("tickets")
      .set((eb) => ({ position: eb("position", "-", 1) }))
      .where("project_id", "=", projectId)
      .where("column_id", "=", columnId)
      .where("position", ">", position)
      .where("id", "!=", ticketId)
      .where("deleted_at", "is", null)
      .execute();
  }

  async function nextTicketNumber(
    trx: Kysely<DbSchema>,
    projectId: string,
  ): Promise<number> {
    const row = await trx
      .selectFrom("tickets")
      .select((eb) => eb.fn.max<number>("number").as("m"))
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return (row?.m ?? 0) + 1;
  }

  async function validateAssignee(
    trx: Kysely<DbSchema>,
    projectId: string,
    assigneeId: string,
  ): Promise<void> {
    const member = await trx
      .selectFrom("project_members")
      .select("user_id")
      .where("project_id", "=", projectId)
      .where("user_id", "=", assigneeId)
      .where("removed_at", "is", null)
      .executeTakeFirst();
    if (!member) {
      throw domainError("VALIDATION_FAILED", "Assignee must be an active project member");
    }
  }

  async function validateParentSupplied(
    trx: Kysely<DbSchema>,
    projectId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await trx
      .selectFrom("tickets")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", parentId)
      .executeTakeFirst();
    if (!parent || parent.deleted_at !== null) {
      throw domainError("VALIDATION_FAILED", "Parent must be an existing, non-deleted ticket");
    }
  }

  async function validateParent(
    trx: Kysely<DbSchema>,
    projectId: string,
    ticketId: string,
    parentId: string,
  ): Promise<void> {
    if (parentId === ticketId) {
      throw domainError("CYCLE_DETECTED", "A ticket cannot be its own parent");
    }
    const parent = await trx
      .selectFrom("tickets")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("id", "=", parentId)
      .executeTakeFirst();
    if (!parent || parent.deleted_at !== null) {
      throw domainError("VALIDATION_FAILED", "Parent must be an existing, non-deleted ticket");
    }
    // Walk up from the prospective parent; the ticket must not be an ancestor.
    let cursor: string | null = parent.parent_id;
    while (cursor !== null) {
      if (cursor === ticketId) {
        throw domainError("CYCLE_DETECTED", "Parent assignment would create a cycle");
      }
      const up = await trx
        .selectFrom("tickets")
        .select("parent_id")
        .where("id", "=", cursor)
        .executeTakeFirst();
      cursor = up?.parent_id ?? null;
    }
  }

  async function validateBlockers(
    trx: Kysely<DbSchema>,
    projectId: string,
    ticketId: string,
    blockerIds: string[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const blockerId of blockerIds) {
      if (blockerId === ticketId) {
        throw domainError("CYCLE_DETECTED", "A ticket cannot block itself");
      }
      const blocker = await trx
        .selectFrom("tickets")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("id", "=", blockerId)
        .executeTakeFirst();
      if (!blocker || blocker.deleted_at !== null) {
        throw domainError("VALIDATION_FAILED", "Blocker must be an existing, non-deleted ticket");
      }
      if (seen.has(blockerId)) continue;
      seen.add(blockerId);
      // Cycle check: adding blockerId -> ticketId is a cycle when the ticket
      // already (transitively) blocks the blocker. Walk forward from the
      // ticket along blocker->blocked edges looking for blockerId.
      let frontier = [ticketId];
      const visited = new Set<string>([ticketId]);
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const id of frontier) {
          const blocked = await trx
            .selectFrom("ticket_links")
            .select("blocked_id")
            .where("blocker_id", "=", id)
            .execute();
          for (const edge of blocked) {
            if (edge.blocked_id === blockerId) {
              throw domainError("CYCLE_DETECTED", "Blocking edge would create a cycle");
            }
            if (!visited.has(edge.blocked_id)) {
              visited.add(edge.blocked_id);
              next.push(edge.blocked_id);
            }
          }
        }
        frontier = next;
      }
    }
  }

  async function reviewForRevision(
    trx: Kysely<DbSchema>,
    ticketId: string,
    revision: number,
  ): Promise<ReviewState> {
    const rows = await trx
      .selectFrom("review_records")
      .selectAll()
      .where("ticket_id", "=", ticketId)
      .where("revision", "=", revision)
      .orderBy("requested_at", "desc")
      .execute();
    const latest = rows[0];
    if (!latest) {
      return {
        revision,
        state: "unreviewed",
        requestedBy: "",
        requestedAt: "",
        decidedBy: null,
        decidedAt: null,
        comment: null,
      };
    }
    const decided = latest.decision !== null && latest.decided_at !== null;
    const state: ReviewStateName = decided
      ? latest.decision === "approved"
        ? "approved"
        : "rejected"
      : "requested";
    return {
      revision,
      state,
      requestedBy: latest.requested_by,
      requestedAt: latest.requested_at,
      decidedBy: latest.decided_by,
      decidedAt: latest.decided_at,
      comment: latest.comment,
    };
  }

  const service: WorkSeam & WorkService = {
    // ---- WorkSeam ----
    ticketCore: async (projectId, ticketId, trx) => {
      const row = await (trx ?? db)
        .selectFrom("tickets")
        .innerJoin("columns", "columns.id", "tickets.column_id")
        .select([
          "tickets.id",
          "tickets.number",
          "tickets.title",
          "tickets.points",
          "tickets.priority",
          "tickets.labels_json",
          "tickets.assignee_id",
          "tickets.column_id",
          "tickets.position",
          "tickets.created_at",
          "tickets.deleted_at",
          "columns.category",
        ])
        .where("tickets.project_id", "=", projectId)
        .where("tickets.id", "=", ticketId)
        .executeTakeFirst();
      if (!row) return null;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        points: row.points,
        // SAFETY: tickets.priority is written only with Priority literals.
      priority: row.priority as Priority,
        // SAFETY: the column stores only literals written by this module.
        labels: JSON.parse(row.labels_json) as string[],
        assigneeId: row.assignee_id,
        columnId: row.column_id,
        position: row.position,
        // SAFETY: the column stores only literals written by this module.
        category: row.category as ColumnCategory,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
      };
    },

    // ---- tickets ----
    createTicket: (ctx, projectId, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.create",
          projectId,
          activityType: "ticket.created",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const title = validateTitle(input.title);
          const description = validateDescription(input.descriptionMd ?? "");
          const points = input.points === undefined ? null : validatePoints(input.points);
          const priority = validatePriority(input.priority ?? "medium");
          const labels = validateLabels(input.labels ?? []);
          let columnId = input.columnId;
          if (!columnId) {
            const first = await trx
              .selectFrom("columns")
              .select("id")
              .where("project_id", "=", projectId)
              .orderBy("position")
              .executeTakeFirst();
            if (!first) throw domainError("INVALID_STATE", "Project has no columns");
            columnId = first.id;
          }
          const column = await columnById(trx, projectId, columnId);
          if (column.category === "done") {
            throw domainError(
              "INVALID_STATE",
              "Tickets are created Open; resolve into Done instead",
            );
          }
          if (input.assigneeId) {
            await validateAssignee(trx, projectId, input.assigneeId);
          }
          if (input.parentId) {
            // The new ticket cannot be the ancestor of an existing ticket, so
            // only existence and same-project rules apply here.
            await validateParentSupplied(trx, projectId, input.parentId);
          }
          const ticketId = ids.uuidv7();
          const createdAt = nowIso();
          const number = await nextTicketNumber(trx, projectId);
          const position = await columnCount(trx, projectId, columnId);
          await trx
            .insertInto("tickets")
            .values({
              id: ticketId,
              project_id: projectId,
              number,
              title,
              description_md: description,
              points,
              priority,
              assignee_id: input.assigneeId ?? null,
              column_id: columnId,
              position,
              revision: 1,
              resource_version: 1,
              labels_json: JSON.stringify(labels),
              parent_id: null,
              created_by: ctx.actor.userId,
              created_at: createdAt,
              deleted_at: null,
            })
            .execute();
          if (input.parentId) {
            await trx
              .updateTable("tickets")
              .set({ parent_id: input.parentId })
              .where("id", "=", ticketId)
              .execute();
          }
          if (input.blockerIds && input.blockerIds.length > 0) {
            // Fresh ticket has no outgoing edges, so no cycle is possible;
            // validate existence and insert the edges.
            for (const blockerId of input.blockerIds) {
              if (blockerId === ticketId) {
                throw domainError("CYCLE_DETECTED", "A ticket cannot block itself");
              }
              const blocker = await trx
                .selectFrom("tickets")
                .select("id")
                .where("project_id", "=", projectId)
                .where("id", "=", blockerId)
                .where("deleted_at", "is", null)
                .executeTakeFirst();
              if (!blocker) {
                throw domainError(
                  "VALIDATION_FAILED",
                  "Blocker must be an existing, non-deleted ticket",
                );
              }
            }
            for (const blockerId of input.blockerIds) {
              await trx
                .insertInto("ticket_links")
                .values({
                  id: ids.uuidv7(),
                  project_id: projectId,
                  blocker_id: blockerId,
                  blocked_id: ticketId,
                  created_by: ctx.actor.userId,
                  created_at: nowIso(),
                })
                .execute();
            }
          }
          const row = await loadTicketRow(trx, projectId, ticketId);
          spec.activityPayload = {
            ticketId,
            number,
            title,
            points,
            priority,
            labels,
            columnId,
            columnCategory: column.category,
          };
          return toTicket(row);
        },
      }),

    getTicketDetail: async (ctx, projectId, ref) => {
      await requireOpenProject(ctx, projectId);
      const resolved = await resolveRef(db, projectId, ref);
      const row = await ticketBase()
        .where("tickets.project_id", "=", projectId)
        .where("tickets.id", "=", resolved.id)
        .executeTakeFirst();
      if (!row) return null;
      const ticket = toTicket(row);
      const comments = await db
        .selectFrom("comments")
        .selectAll()
        .where("ticket_id", "=", ticket.id)
        .orderBy("created_at")
        .execute()
        .then((rows) =>
          rows.map((c) => ({
            id: c.id,
            ticketId: c.ticket_id,
            authorId: c.author_id,
            body: c.body,
            createdAt: c.created_at,
          })),
        );
      const review = await reviewForRevision(db, ticket.id, ticket.revision);

      const refQuery = (linkFilter: "blocker_id" | "blocked_id", target: string, other: "blocker_id" | "blocked_id") =>
        db
          .selectFrom("ticket_links")
          .innerJoin("tickets", "tickets.id", `ticket_links.${other}`)
          .innerJoin("columns", "columns.id", "tickets.column_id")
          .select(["tickets.id", "tickets.number", "tickets.title", "tickets.deleted_at", "columns.category"])
          .where(`ticket_links.${linkFilter}`, "=", target)
          .execute()
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              number: r.number,
              title: r.title,
              // SAFETY: the column stores only literals written by this module.
              category: r.category as ColumnCategory,
              deleted: r.deleted_at !== null,
            })),
          );

      const blockers = await refQuery("blocked_id", ticket.id, "blocker_id");
      const blockedBy = await refQuery("blocker_id", ticket.id, "blocked_id");
      const children = await db
        .selectFrom("tickets")
        .innerJoin("columns", "columns.id", "tickets.column_id")
        .select(["tickets.id", "tickets.number", "tickets.title", "tickets.deleted_at", "columns.category"])
        .where("tickets.parent_id", "=", ticket.id)
        .execute()
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            number: r.number,
            title: r.title,
            // SAFETY: the column stores only literals written by this module.
            category: r.category as ColumnCategory,
            deleted: r.deleted_at !== null,
          })),
        );
      const parent = ticket.parentId
        ? await db
            .selectFrom("tickets")
            .innerJoin("columns", "columns.id", "tickets.column_id")
            .select(["tickets.id", "tickets.number", "tickets.title", "tickets.deleted_at", "columns.category"])
            .where("tickets.id", "=", ticket.parentId)
            .executeTakeFirst()
            .then((r) =>
              r
                ? {
                    id: r.id,
                    number: r.number,
                    title: r.title,
                    // SAFETY: the column stores only literals written by this module.
                    category: r.category as ColumnCategory,
                    deleted: r.deleted_at !== null,
                  }
                : null,
            )
        : null;
      return { ticket, comments, review, blockers, blockedBy, children, parent };
    },

    listTickets: async (ctx, projectId, filter) => {
      await requireOpenProject(ctx, projectId);
      const limit = Math.min(filter.limit ?? 50, 200);
      let query = ticketBase()
        .where("tickets.project_id", "=", projectId)
        .orderBy("tickets.number", "desc");
      const visibility = filter.visibility ?? "open";
      if (visibility === "deleted") {
        query = query.where("tickets.deleted_at", "is not", null);
      } else {
        query = query.where("tickets.deleted_at", "is", null);
        if (visibility === "closed") {
          query = query.where("columns.category", "=", "done");
        } else {
          query = query.where("columns.category", "!=", "done");
        }
      }
      if (filter.columnId) {
        query = query.where("tickets.column_id", "=", filter.columnId);
      }
      if (filter.assigneeId) {
        query = query.where("tickets.assignee_id", "=", filter.assigneeId);
      }
      if (filter.label) {
        query = query.where("tickets.labels_json", "like", `%${JSON.stringify(filter.label).slice(1, -1)}%`);
      }
      if (filter.cursor) {
        query = query.where("tickets.number", "<", Number.parseInt(filter.cursor, 10));
      }
      const rows = await query.limit(limit + 1).execute();
      const items = rows.slice(0, limit).map(toSummary);
      return {
        items,
        nextCursor:
          rows.length > limit ? String(items[items.length - 1]?.number ?? "") : null,
      };
    },

    updateTicket: (ctx, projectId, ref, expectedVersion, changes) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.update",
          projectId,
          activityType: "ticket.updated",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          await requireVersion(trx, resolved.id, expectedVersion);
          const before = await loadTicketRow(trx, projectId, resolved.id);
          if (before.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be updated");
          }
          const applied: Record<string, { before: JsonValue; after: JsonValue }> = {};
          // Kysely update values for the tickets table: only these shapes are
          // ever assigned below.
          const updates: Record<string, string | number | null> = {};

          if (changes.title !== undefined) {
            const title = validateTitle(changes.title);
            if (title !== before.title) {
              applied.title = { before: before.title, after: title };
              updates.title = title;
            }
          }
          if (changes.descriptionMd !== undefined) {
            const md = validateDescription(changes.descriptionMd);
            if (md !== before.description_md) {
              applied.descriptionMd = { before: before.description_md, after: md };
              updates.description_md = md;
            }
          }
          if (changes.points !== undefined) {
            const points = changes.points === null ? null : validatePoints(changes.points);
            if (points !== before.points) {
              applied.points = { before: before.points, after: points };
              updates.points = points;
            }
          }
          if (changes.priority !== undefined) {
            const priority = validatePriority(changes.priority);
            if (priority !== before.priority) {
              applied.priority = { before: before.priority, after: priority };
              updates.priority = priority;
            }
          }
          if (changes.labels !== undefined) {
            const labels = validateLabels(changes.labels ?? []);
            // SAFETY: the column stores only literals written by this module.
            const beforeLabels = JSON.parse(before.labels_json) as string[];
            if (JSON.stringify(labels) !== JSON.stringify(beforeLabels)) {
              applied.labels = { before: beforeLabels, after: labels };
              updates.labels_json = JSON.stringify(labels);
            }
          }
          if (changes.assigneeId !== undefined) {
            const assigneeId = changes.assigneeId === null ? null : changes.assigneeId;
            if (assigneeId !== null) {
              await validateAssignee(trx, projectId, assigneeId);
            }
            if (assigneeId !== before.assignee_id) {
              applied.assignee = { before: before.assignee_id, after: assigneeId };
              updates.assignee_id = assigneeId;
            }
          }
          if (changes.parentId !== undefined) {
            const parentId = changes.parentId === null ? null : changes.parentId;
            if (parentId !== null) {
              await validateParent(trx, projectId, resolved.id, parentId);
            }
            if (parentId !== before.parent_id) {
              applied.parent = { before: before.parent_id, after: parentId };
              updates.parent_id = parentId;
            }
          }

          const materialChanged = Object.keys(applied).length > 0;
          if (!materialChanged) {
            return toTicket(before);
          }
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              ...updates,
              revision: eb("revision", "+", 1),
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            changes: applied,
          };
          return toTicket(row);
        },
      }),

    moveTicket: (ctx, projectId, ref, expectedVersion, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.move",
          projectId,
          activityType: "ticket.moved",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          await requireVersion(trx, resolved.id, expectedVersion);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be moved");
          }
          // SAFETY: the column stores only literals written by this module.
          const currentCategory = ticket.category as ColumnCategory;
          if (currentCategory === "done") {
            throw domainError(
              "INVALID_STATE",
              "Closed tickets leave Done only through an explicit Reopen",
            );
          }
          const target = await columnById(trx, projectId, input.columnId);
          if (target.category === "done") {
            throw domainError(
              "INVALID_STATE",
              "Open tickets cannot be moved into Done; Resolve is the only way in",
            );
          }
          const sameColumn = target.id === ticket.column_id;
          if (!sameColumn) {
            await removeFromColumn(
              trx,
              projectId,
              ticket.column_id,
              ticket.position,
              ticket.id,
            );
          }
          const position = await insertAtPosition(
            trx,
            projectId,
            target.id,
            input.position,
            ticket.id,
          );
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              column_id: target.id,
              position,
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", ticket.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, ticket.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            fromColumnId: ticket.column_id,
            fromPosition: ticket.position,
            fromCategory: currentCategory,
            toColumnId: target.id,
            toPosition: position,
            toCategory: target.category,
          };
          return toTicket(row);
        },
      }),

    addComment: (ctx, projectId, ref, body) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "comment.add",
          projectId,
          activityType: "comment.added",
          targetType: "comment",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be commented on");
          }
          const text = validateBody(body, "Comment");
          const commentId = ids.uuidv7();
          await trx
            .insertInto("comments")
            .values({
              id: commentId,
              ticket_id: resolved.id,
              author_id: ctx.actor.userId,
              body: text,
              created_at: nowIso(),
            })
            .execute();
          spec.activityPayload = {
            ticketId: resolved.id,
            number: ticket.number,
            commentId,
          };
          return {
            id: commentId,
            ticketId: resolved.id,
            authorId: ctx.actor.userId,
            body: text,
            createdAt: nowIso(),
          };
        },
      }),

    addBlockers: (ctx, projectId, ref, blockerIds) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "blocker.add",
          projectId,
          activityType: "blocker.added",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be linked");
          }
          // Link edits are additive and do not take a version precondition.
          const unique = [...new Set(blockerIds)];
          await validateBlockers(trx, projectId, resolved.id, unique);
          const existing = await trx
            .selectFrom("ticket_links")
            .select("blocker_id")
            .where("blocked_id", "=", resolved.id)
            .execute();
          const have = new Set(existing.map((e) => e.blocker_id));
          let added = 0;
          for (const blockerId of unique) {
            if (have.has(blockerId)) continue;
            await trx
              .insertInto("ticket_links")
              .values({
                id: ids.uuidv7(),
                project_id: projectId,
                blocker_id: blockerId,
                blocked_id: resolved.id,
                created_by: ctx.actor.userId,
                created_at: nowIso(),
              })
              .execute();
            added++;
          }
          if (added > 0) {
            await trx
              .updateTable("tickets")
              .set((eb) => ({
                revision: eb("revision", "+", 1),
                resource_version: eb("resource_version", "+", 1),
              }))
              .where("id", "=", resolved.id)
              .execute();
          }
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            addedBlockerIds: unique,
          };
          return toTicket(row);
        },
      }),

    removeBlocker: (ctx, projectId, ref, blockerId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "blocker.remove",
          projectId,
          activityType: "blocker.removed",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be linked");
          }
          const edge = await trx
            .selectFrom("ticket_links")
            .select("id")
            .where("blocked_id", "=", resolved.id)
            .where("blocker_id", "=", blockerId)
            .executeTakeFirst();
          if (!edge) throw domainError("NOT_FOUND", "Blocking edge not found");
          await trx.deleteFrom("ticket_links").where("id", "=", edge.id).execute();
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              revision: eb("revision", "+", 1),
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            removedBlockerId: blockerId,
          };
          return toTicket(row);
        },
      }),

    requestReview: (ctx, projectId, ref) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "review.request",
          projectId,
          activityType: "review.requested",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be reviewed");
          }
          const current = await reviewForRevision(trx, resolved.id, ticket.revision);
          if (current.state === "requested") {
            throw domainError(
              "INVALID_STATE",
              "Review is already requested for this revision",
            );
          }
          if (current.state === "approved") {
            throw domainError(
              "INVALID_STATE",
              "This revision is already approved",
            );
          }
          await trx
            .insertInto("review_records")
            .values({
              id: ids.uuidv7(),
              ticket_id: resolved.id,
              revision: ticket.revision,
              requested_by: ctx.actor.userId,
              requested_at: nowIso(),
              decided_by: null,
              decided_at: null,
              decision: null,
              comment: null,
            })
            .execute();
          spec.activityPayload = {
            ticketId: resolved.id,
            number: ticket.number,
            revision: ticket.revision,
          };
          return reviewForRevision(trx, resolved.id, ticket.revision);
        },
      }),

    decideReview: (ctx, projectId, ref, decision, comment) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "review.decide",
          projectId,
          activityType: "review.decided",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be reviewed");
          }
          const current = await reviewForRevision(trx, resolved.id, ticket.revision);
          if (current.state !== "requested") {
            throw domainError(
              "INVALID_STATE",
              "Review must be requested before it can be decided",
            );
          }
          if (decision === "rejected") {
            validateBody(comment ?? "", "Rejection comment");
          }
          // The pending request row is never mutated: requests and decisions
          // are immutable historical records, and a decision carries the
          // original request's attribution.
          const pending = await trx
            .selectFrom("review_records")
            .selectAll()
            .where("ticket_id", "=", resolved.id)
            .where("revision", "=", ticket.revision)
            .where("decision", "is", null)
            .orderBy("requested_at", "desc")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("review_records")
            .values({
              id: ids.uuidv7(),
              ticket_id: resolved.id,
              revision: ticket.revision,
              requested_by: pending.requested_by,
              requested_at: pending.requested_at,
              decided_by: ctx.actor.userId,
              decided_at: nowIso(),
              decision,
              comment: comment === undefined ? null : comment.trim(),
            })
            .execute();
          spec.activityPayload = {
            ticketId: resolved.id,
            number: ticket.number,
            revision: ticket.revision,
            decision,
          };
          return reviewForRevision(trx, resolved.id, ticket.revision);
        },
      }),

    resolveTicket: (ctx, projectId, ref, expectedVersion, comment) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.resolve",
          projectId,
          activityType: "ticket.resolved",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          await requireVersion(trx, resolved.id, expectedVersion);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be resolved");
          }
          if (ticket.category === "done") {
            throw domainError("INVALID_STATE", "Ticket is already Closed");
          }
          const outcome = validateBody(comment, "Outcome comment");
          const review = await reviewForRevision(trx, resolved.id, ticket.revision);
          if (review.state !== "approved") {
            throw domainError(
              "INVALID_STATE",
              "Resolve requires an approved review of the current revision",
            );
          }
          const done = await deps.projects.doneColumn(projectId, trx);
          if (!done) throw domainError("INVALID_STATE", "Project has no Done column");
          const position = await columnCount(trx, projectId, done.id);
          await trx
            .insertInto("comments")
            .values({
              id: ids.uuidv7(),
              ticket_id: resolved.id,
              author_id: ctx.actor.userId,
              body: outcome,
              created_at: nowIso(),
            })
            .execute();
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              column_id: done.id,
              position,
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            points: row.points,
            columnId: done.id,
          };
          return toTicket(row);
        },
      }),

    reopenTicket: (ctx, projectId, ref, expectedVersion, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.reopen",
          projectId,
          activityType: "ticket.reopened",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          await requireVersion(trx, resolved.id, expectedVersion);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Deleted tickets cannot be reopened");
          }
          if (ticket.category !== "done") {
            throw domainError("INVALID_STATE", "Only Closed tickets can be reopened");
          }
          const destination = await columnById(trx, projectId, input.columnId);
          if (destination.category === "done") {
            throw domainError("INVALID_STATE", "Reopen must leave Done");
          }
          if (input.comment !== undefined && input.comment.trim() !== "") {
            const text = validateBody(input.comment, "Reopen comment");
            await trx
              .insertInto("comments")
              .values({
                id: ids.uuidv7(),
                ticket_id: resolved.id,
                author_id: ctx.actor.userId,
                body: text,
                created_at: nowIso(),
              })
              .execute();
          }
          const position = await columnCount(trx, projectId, destination.id);
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              column_id: destination.id,
              position,
              revision: eb("revision", "+", 1),
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = {
            ticketId: row.id,
            number: row.number,
            fromColumnId: ticket.column_id,
            toColumnId: destination.id,
            toPosition: position,
            toCategory: destination.category,
            newRevision: row.revision,
          };
          return toTicket(row);
        },
      }),

    deleteTicket: (ctx, projectId, ref, expectedVersion) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.delete",
          projectId,
          activityType: "ticket.deleted",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          await requireVersion(trx, resolved.id, expectedVersion);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at !== null) {
            throw domainError("INVALID_STATE", "Ticket is already deleted");
          }
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              deleted_at: nowIso(),
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = { ticketId: row.id, number: row.number };
          return toTicket(row);
        },
      }),

    restoreTicket: (ctx, projectId, ref) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.restore",
          projectId,
          activityType: "ticket.restored",
          targetType: "ticket",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at === null) {
            throw domainError("INVALID_STATE", "Ticket is not deleted");
          }
          await trx
            .updateTable("tickets")
            .set((eb) => ({
              deleted_at: null,
              resource_version: eb("resource_version", "+", 1),
            }))
            .where("id", "=", resolved.id)
            .execute();
          const row = await loadTicketRow(trx, projectId, resolved.id);
          spec.activityPayload = { ticketId: row.id, number: row.number };
          return toTicket(row);
        },
      }),

    purgeTicket: (ctx, projectId, ref) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "ticket.purge",
          projectId,
          activityType: "ticket.purged",
          targetType: "ticket",
        },
        run: async (trx, _spec) => {
          const admin = await trx
            .selectFrom("users")
            .select("is_instance_admin")
            .where("id", "=", ctx.actor.userId)
            .executeTakeFirstOrThrow();
          if (admin.is_instance_admin !== 1 || ctx.actor.keyScope !== "session") {
            throw domainError(
              "FORBIDDEN",
              "Purging tickets requires a session-authenticated Instance Admin",
            );
          }
          const resolved = await resolveRef(trx, projectId, ref);
          const ticket = await loadTicketRow(trx, projectId, resolved.id);
          if (ticket.deleted_at === null) {
            throw domainError(
              "INVALID_STATE",
              "Only a deleted ticket may be permanently purged",
            );
          }
          await trx.deleteFrom("tickets").where("id", "=", resolved.id).execute();
          // Remove activity rows referencing this ticket; comments, links,
          // review records and sprint memberships cascade.
          await trx
            .deleteFrom("activity")
            .where(sql`json_extract(payload_json, '$.ticketId')`, "=", resolved.id)
            .execute();
        },
      }),

    frontier: async (ctx, projectId, opts) => {
      await requireOpenProject(ctx, projectId);
      const limit = Math.min(opts.limit ?? 50, 200);
      let query = ticketBase()
        .where("tickets.project_id", "=", projectId)
        .where("tickets.deleted_at", "is", null)
        .where("tickets.assignee_id", "is", null)
        .where("columns.category", "!=", "done")
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("ticket_links")
                .innerJoin("tickets as b", "b.id", "ticket_links.blocker_id")
                .innerJoin("columns as bc", "bc.id", "b.column_id")
                .whereRef("ticket_links.blocked_id", "=", "tickets.id")
                .where("b.deleted_at", "is", null)
                .where("bc.category", "!=", "done")
                .select("ticket_links.id"),
            ),
          ),
        )
        .orderBy("tickets.number", "asc");
      if (opts.cursor) {
        query = query.where("tickets.number", ">", Number.parseInt(opts.cursor, 10));
      }
      const rows = await query.limit(limit + 1).execute();
      const items = rows.slice(0, limit).map(toSummary);
      return {
        items,
        nextCursor: rows.length > limit ? String(items[items.length - 1]?.number ?? "") : null,
      };
    },

    activity: async (ctx, projectId, opts) => {
      await requireOpenProject(ctx, projectId);
      const limit = Math.min(opts.limit ?? 50, 200);
      let query = db
        .selectFrom("activity")
        .selectAll()
        .where("project_id", "=", projectId)
        .orderBy("seq", "desc");
      if (opts.cursor) {
        query = query.where("seq", "<", Number.parseInt(opts.cursor, 10));
      }
      const rows = await query.limit(limit + 1).execute();
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        seq: r.seq,
        occurredAt: r.occurred_at,
        actorUserId: r.actor_user_id,
        actorDisplayName: r.actor_display_name,
        actorAutomationId: r.actor_automation_id,
        type: r.type,
        targetType: r.target_type,
        targetId: r.target_id,
        // SAFETY: the column stores only literals written by this module.
        // SAFETY: activity payloads are stored as JSON by runCommand.
        payload: JSON.parse(r.payload_json) as Record<string, Json>,
      }));
      return {
        items,
        nextCursor: rows.length > limit ? String(items[items.length - 1]?.seq ?? "") : null,
      };
    },
  };

  return service;
}

