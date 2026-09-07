/**
 * Planning module.
 *
 * Owns: sprint lifecycle (planned -> active -> completed only), current and
 * historical sprint membership, provisional metric calculation from the
 * Activity log, and immutable completion snapshots.
 *
 * Metrics are reconstructed from Activity so scope and estimate changes stay
 * visible; completing a sprint freezes membership and metrics, and later
 * ticket edits never rewrite that history.
 */

import { sql } from "kysely";
import { Value } from "@sinclair/typebox/value";
import { Type } from "@sinclair/typebox";
import type { Kysely } from "kysely";
import type { Database as DbSchema } from "../db/types.js";
import type { SprintState } from "../db/types.js";
import type { Db } from "../db/types.js";
import { domainError } from "../errors.js";
import type { Clock } from "../time.js";
import { dayKeyInTz, dayStartInTz, nextLocalDayBoundary } from "../time.js";
import type { Ids } from "../ids.js";
import type { Json, RequestContext } from "./context.js";

/** JSON-parsed payload members; JsonValue is their representation. */
type JsonValue = Exclude<Json, null>;
import { requireOpenProject as requireOpenProjectSeam } from "./projects.js";
import type { ProjectsSeam } from "./projects.js";
import type { WorkSeam } from "./work.js";
import { runCommand } from "./tx.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  state: SprintState;
  activatedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SprintMember {
  ticketId: string;
  addedAt: string;
  addedBy: string;
  removedAt: string | null;
}

export interface SprintDetail {
  sprint: Sprint;
  members: SprintMember[];
}

export interface SprintMetrics {
  state: "active" | "completed";
  asOf: string;
  intervalStart: string;
  intervalEnd: string;
  velocity: number;
  throughput: number;
  completedPerDay: Record<string, number>;
  burndown: Array<{ day: string; pointsRemaining: number }>;
  /** ticketId -> seconds from creation to qualifying close. */
  leadTimes: Record<string, number>;
  /** ticketId -> seconds from last not_started->started to close. */
  cycleTimes: Record<string, number>;
}

export interface AddTicketsInput {
  ticketIds: string[];
}

export interface PlanningService {
  createSprint(
    ctx: RequestContext,
    projectId: string,
    input: { name: string; plannedStart?: string; plannedEnd?: string },
  ): Promise<Sprint>;
  listSprints(ctx: RequestContext, projectId: string): Promise<Sprint[]>;
  getSprintDetail(ctx: RequestContext, projectId: string, sprintId: string): Promise<SprintDetail>;
  activateSprint(ctx: RequestContext, projectId: string, sprintId: string): Promise<Sprint>;
  completeSprint(ctx: RequestContext, projectId: string, sprintId: string): Promise<Sprint>;
  deleteSprint(ctx: RequestContext, projectId: string, sprintId: string): Promise<void>;
  addTickets(ctx: RequestContext, projectId: string, sprintId: string, input: AddTicketsInput): Promise<SprintDetail>;
  removeTicket(ctx: RequestContext, projectId: string, sprintId: string, ticketId: string): Promise<SprintDetail>;
  metrics(ctx: RequestContext, projectId: string, sprintId: string): Promise<SprintMetrics>;
  /** The frozen completion payload; only for completed sprints. */
  snapshot(ctx: RequestContext, projectId: string, sprintId: string): Promise<Json>;
}

export interface PlanningDeps {
  db: Db;
  clock: Clock;
  ids: Ids;
  projects: ProjectsSeam;
  work: WorkSeam;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const PAYLOAD_STRING = Type.String();
const PAYLOAD_NUMBER = Type.Number();

function stringOf(value: JsonValue | undefined): string | null {
  if (value === undefined) return null;
  if (!Value.Check(PAYLOAD_STRING, value)) return null;
  // SAFETY: Value.Check(PAYLOAD_STRING) guarantees a string.
  return value as string;
}

function numberOf(value: JsonValue | undefined): number | null {
  if (!Value.Check(PAYLOAD_NUMBER, value) || !Number.isFinite(value)) return null;
  // SAFETY: Value.Check(PAYLOAD_NUMBER) guarantees a finite JSON number.
  return value as number;
}

function typeofPayloadPoints(value: JsonValue | undefined): number {
  return numberOf(value) ?? 0;
}

function parseFiniteNumber(value: JsonValue | undefined): number | null {
  return numberOf(value);
}

/** Minimal contract for parsed activity payloads, validated per member. */
interface ActivityPayload {
  sprintId?: JsonValue;
  ticketId?: JsonValue;
  points?: JsonValue;
  tickets?: JsonValue;
  changes?: { points?: { before?: JsonValue; after?: JsonValue } };
  fromCategory?: JsonValue;
  toCategory?: JsonValue;
  columnCategory?: JsonValue;
}



interface ActivityRow {
  id: string;
  seq: number;
  occurred_at: string;
  type: string;
  payload_json: string;
}

export function createPlanningService(deps: PlanningDeps): PlanningService {
  const { db, clock, ids } = deps;
  const nowIso = (): string => clock.now().toISOString();

  const requireOpenProject = (
    ctx: RequestContext,
    projectId: string,
    trx?: Kysely<DbSchema>,
  ): Promise<void> => requireOpenProjectSeam(deps.projects, ctx, projectId, trx);

  async function loadSprint(
    trx: Kysely<DbSchema>,
    projectId: string,
    sprintId: string,
  ): Promise<Sprint> {
    const row = await trx
      .selectFrom("sprints")
      .selectAll()
      .where("id", "=", sprintId)
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (!row || row.deleted_at !== null) {
      throw domainError("NOT_FOUND", "Sprint not found");
    }
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      // SAFETY: sprints.state is written only with SprintState literals.
      state: row.state as SprintState,
      activatedAt: row.activated_at,
      completedAt: row.completed_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  async function loadMembers(
    trx: Kysely<DbSchema>,
    sprintId: string,
  ): Promise<SprintMember[]> {
    const rows = await trx
      .selectFrom("sprint_members")
      .selectAll()
      .where("sprint_id", "=", sprintId)
      .orderBy("added_at")
      .execute();
    return rows.map((r) => ({
      ticketId: r.ticket_id,
      addedAt: r.added_at,
      addedBy: r.added_by,
      removedAt: r.removed_at,
    }));
  }

  async function validateTicketIds(
    trx: Kysely<DbSchema>,
    projectId: string,
    ticketIds: string[],
  ): Promise<void> {
    const unique = [...new Set(ticketIds)];
    for (const ticketId of unique) {
      const row = await trx
        .selectFrom("tickets")
        .select("id")
        .where("project_id", "=", projectId)
        .where("id", "=", ticketId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (!row) {
        throw domainError("VALIDATION_FAILED", "Ticket must exist and not be deleted");
      }
    }
  }

  /** Tickets already in a planned or active sprint of this project. */
  async function occupiedTicketIds(
    trx: Kysely<DbSchema>,
    projectId: string,
  ): Promise<Set<string>> {
    const rows = await trx
      .selectFrom("sprint_members")
      .innerJoin("sprints", "sprints.id", "sprint_members.sprint_id")
      .select("sprint_members.ticket_id")
      .where("sprints.project_id", "=", projectId)
      .where("sprints.state", "in", ["planned", "active"])
      .where("sprint_members.removed_at", "is", null)
      .where("sprints.deleted_at", "is", null)
      .execute();
    return new Set(rows.map((r) => r.ticket_id));
  }

  async function projectEvents(
    projectId: string,
    start: string,
    end: string,
    trx?: Kysely<DbSchema>,
  ): Promise<ActivityRow[]> {
    const rows = await (trx ?? db)
      .selectFrom("activity")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("occurred_at", ">=", start)
      .where("occurred_at", "<=", end)
      .orderBy("occurred_at")
      .orderBy("seq")
      .execute();
    return rows;
  }

  interface QualifyingClose {
    ticketId: string;
    at: string;
    points: number;
  }

  /**
   * Resolve events in the interval whose ticket belonged to the sprint at the
   * close and whose latest close is still effective at `end` (no reopen after
   * it). Points are valued at `end` (completion-time points).
   */
  async function qualifyingCloses(
    projectId: string,
    sprintId: string,
    start: string,
    end: string,
    trx?: Kysely<DbSchema>,
  ): Promise<QualifyingClose[]> {
    const events = await projectEvents(projectId, start, end, trx);
    const resolved: Array<{ at: string; ticketId: string }> = [];
    const reopenedAt = new Map<string, string>();
    for (const e of events) {
      // SAFETY: activity payloads are stored as JSON by runCommand; the
      // ticketId member is validated before use.
      const payload = JSON.parse(e.payload_json) as ActivityPayload;
      const evTicketId = stringOf(payload.ticketId);
      if (e.type === "ticket.resolved" && evTicketId !== null) {
        resolved.push({ at: e.occurred_at, ticketId: evTicketId });
      } else if (e.type === "ticket.reopened" && evTicketId !== null) {
        reopenedAt.set(evTicketId, e.occurred_at);
      }
    }
    // Latest close per ticket.
    const latest = new Map<string, string>();
    for (const r of resolved) {
      latest.set(r.ticketId, r.at);
    }
    const members = await (trx ?? db)
      .selectFrom("sprint_members")
      .selectAll()
      .where("sprint_id", "=", sprintId)
      .execute();
    const qualifies: QualifyingClose[] = [];
    for (const m of members) {
      const closeAt = latest.get(m.ticket_id);
      if (!closeAt) continue;
      // Belonged at close, and removal (if any) happened after the close.
      if (m.added_at > closeAt) continue;
      if (m.removed_at !== null && m.removed_at <= closeAt) continue;
      // The approved revision must remain Closed at `end`: no reopen after
      // the close, and the ticket must currently be in the Done column.
      const reopen = reopenedAt.get(m.ticket_id);
      if (reopen !== undefined && reopen > closeAt) continue;
      const core = await deps.work.ticketCore(projectId, m.ticket_id, trx);
      if (!core || core.category !== "done") continue;
      qualifies.push({
        ticketId: m.ticket_id,
        at: closeAt,
        points: core.points ?? 0,
      });
    }
    return qualifies;
  }

  /** Last not_started -> started transition before `before`, if any. */
  async function lastStartedTransition(
    projectId: string,
    ticketId: string,
    before: string,
    trx?: Kysely<DbSchema>,
  ): Promise<string | null> {
    // The transition predicate lives in SQL so the single result is the
    // most recent actual not_started -> started transition for the ticket —
    // no arbitrary event cap can hide it, and started->started moves are
    // never mistaken for transitions.
    const moveTransition = sql<boolean>`(type = 'ticket.moved'
      AND json_extract(payload_json, '$.fromCategory') = 'not_started'
      AND json_extract(payload_json, '$.toCategory') = 'started')`;
    const createStarted = sql<boolean>`(type = 'ticket.created'
      AND json_extract(payload_json, '$.columnCategory') = 'started')`;
    const row = await (trx ?? db)
      .selectFrom("activity")
      .select("occurred_at")
      .where("project_id", "=", projectId)
      .where("occurred_at", "<=", before)
      .where(sql`json_extract(payload_json, '$.ticketId')`, "=", ticketId)
      .where((eb) => eb.or([moveTransition, createStarted]))
      .orderBy("occurred_at", "desc")
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    return row?.occurred_at ?? null;
  }

  /**
   * Burndown reconstruction: project-local end-of-day remaining points.
   *
   * The simulation applies sprint-scope and estimate events in timeline
   * order, tracking each ticket's current contribution so a closed ticket is
   * not double-counted when it is later removed from the sprint.
   */
  async function burndown(
    projectId: string,
    sprintId: string,
    start: string,
    end: string,
    tz: string,
    trx?: Kysely<DbSchema>,
  ): Promise<Array<{ day: string; pointsRemaining: number }>> {
    const events = await projectEvents(projectId, start, end, trx);

    interface TicketState {
      inSprint: boolean;
      contribution: number;
    }
    const state = new Map<string, TicketState>();
    let running = 0;

    interface SimEvent {
      at: string;
      ticketId: string;
      kind: "added" | "removed" | "resolved" | "reopened" | "updated";
      points?: number;
      delta?: number;
    }
    const sim: SimEvent[] = [];
    for (const e of events) {
      // SAFETY: activity payloads are stored as JSON objects by runCommand;
      // every member read below is validated on the parsed value.
      const payload = JSON.parse(e.payload_json) as ActivityPayload;
      if (e.type === "sprint.member.added" && stringOf(payload.sprintId) === sprintId) {
        // Payload is a grouped { tickets: [...] } batch.
        const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
        for (const t of tickets) {
          // SAFETY: ticketIdOf/pointsOf validate the member shape at this boundary.
          const member = t as { ticketId?: JsonValue; points?: JsonValue };
          const ticketId = stringOf(member.ticketId);
          if (ticketId !== null) {
            sim.push({
              at: e.occurred_at,
              ticketId,
              kind: "added",
              points: typeofPayloadPoints(member.points),
            });
          }
        }
        continue;
      }
      const ticketId = stringOf(payload.ticketId);
      if (ticketId === null) continue;
      if (e.type === "sprint.member.removed" && stringOf(payload.sprintId) === sprintId) {
        sim.push({ at: e.occurred_at, ticketId, kind: "removed" });
      } else if (e.type === "ticket.resolved") {
        sim.push({
          at: e.occurred_at,
          ticketId,
          kind: "resolved",
          points: typeofPayloadPoints(payload.points),
        });
      } else if (e.type === "ticket.reopened") {
        sim.push({
          at: e.occurred_at,
          ticketId,
          kind: "reopened",
          points: typeofPayloadPoints(payload.points),
        });
      } else if (e.type === "ticket.updated") {
        // SAFETY: activity payloads are JSON; the member shape is validated
        // below before any field is used.
        const changes = payload.changes as { points?: { before?: number; after?: number } } | undefined;
        const p = changes?.points;
        const before = parseFiniteNumber(p?.before);
        const after = parseFiniteNumber(p?.after);
        if (before !== null && after !== null) {
          sim.push({
            at: e.occurred_at,
            ticketId,
            kind: "updated",
            delta: after - before,
          });
        }
      }
    }
    sim.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const apply = (e: SimEvent): void => {
      let st = state.get(e.ticketId);
      if (!st) {
        st = { inSprint: false, contribution: 0 };
        state.set(e.ticketId, st);
      }
      if (e.kind === "added") {
        st.inSprint = true;
        st.contribution = e.points ?? 0;
        running += st.contribution;
      } else if (e.kind === "removed") {
        st.inSprint = false;
        running -= st.contribution;
        st.contribution = 0;
      } else if (e.kind === "resolved") {
        running -= st.contribution;
        st.contribution = 0;
      } else if (e.kind === "reopened") {
        st.contribution = e.points ?? 0;
        running += st.contribution;
      } else if (e.kind === "updated") {
        if (st.inSprint) {
          running += e.delta ?? 0;
          st.contribution += e.delta ?? 0;
        }
      }
    };

    // Local-calendar days from the day containing `start` through the day
    // containing `end`; the running total is snapshotted at each local
    // midnight (or at `end` for the final, partial day).
    const out: Array<{ day: string; pointsRemaining: number }> = [];
    const endDate = new Date(end);
    let eventIndex = 0;
    let guard = 0;
    let cursor = dayStartInTz(new Date(start), tz);
    while (cursor <= endDate && guard < 2000) {
      const day = dayKeyInTz(cursor, tz);
      const dayEnd = nextLocalDayBoundary(cursor, tz);
      const effective = dayEnd > endDate ? endDate : dayEnd;
      while (eventIndex < sim.length) {
        const e = sim[eventIndex];
        if (e && e.at <= effective.toISOString()) {
          apply(e);
          eventIndex++;
        } else {
          break;
        }
      }
      out.push({ day, pointsRemaining: running });
      cursor = nextLocalDayBoundary(cursor, tz);
      guard++;
    }
    return out;
  }

  function secondsBetween(a: string, b: string): number {
    return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
  }

  async function computeMetrics(
    projectId: string,
    sprint: Sprint,
    trx?: Kysely<DbSchema>,
  ): Promise<SprintMetrics> {
    const start = sprint.activatedAt ?? "";
    const end = sprint.completedAt ?? nowIso();
    const tz = (await deps.projects.timezoneFor(projectId, trx)) ?? "UTC";
    const closes = await qualifyingCloses(projectId, sprint.id, start, end, trx);
    const velocity = closes.reduce((acc, c) => acc + c.points, 0);
    const throughput = closes.length;
    const completedPerDay: Record<string, number> = {};
    const leadTimes: Record<string, number> = {};
    const cycleTimes: Record<string, number> = {};
    for (const c of closes) {
      const day = dayKeyInTz(new Date(c.at), tz);
      completedPerDay[day] = (completedPerDay[day] ?? 0) + 1;
      const core = await deps.work.ticketCore(projectId, c.ticketId, trx);
      if (core) {
        leadTimes[c.ticketId] = secondsBetween(core.createdAt, c.at);
      }
      const started = await lastStartedTransition(projectId, c.ticketId, c.at, trx);
      if (started) {
        cycleTimes[c.ticketId] = secondsBetween(started, c.at);
      }
    }
    const burndownResult = await burndown(projectId, sprint.id, start, end, tz, trx);
    return {
      state: sprint.completedAt !== null ? "completed" : "active",
      asOf: end,
      intervalStart: start,
      intervalEnd: end,
      velocity,
      throughput,
      completedPerDay,
      burndown: burndownResult,
      leadTimes,
      cycleTimes,
    };
  }

  const service: PlanningService = {
    createSprint: (ctx, projectId, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.create",
          projectId,
          activityType: "sprint.created",
          targetType: "sprint",
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const name = input.name.trim();
          if (name.length === 0 || name.length > 100) {
            throw domainError(
              "VALIDATION_FAILED",
              "Sprint name must be between 1 and 100 characters",
            );
          }
          const sprintId = ids.uuidv7();
          await trx
            .insertInto("sprints")
            .values({
              id: sprintId,
              project_id: projectId,
              name,
              planned_start: input.plannedStart ?? null,
              planned_end: input.plannedEnd ?? null,
              state: "planned",
              activated_at: null,
              completed_at: null,
              created_by: ctx.actor.userId,
              created_at: nowIso(),
              deleted_at: null,
            })
            .execute();
          const sprint = await loadSprint(trx, projectId, sprintId);
          spec.activityPayload = { sprintId, projectId, name };
          return sprint;
        },
      }),

    listSprints: async (ctx, projectId) => {
      await requireOpenProject(ctx, projectId);
      const rows = await db
        .selectFrom("sprints")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("deleted_at", "is", null)
        .orderBy("created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        plannedStart: r.planned_start,
        plannedEnd: r.planned_end,
        // SAFETY: sprints.state is written only with SprintState literals.
        state: r.state as SprintState,
        activatedAt: r.activated_at,
        completedAt: r.completed_at,
        createdBy: r.created_by,
        createdAt: r.created_at,
      }));
    },

    getSprintDetail: async (ctx, projectId, sprintId) => {
      await requireOpenProject(ctx, projectId);
      const sprint = await loadSprint(db, projectId, sprintId);
      const members = await loadMembers(db, sprintId);
      return { sprint, members };
    },

    activateSprint: (ctx, projectId, sprintId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.activate",
          projectId,
          activityType: "sprint.activated",
          targetType: "sprint",
          targetId: sprintId,
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const sprint = await loadSprint(trx, projectId, sprintId);
          if (sprint.state !== "planned") {
            throw domainError(
              "INVALID_STATE",
              `Only planned sprints can be activated (current state: ${sprint.state})`,
            );
          }
          const active = await trx
            .selectFrom("sprints")
            .select("id")
            .where("project_id", "=", projectId)
            .where("state", "=", "active")
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          if (active) {
            throw domainError(
              "ACTIVE_SPRINT_EXISTS",
              "This project already has an active sprint",
            );
          }
          const activatedAt = nowIso();
          await trx
            .updateTable("sprints")
            .set({ state: "active", activated_at: activatedAt })
            .where("id", "=", sprintId)
            .execute();
          const updated = await loadSprint(trx, projectId, sprintId);
          spec.activityPayload = { sprintId, projectId, activatedAt };
          return updated;
        },
      }),

    completeSprint: (ctx, projectId, sprintId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.complete",
          projectId,
          activityType: "sprint.completed",
          targetType: "sprint",
          targetId: sprintId,
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const sprint = await loadSprint(trx, projectId, sprintId);
          if (sprint.state !== "active") {
            throw domainError(
              "INVALID_STATE",
              `Only active sprints can be completed (current state: ${sprint.state})`,
            );
          }
          const completedAt = nowIso();
          const finalSprint: Sprint = { ...sprint, state: "completed", completedAt };
          const metrics = await computeMetrics(projectId, finalSprint, trx);
          const members = await loadMembers(trx, sprintId);
          const memberPayload: Json[] = [];
          // Unfinished tickets lose their current sprint assignment; Closed
          // qualifying tickets keep their membership row as history.
          for (const m of members) {
            const core = await deps.work.ticketCore(projectId, m.ticketId, trx);
            const stillOpen = !core || core.category !== "done";
            if (m.removedAt === null && stillOpen) {
              await trx
                .updateTable("sprint_members")
                .set({ removed_at: completedAt, removed_by: null })
                .where("sprint_id", "=", sprintId)
                .where("ticket_id", "=", m.ticketId)
                .where("removed_at", "is", null)
                .execute();
            }
            memberPayload.push({
              ticketId: m.ticketId,
              number: core?.number ?? null,
              title: core?.title ?? null,
              points: core?.points ?? null,
              addedAt: m.addedAt,
              removedAt: m.removedAt,
            });
          }
          await trx
            .updateTable("sprints")
            .set({ state: "completed", completed_at: completedAt })
            .where("id", "=", sprintId)
            .execute();
          await trx
            .insertInto("sprint_snapshots")
            .values({
              sprint_id: sprintId,
              created_at: completedAt,
              payload_json: JSON.stringify({
                sprint: finalSprint,
                members: memberPayload,
                metrics,
              }),
            })
            .execute();
          spec.activityPayload = { sprintId, projectId, completedAt };
          return { ...sprint, state: "completed", completedAt };
        },
      }),

    deleteSprint: (ctx, projectId, sprintId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.delete",
          projectId,
          activityType: "sprint.deleted",
          targetType: "sprint",
          targetId: sprintId,
        },
        run: async (trx) => {
          await requireOpenProject(ctx, projectId, trx);
          const sprint = await loadSprint(trx, projectId, sprintId);
          if (sprint.state !== "planned") {
            throw domainError(
              "INVALID_STATE",
              "Only planned sprints may be deleted; completed sprints and snapshots are immutable",
            );
          }
          await trx
            .updateTable("sprints")
            .set({ deleted_at: nowIso() })
            .where("id", "=", sprintId)
            .execute();
        },
      }),

    addTickets: (ctx, projectId, sprintId, input) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.members_add",
          projectId,
          activityType: "sprint.member.added",
          targetType: "sprint",
          targetId: sprintId,
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const sprint = await loadSprint(trx, projectId, sprintId);
          if (sprint.state === "completed") {
            throw domainError("SPRINT_COMPLETED", "Completed sprints are immutable");
          }
          await validateTicketIds(trx, projectId, input.ticketIds);
          const occupied = await occupiedTicketIds(trx, projectId);
          const unique = [...new Set(input.ticketIds)];
          const already = new Set(
            (await loadMembers(trx, sprintId))
              .filter((m) => m.removedAt === null)
              .map((m) => m.ticketId),
          );
          const addable = unique.filter((id) => !already.has(id));
          if (addable.length === 0) {
            spec.activityType = undefined;
            const members = await loadMembers(trx, sprintId);
            return { sprint: await loadSprint(trx, projectId, sprintId), members };
          }
          const blocked = addable.filter((id) => occupied.has(id));
          if (blocked.length > 0) {
            throw domainError(
              "INVALID_STATE",
              "A ticket belongs to at most one planned or active sprint",
            );
          }
          const addedAt = nowIso();
          const addedTickets: Json[] = [];
          for (const ticketId of addable) {
            const core = await deps.work.ticketCore(projectId, ticketId, trx);
            await trx
              .insertInto("sprint_members")
              .values({
                id: ids.uuidv7(),
                sprint_id: sprintId,
                ticket_id: ticketId,
                added_at: addedAt,
                added_by: ctx.actor.userId,
                removed_at: null,
                removed_by: null,
              })
              .execute();
            addedTickets.push({
              ticketId,
              number: core?.number ?? null,
              title: core?.title ?? null,
              points: core?.points ?? null,
            });
          }
          spec.activityPayload = { sprintId, tickets: addedTickets };
          const members = await loadMembers(trx, sprintId);
          return { sprint: await loadSprint(trx, projectId, sprintId), members };
        },
      }),

    removeTicket: (ctx, projectId, sprintId, ticketId) =>
      runCommand({
        db,
        ctx,
        clock,
        ids,
        spec: {
          operation: "sprint.member_remove",
          projectId,
          activityType: "sprint.member.removed",
          targetType: "sprint",
          targetId: sprintId,
        },
        run: async (trx, spec) => {
          await requireOpenProject(ctx, projectId, trx);
          const sprint = await loadSprint(trx, projectId, sprintId);
          if (sprint.state === "completed") {
            throw domainError("SPRINT_COMPLETED", "Completed sprints are immutable");
          }
          const row = await trx
            .selectFrom("sprint_members")
            .selectAll()
            .where("sprint_id", "=", sprintId)
            .where("ticket_id", "=", ticketId)
            .where("removed_at", "is", null)
            .executeTakeFirst();
          if (!row) throw domainError("NOT_FOUND", "Ticket is not a sprint member");
          const core = await deps.work.ticketCore(projectId, ticketId, trx);
          await trx
            .updateTable("sprint_members")
            .set({ removed_at: nowIso(), removed_by: ctx.actor.userId })
            .where("id", "=", row.id)
            .execute();
          spec.activityPayload = {
            sprintId,
            ticketId,
            number: core?.number ?? null,
            points: core?.points ?? null,
          };
          const members = await loadMembers(trx, sprintId);
          return { sprint: await loadSprint(trx, projectId, sprintId), members };
        },
      }),

    metrics: async (ctx, projectId, sprintId) => {
      await requireOpenProject(ctx, projectId);
      const sprint = await loadSprint(db, projectId, sprintId);
      if (sprint.state === "planned") {
        throw domainError("INVALID_STATE", "Metrics exist only for active or completed sprints");
      }
      if (sprint.state === "completed") {
        const snap = await db
          .selectFrom("sprint_snapshots")
          .select("payload_json")
          .where("sprint_id", "=", sprintId)
          .executeTakeFirst();
        if (!snap) throw domainError("NOT_FOUND", "Sprint snapshot not found");
        // SAFETY: the snapshot payload is stored by completeSprint with a
        // `metrics` member or the schema has drifted.
        const payload = JSON.parse(snap.payload_json) as { metrics?: SprintMetrics };
        if (!payload.metrics) throw domainError("INVALID_STATE", "Snapshot has no metrics");
        return payload.metrics;
      }
      return computeMetrics(projectId, sprint);
    },

    snapshot: async (ctx, projectId, sprintId) => {
      await requireOpenProject(ctx, projectId);
      const sprint = await loadSprint(db, projectId, sprintId);
      if (sprint.state !== "completed") {
        throw domainError(
          "INVALID_STATE",
          "Snapshots exist only for completed sprints",
        );
      }
      const snap = await db
        .selectFrom("sprint_snapshots")
        .select("payload_json")
        .where("sprint_id", "=", sprintId)
        .executeTakeFirst();
      if (!snap) throw domainError("NOT_FOUND", "Sprint snapshot not found");
      // SAFETY: the payload is stored by completeSprint as a JSON object.
      return JSON.parse(snap.payload_json) as Json;
    },
  };

  return service;
}