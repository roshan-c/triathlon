"use client";

/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters */

import { TriathlonClient, type ClientOptions } from "@triathlon/client";
import { useCallback, useEffect, useState } from "react";

export type Priority = "low" | "medium" | "high";
type Ref = { name: string };
type Args = Record<string, unknown>;
type ApiResult = any;

export const api = {
  users: { syncProfile: { name: "users.syncProfile" } },
  projects: {
    listMine: { name: "projects.listMine" },
    canCreate: { name: "projects.canCreate" },
    create: { name: "projects.create" },
    members: { name: "projects.members" },
  },
  tickets: {
    board: { name: "tickets.board" },
    get: { name: "tickets.get" },
    dependencies: { name: "tickets.dependencies" },
    create: { name: "tickets.create" },
    update: { name: "tickets.update" },
    move: { name: "tickets.move" },
    comment: { name: "tickets.comment" },
    close: { name: "tickets.close" },
    addBlockedBy: { name: "tickets.addBlockedBy" },
    removeBlockedBy: { name: "tickets.removeBlockedBy" },
    toggleBlocks: { name: "tickets.toggleBlocks" },
    remove: { name: "tickets.remove" },
    attachToSprint: { name: "tickets.attachToSprint" },
    requestReview: { name: "tickets.requestReview" },
    approveReview: { name: "tickets.approveReview" },
    rejectReview: { name: "tickets.rejectReview" },
    activity: { name: "tickets.activity" },
  },
  sprints: {
    list: { name: "sprints.list" },
    create: { name: "sprints.create" },
    activate: { name: "sprints.activate" },
    complete: { name: "sprints.complete" },
  },
  metrics: {
    forSprint: { name: "metrics.forSprint" },
    velocityHistory: { name: "metrics.velocityHistory" },
  },
} as const;

const API_BASE = (process.env.NEXT_PUBLIC_TRIATHLON_URL ?? "http://localhost:8080").replace(/\/$/, "");
const invalidation = new EventTarget();
let client: TriathlonClient | undefined;

function getClient(): TriathlonClient {
  client ??= new TriathlonClient({
    baseUrl: API_BASE,
    clientName: "web",
  });
  return client;
}

function projectId(args: Args): string {
  const value = args.projectId;
  if (typeof value !== "string" || value.length === 0) throw new Error("A projectId is required");
  return value;
}

function projectPath(args: Args, suffix = ""): string {
  return `/api/v1/projects/${encodeURIComponent(projectId(args))}${suffix}`;
}

function timestamp(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : new Date(value).getTime();
}

function legacyProject(access: any): any {
  return {
    projectId: access.project.id,
    name: access.project.name,
    description: undefined,
    role: access.role,
    createdAt: timestamp(access.project.createdAt),
  };
}

function legacyTicket(ticket: any): any {
  const reviewStatus = ticket.reviewState === "unreviewed" ? "none" : ticket.reviewState;
  return {
    ...ticket,
    _id: ticket.id,
    description: ticket.descriptionMd ?? "",
    storyPoints: ticket.points ?? 0,
    createdAt: timestamp(ticket.createdAt),
    updatedAt: timestamp(ticket.createdAt),
    isClosed: ticket.category === "done",
    reviewStatus,
    sprintId: ticket.sprintId ?? null,
  };
}

function legacySprint(sprint: any): any {
  return {
    ...sprint,
    _id: sprint.id,
    status: sprint.state,
    startDate: timestamp(sprint.plannedStart),
    endDate: timestamp(sprint.plannedEnd),
    createdAt: timestamp(sprint.createdAt),
  };
}

function legacyMember(member: any): any {
  return {
    ...member,
    externalId: member.userId,
    name: member.userId,
  };
}

function legacyDetail(detail: any): any {
  return {
    ...detail,
    ticket: legacyTicket({
      ...detail.ticket,
      reviewState: detail.review.state,
    }),
    comments: detail.comments.map((comment: any) => ({
      ...comment,
      _id: comment.id,
      createdAt: timestamp(comment.createdAt),
    })),
    blockedBy: detail.blockers.map((ref: any) => ({
      ...ref,
      _id: ref.id,
      fromTicketId: ref.id,
      toTicketId: detail.ticket.id,
    })),
    blocks: detail.blockedBy.map((ref: any) => ({
      ...ref,
      _id: ref.id,
      fromTicketId: detail.ticket.id,
      toTicketId: ref.id,
    })),
    children: detail.children.map((ref: any) => ({ ...ref, _id: ref.id })),
    parents: detail.parent ? [{ ...detail.parent, _id: detail.parent.id }] : [],
  };
}

function ticketRef(args: Args): string {
  const value = args.ticketId;
  if (typeof value !== "string" || value.length === 0) throw new Error("A ticketId is required");
  return encodeURIComponent(value);
}

async function detailFor(args: Args): Promise<any> {
  return getClient().request(projectPath(args, `/tickets/${ticketRef(args)}`));
}

async function request(ref: Ref, args: Args): Promise<ApiResult> {
  const http = getClient();
  switch (ref.name) {
    case "users.syncProfile":
      return undefined;
    case "projects.listMine":
      return (await http.projects()).map(legacyProject);
    case "projects.canCreate": {
      const capabilities = await http.capabilities() as any;
      const canCreate = Boolean(capabilities.actor?.isInstanceAdmin || capabilities.actor?.isInstanceOwner);
      return { canCreate, reason: canCreate ? undefined : "owner_or_admin_required" };
    }
    case "projects.members":
      return (await http.request(projectPath(args, "/members")) as any[]).map(legacyMember);
    case "projects.create": {
      const project = await http.request("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: args.name, timezone: args.timezone }),
      }) as any;
      return { projectId: project.id, ...project };
    }
    case "tickets.board": {
      const board = await http.board(projectId(args)) as any[];
      return {
        boardId: projectId(args),
        boardName: "Board",
        columns: board.map((entry) => ({
          _id: entry.column.id,
          name: entry.column.name,
          position: entry.column.position,
          tickets: entry.tickets.map(legacyTicket),
        })),
      };
    }
    case "tickets.get":
      return legacyDetail(await detailFor(args));
    case "tickets.dependencies": {
      const board = await http.board(projectId(args)) as any[];
      const tickets = board.flatMap((entry) => entry.tickets.map(legacyTicket));
      const visibleIds = new Set(tickets.map((ticket: any) => ticket.id));
      const details = await Promise.all(
        tickets.map((ticket: any) => http.ticket(projectId(args), ticket.id)),
      ) as any[];
      return {
        tickets,
        links: details.flatMap((detail) => detail.blockers
          .filter((ref: any) => visibleIds.has(ref.id))
          .map((ref: any) => ({
            _id: `${ref.id}:${detail.ticket.id}`,
            fromTicketId: ref.id,
            toTicketId: detail.ticket.id,
          }))),
      };
    }
    case "tickets.activity": {
      const activity = await http.request(projectPath(args, "/activity?limit=200")) as any;
      return activity.items
        .filter((entry: any) => entry.targetId === args.ticketId)
        .map((entry: any) => ({ ...entry, _id: entry.id, createdAt: timestamp(entry.occurredAt) }));
    }
    case "sprints.list":
      return (await http.request(projectPath(args, "/sprints")) as any[]).map(legacySprint);
    case "metrics.forSprint": {
      const metrics = await http.request(projectPath(args, `/sprints/${encodeURIComponent(String(args.sprintId))}/metrics`)) as any;
      const cycleTimes = Object.values(metrics.cycleTimes ?? {}) as number[];
      const leadTimes = Object.values(metrics.leadTimes ?? {}) as number[];
      return {
        ...metrics,
        averageCycleTimeHours: cycleTimes.length ? cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length / 3600 : 0,
        averageLeadTimeHours: leadTimes.length ? leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length / 3600 : 0,
        burndown: (metrics.burndown ?? []).map((entry: any) => ({ day: entry.day, remainingPoints: entry.pointsRemaining })),
        tasksCompletedPerDay: Object.entries(metrics.completedPerDay ?? {}).map(([day, completed]) => ({ day, completed })),
      };
    }
    case "metrics.velocityHistory": {
      const sprints = await http.request(projectPath(args, "/sprints")) as any[];
      return Promise.all(sprints.filter((sprint) => sprint.state === "completed").map(async (sprint) => ({
        sprintName: sprint.name,
        velocity: (await http.request(projectPath(args, `/sprints/${sprint.id}/metrics`)) as any).velocity,
      })));
    }
    case "tickets.create": {
      const created = await http.request(projectPath(args, "/tickets"), {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          title: args.title,
          descriptionMd: args.description,
          points: args.storyPoints,
          priority: args.priority,
          labels: args.labels,
          assigneeId: args.assigneeExternalId || undefined,
          columnId: args.columnId,
        }),
      });
      if (args.sprintId) {
        await http.request(projectPath(args, `/sprints/${encodeURIComponent(String(args.sprintId))}/members`), {
          method: "POST",
          body: JSON.stringify({ ticketIds: [(created as any).id] }),
        });
      }
      return legacyTicket(created);
    }
    case "tickets.update": {
      const current = await detailFor(args);
      const changes: Record<string, unknown> = {
        title: args.title,
        descriptionMd: args.description,
        points: args.storyPoints,
        priority: args.priority,
        labels: args.labels,
        assigneeId: args.assigneeExternalId === "" ? null : args.assigneeExternalId,
        expectedResourceVersion: current.ticket.resourceVersion,
      };
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}`), {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))),
      }));
    }
    case "tickets.move": {
      const current = await detailFor(args);
      const destination = args.toColumnId;
      if (typeof destination !== "string") throw new Error("A destination column is required");
      const board = await http.board(projectId(args)) as any[];
      const target = board.find((entry) => entry.column.id === destination)?.column;
      if (target?.category === "done") {
        const comment = typeof window === "undefined" ? "Resolved from board" : window.prompt("Outcome comment", "Resolved from board");
        if (!comment?.trim()) throw new Error("An outcome comment is required to resolve a ticket");
        return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/resolve`), {
          method: "POST",
          body: JSON.stringify({ comment, expectedResourceVersion: current.ticket.resourceVersion }),
        }));
      }
      if (current.ticket.category === "done") {
        const confirmed = typeof window === "undefined"
          || window.confirm("Reopen this closed ticket and move it out of Done?");
        if (!confirmed) return legacyTicket(current);
        return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/reopen`), {
          method: "POST",
          body: JSON.stringify({
            columnId: destination,
            expectedResourceVersion: current.ticket.resourceVersion,
          }),
        }));
      }
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/move`), {
        method: "POST",
        body: JSON.stringify({ columnId: destination, position: 0, expectedResourceVersion: current.ticket.resourceVersion }),
      }));
    }
    case "tickets.comment":
      return http.request(projectPath(args, `/tickets/${ticketRef(args)}/comments`), {
        method: "POST", body: JSON.stringify({ body: args.body }),
      });
    case "tickets.close": {
      const current = await detailFor(args);
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/resolve`), {
        method: "POST",
        body: JSON.stringify({ comment: args.comment, expectedResourceVersion: current.ticket.resourceVersion }),
      }));
    }
    case "tickets.addBlockedBy": {
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/blockers`), {
        method: "POST", body: JSON.stringify({ ticketIds: [args.blockerId] }),
      }));
    }
    case "tickets.removeBlockedBy":
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}/blockers/${encodeURIComponent(String(args.blockerId))}`), { method: "DELETE" }));
    case "tickets.toggleBlocks": {
      const current = await detailFor({ ...args, ticketId: args.blockedTicketId });
      const blocker = String(args.blockerTicketId);
      const active = current.blockedBy.some((entry: any) => entry.id === blocker);
      const path = active
        ? `/tickets/${encodeURIComponent(String(args.blockedTicketId))}/blockers/${encodeURIComponent(blocker)}`
        : `/tickets/${encodeURIComponent(String(args.blockedTicketId))}/blockers`;
      await http.request(projectPath(args, path), {
        method: active ? "DELETE" : "POST",
        ...(active ? {} : { body: JSON.stringify({ ticketIds: [blocker] }) }),
      });
      return { active: !active };
    }
    case "tickets.remove": {
      const current = await detailFor(args);
      return legacyTicket(await http.request(projectPath(args, `/tickets/${ticketRef(args)}?expectedResourceVersion=${current.ticket.resourceVersion}`), { method: "DELETE" }));
    }
    case "tickets.attachToSprint": {
      const sprintId = args.sprintId;
      if (typeof sprintId === "string" && sprintId.length > 0) {
        return http.request(projectPath(args, `/sprints/${encodeURIComponent(sprintId)}/members`), {
          method: "POST", body: JSON.stringify({ ticketIds: [args.ticketId] }),
        });
      }
      const sprints = await http.request(projectPath(args, "/sprints")) as any[];
      for (const sprint of sprints) {
        const detail = await http.request(projectPath(args, `/sprints/${sprint.id}`)) as any;
        if (detail.members.some((member: any) => member.ticketId === args.ticketId)) {
          return http.request(projectPath(args, `/sprints/${sprint.id}/members/${encodeURIComponent(String(args.ticketId))}`), { method: "DELETE" });
        }
      }
      return undefined;
    }
    case "tickets.requestReview":
      return http.request(projectPath(args, `/tickets/${ticketRef(args)}/review/request`), { method: "POST" });
    case "tickets.approveReview":
      return http.request(projectPath(args, `/tickets/${ticketRef(args)}/review/decide`), { method: "POST", body: JSON.stringify({ decision: "approved" }) });
    case "tickets.rejectReview":
      return http.request(projectPath(args, `/tickets/${ticketRef(args)}/review/decide`), { method: "POST", body: JSON.stringify({ decision: "rejected", comment: "Rejected from the web UI" }) });
    case "sprints.create":
      return legacySprint(await http.request(projectPath(args, "/sprints"), {
        method: "POST", body: JSON.stringify({ name: args.name, plannedStart: new Date(Number(args.startDate)).toISOString(), plannedEnd: new Date(Number(args.endDate)).toISOString() }),
      }));
    case "sprints.activate":
      return legacySprint(await http.request(projectPath(args, `/sprints/${encodeURIComponent(String(args.sprintId))}/activate`), { method: "POST" }));
    case "sprints.complete":
      return legacySprint(await http.request(projectPath(args, `/sprints/${encodeURIComponent(String(args.sprintId))}/complete`), { method: "POST" }));
    default:
      throw new Error(`Unsupported API operation: ${ref.name}`);
  }
}

export function useQuery(ref: Ref, args: Args | "skip"): ApiResult | undefined {
  const [value, setValue] = useState<ApiResult>();
  const [revision, setRevision] = useState(0);
  const serializedArgs = args === "skip" ? "skip" : JSON.stringify(args);

  useEffect(() => {
    if (args === "skip") {
      setValue(undefined);
      return;
    }
    let cancelled = false;
    void request(ref, args).then((result) => {
      if (!cancelled) setValue(result);
    }).catch((error: unknown) => {
      if (!cancelled) console.error(error);
    });
    return () => { cancelled = true; };
  }, [ref, serializedArgs, revision]);

  useEffect(() => {
    const listener = () => setRevision((current) => current + 1);
    invalidation.addEventListener("changed", listener);
    return () => invalidation.removeEventListener("changed", listener);
  }, []);

  return value;
}

export function useMutation(ref: Ref): (args: Args) => Promise<ApiResult> {
  return useCallback(async (args: Args) => {
    const result = await request(ref, args);
    invalidation.dispatchEvent(new Event("changed"));
    return result;
  }, [ref]);
}

export function useProjectEvents(projectId: string | undefined): void {
  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;
    const source = new EventSource(`${API_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/events`, { withCredentials: true });
    // The API names SSE events (`event: ticket.updated`) so EventSource's
    // default `message` handler is not invoked. Keep this list in the adapter
    // so the UI refreshes for every current activity type while remaining
    // forward-compatible with unknown events through replay on reconnect.
    const eventTypes = [
      "blocker.added", "blocker.removed", "column.added", "column.deleted",
      "column.recategorized", "column.renamed", "columns.reordered", "comment.added",
      "invitation.created", "invitation.revoked", "membership.added", "membership.removed",
      "project.created", "project.deleted", "project.ownership_recovered",
      "project.ownership_transferred", "project.renamed", "project.restored",
      "project.timezone_changed", "review.decided", "review.requested", "sprint.activated",
      "sprint.completed", "sprint.created", "sprint.deleted", "sprint.member.added",
      "sprint.member.removed", "ticket.created", "ticket.deleted", "ticket.moved",
      "ticket.purged", "ticket.reopened", "ticket.resolved", "ticket.restored", "ticket.updated",
    ];
    const invalidate = () => invalidation.dispatchEvent(new Event("changed"));
    for (const eventType of eventTypes) source.addEventListener(eventType, invalidate);
    // Leave the native EventSource open on errors: it reconnects with the
    // browser-managed Last-Event-ID header so the server can replay missed
    // project events.
    return () => {
      for (const eventType of eventTypes) source.removeEventListener(eventType, invalidate);
      source.close();
    };
  }, [projectId]);
}

export function createClient(options: ClientOptions): TriathlonClient {
  return new TriathlonClient(options);
}
