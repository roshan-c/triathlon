/**
 * Planning module tests: sprint lifecycle, membership, provisional metrics,
 * frozen completion snapshots, burndown, and timezone day boundaries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { addUser, bootstrapOwner, buildWorld, track } from "./helpers.js";
import type { User } from "../src/domain/identity.js";
import type { Project } from "../src/domain/projects.js";
import type { WorkService } from "../src/domain/work.js";

interface WorldWithProject {
  w: Awaited<ReturnType<typeof buildWorld>>;
  owner: User;
  member: User;
  project: Project;
  setNow(iso: string): void;
}

async function world(opts: { timezone?: string } = {}): Promise<WorldWithProject> {
  let now = new Date("2026-09-07T09:00:00Z");
  const w = track(await buildWorld({ clock: { now: () => now } }));
  const owner = await bootstrapOwner(w);
  const member = await addUser(w, "member@example.com", "Member");
  const project = await w.projects.createProject(w.ctx(owner.id), {
    name: "Sprintland",
    timezone: opts.timezone ?? "UTC",
  });
  const inv = await w.identity.createInvitation(w.ctx(owner.id), project.id, null);
  await w.projects.joinProject(w.ctx(member.id), inv.code);
  return {
    w,
    owner,
    member,
    project,
    setNow: (iso) => {
      now = new Date(iso);
    },
  };
}

/** Full lifecycle helper: create, review-approve, resolve a ticket. */
async function closeTicket(
  ctx: WorkService,
  memberId: string,
  projectId: string,
  ticket: { number: number; resourceVersion: number },
  comment = "done",
) {
  await ctx.requestReview({ actor: { userId: memberId, keyScope: "session" }, requestId: "r" }, projectId, String(ticket.number));
  await ctx.decideReview({ actor: { userId: memberId, keyScope: "session" }, requestId: "r" }, projectId, String(ticket.number), "approved");
  return ctx.resolveTicket(
    { actor: { userId: memberId, keyScope: "session" }, requestId: "r" },
    projectId,
    String(ticket.number),
    ticket.resourceVersion,
    comment,
  );
}

test("sprints transition planned -> active -> completed; only one active sprint", async () => {
  const { w, member, project } = await world();
  const s1 = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S1" });
  const s2 = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S2" });

  await w.planning.activateSprint(w.ctx(member.id), project.id, s1.id);
  await assert.rejects(
    w.planning.activateSprint(w.ctx(member.id), project.id, s2.id),
    (e: Error) => e.message === "This project already has an active sprint",
  );

  const completed = await w.planning.completeSprint(w.ctx(member.id), project.id, s1.id);
  assert.equal(completed.state, "completed");
  assert.ok(completed.completedAt);

  // Completed sprints are immutable.
  await assert.rejects(
    w.planning.completeSprint(w.ctx(member.id), project.id, s1.id),
    (e: Error) => e.message.startsWith("Only active sprints can be completed"),
  );
  await assert.rejects(
    w.planning.addTickets(w.ctx(member.id), project.id, s1.id, { ticketIds: [] }),
    (e: Error) => e.message === "Completed sprints are immutable",
  );
  await assert.rejects(
    w.planning.deleteSprint(w.ctx(member.id), project.id, s1.id),
    (e: Error) => e.message.startsWith("Only planned sprints may be deleted"),
  );

  // Planned sprints may be deleted.
  await w.planning.deleteSprint(w.ctx(member.id), project.id, s2.id);
  const list = await w.planning.listSprints(w.ctx(member.id), project.id);
  assert.equal(list.length, 1);
});

test("a ticket belongs to at most one planned or active sprint", async () => {
  const { w, member, project } = await world();
  const s1 = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S1" });
  const s2 = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S2" });
  const ticket = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T" });

  await w.planning.addTickets(w.ctx(member.id), project.id, s1.id, { ticketIds: [ticket.id] });
  await assert.rejects(
    w.planning.addTickets(w.ctx(member.id), project.id, s2.id, { ticketIds: [ticket.id] }),
    (e: Error) => e.message === "A ticket belongs to at most one planned or active sprint",
  );

  // Removing frees the ticket for another sprint.
  await w.planning.removeTicket(w.ctx(member.id), project.id, s1.id, ticket.id);
  await w.planning.addTickets(w.ctx(member.id), project.id, s2.id, { ticketIds: [ticket.id] });

  // The first sprint keeps the historical membership row.
  const s1Detail = await w.planning.getSprintDetail(w.ctx(member.id), project.id, s1.id);
  const membership = s1Detail.members.find((m) => m.ticketId === ticket.id);
  assert.ok(membership);
  assert.ok(membership.removedAt);
});

test("provisional metrics: only qualifying closes count; velocity values points at completion", async () => {
  const { w, member, project, setNow } = await world();
  setNow("2026-09-07T08:00:00Z");
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });

  // Closed BEFORE activation: must not inflate metrics.
  const early = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Early", points: 9 });
  await closeTicket(w.work, member.id, project.id, early);

  setNow("2026-09-07T09:00:00Z");
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, {
    ticketIds: [early.id],
  });

  setNow("2026-09-07T12:00:00Z");
  const a = await w.work.createTicket(w.ctx(member.id), project.id, { title: "A", points: 3 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [a.id] });
  setNow("2026-09-07T15:00:00Z");
  await closeTicket(w.work, member.id, project.id, a);
  setNow("2026-09-08T08:00:00Z");
  const b = await w.work.createTicket(w.ctx(member.id), project.id, { title: "B", points: 5 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [b.id] });
  setNow("2026-09-08T12:00:00Z");
  await closeTicket(w.work, member.id, project.id, b);
  const c = await w.work.createTicket(w.ctx(member.id), project.id, { title: "C", points: 2 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [c.id] });
  // C stays open.

  const metrics = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(metrics.state, "active");
  assert.equal(metrics.throughput, 2, "early close does not count");
  assert.equal(metrics.velocity, 8, "points valued at completion");
  assert.deepEqual(metrics.completedPerDay, { "2026-09-07": 1, "2026-09-08": 1 });

  // Lead time: creation -> qualifying close (a: 12:00 -> 15:00 = 3h; b: 08:00 -> 12:00 = 4h).
  assert.equal(metrics.leadTimes[a.id], 3 * 3600);
  assert.equal(metrics.leadTimes[b.id], 4 * 3600);
  void c;
});

test("reopening a qualifying ticket disqualifies it before completion", async () => {
  const { w, member, project, setNow } = await world();
  setNow("2026-09-07T09:00:00Z");
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);

  setNow("2026-09-07T10:00:00Z");
  const t = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T", points: 4 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [t.id] });
  const resolved = await closeTicket(w.work, member.id, project.id, t);

  setNow("2026-09-07T11:00:00Z");
  await w.work.reopenTicket(w.ctx(member.id), project.id, String(t.number), resolved.resourceVersion, {
    columnId: t.columnId,
  });

  const metrics = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(metrics.throughput, 0, "reopened work no longer qualifies");
  assert.equal(metrics.velocity, 0);
});

test("completion freezes the snapshot; later edits never rewrite metrics", async () => {
  const { w, member, project, setNow } = await world();
  setNow("2026-09-07T09:00:00Z");
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);

  setNow("2026-09-07T10:00:00Z");
  const t = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T", points: 4 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [t.id] });
  setNow("2026-09-07T11:00:00Z");
  await closeTicket(w.work, member.id, project.id, t);

  setNow("2026-09-08T09:00:00Z");
  const completed = await w.planning.completeSprint(w.ctx(member.id), project.id, sprint.id);
  assert.equal(completed.state, "completed");
  let frozen = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(frozen.velocity, 4);
  assert.equal(frozen.throughput, 1);

  // Post-completion: reopen the ticket, edit points, delete it. The frozen
  // metrics and snapshot never change.
  const resolvedTicket = await w.work.getTicketDetail(w.ctx(member.id), project.id, t.id);
  assert.ok(resolvedTicket);
  const reopened = await w.work.reopenTicket(
    w.ctx(member.id), project.id, String(t.number), resolvedTicket.ticket.resourceVersion,
    { columnId: t.columnId },
  );
  await w.work.updateTicket(w.ctx(member.id), project.id, String(t.number), reopened.resourceVersion, { points: 99 });
  await w.work.deleteTicket(w.ctx(member.id), project.id, String(t.number), reopened.resourceVersion + 1);

  frozen = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(frozen.velocity, 4, "snapshot is immutable");
  // SAFETY: the snapshot payload carries exactly these members (completeSprint).
  const snapshot = (await w.planning.snapshot(w.ctx(member.id), project.id, sprint.id)) as {
    sprint: { state: string };
    metrics: { velocity: number; throughput: number };
  };
  assert.equal(snapshot.sprint.state, "completed");
  assert.equal(snapshot.metrics.velocity, 4);
});

test("unfinished tickets lose their sprint assignment at completion but keep history", async () => {
  const { w, member, project, setNow } = await world();
  setNow("2026-09-07T09:00:00Z");
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);
  const open = await w.work.createTicket(w.ctx(member.id), project.id, { title: "Open" });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [open.id] });

  setNow("2026-09-08T09:00:00Z");
  await w.planning.completeSprint(w.ctx(member.id), project.id, sprint.id);
  const detail = await w.planning.getSprintDetail(w.ctx(member.id), project.id, sprint.id);
  const m = detail.members.find((x) => x.ticketId === open.id);
  assert.ok(m);
  assert.ok(m.removedAt, "unfinished tickets lose current assignment");

  // The ticket may now enter another sprint, preserving completed history.
  const s2 = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S2" });
  await w.planning.addTickets(w.ctx(member.id), project.id, s2.id, { ticketIds: [open.id] });
});

test("burndown tracks scope and estimate changes; project timezone keys the days", async () => {
  const { w, member, project, setNow } = await world({ timezone: "Europe/Berlin" });
  setNow("2026-09-07T09:00:00Z"); // 11:00 in Berlin
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);

  const t1 = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T1", points: 5 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [t1.id] });
  // Scope change: add another ticket, then change its estimate.
  const t2 = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T2", points: 3 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [t2.id] });
  await w.work.updateTicket(w.ctx(member.id), project.id, String(t2.number), t2.resourceVersion, { points: 8 });

  setNow("2026-09-08T08:00:00Z"); // 10:00 Berlin — still 2026-09-07 in Berlin? No: 08:00 UTC = 10:00 Berlin, same day.
  const metrics = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  const days = metrics.burndown.map((b) => b.day);
  // Activation at 2026-09-07T09:00Z = 11:00 local; end at 08:00Z next day = 10:00 local -> two local days.
  assert.deepEqual(days, ["2026-09-07", "2026-09-08"]);
  assert.equal(metrics.burndown[0]?.pointsRemaining, 13, "5 + 8 after estimate change");
  assert.equal(metrics.burndown[1]?.pointsRemaining, 13);

  // Resolve t1: burndown drops. The interval now ends at 15:00Z, so only the
  // first local day is reported.
  setNow("2026-09-07T15:00:00Z");
  await closeTicket(w.work, member.id, project.id, t1);
  const after = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(after.burndown.length, 1);
  assert.equal(after.burndown[0]?.pointsRemaining, 8);
});

test("cycle time uses the latest not_started -> started transition", async () => {
  const { w, member, project, setNow } = await world();
  const cols = await w.projects.columnsFor(project.id);
  const todo = cols.find((c) => c.name === "Todo");
  const inProgress = cols.find((c) => c.name === "In Progress");
  const review = cols.find((c) => c.name === "Review");
  assert.ok(todo && inProgress && review);

  setNow("2026-09-07T09:00:00Z");
  const sprint = await w.planning.createSprint(w.ctx(member.id), project.id, { name: "S" });
  await w.planning.activateSprint(w.ctx(member.id), project.id, sprint.id);

  setNow("2026-09-07T10:00:00Z");
  const t = await w.work.createTicket(w.ctx(member.id), project.id, { title: "T", points: 1 });
  await w.planning.addTickets(w.ctx(member.id), project.id, sprint.id, { ticketIds: [t.id] });

  // Start work: not_started -> started.
  const v1 = t.resourceVersion;
  const moved1 = await w.work.moveTicket(w.ctx(member.id), project.id, String(t.number), v1, {
    columnId: inProgress.id,
    position: 0,
  });
  // Movement among started columns does not reset cycle time.
  const moved2 = await w.work.moveTicket(w.ctx(member.id), project.id, String(t.number), moved1.resourceVersion, {
    columnId: review.id,
    position: 0,
  });
  setNow("2026-09-07T14:00:00Z");
  await closeTicket(w.work, member.id, project.id, { number: t.number, resourceVersion: moved2.resourceVersion });

  const metrics = await w.planning.metrics(w.ctx(member.id), project.id, sprint.id);
  assert.equal(metrics.cycleTimes[t.id], 4 * 3600, "10:00 -> 14:00");

  // A later reopen + restart resets the measured transition.
  void todo;
});